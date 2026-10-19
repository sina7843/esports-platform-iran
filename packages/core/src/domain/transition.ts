import type { ClientSession, Collection, Filter, UpdateFilter } from 'mongodb';
import { DomainError, findTransition, type Role, type StateMachine, type Transition } from '@esp/contracts';

/**
 * Generic state-transition guard (chapter 15). Entities never accept a free `state` value; callers name a
 * transition and supply the version they observed. The update is a single conditional write
 * `{_id, state ∈ from, version: expected}` → `{state: to, version+1}`, so two concurrent actors cannot both win
 * (optimistic concurrency, SEC-006). Role eligibility is checked against the transition table; the caller's
 * grant in the entity's scope is checked by the ACL layer before calling.
 */
export interface StatefulDoc {
  _id: string;
  version: number;
  state: string;
}

export interface TransitionRequest {
  transition: string;
  expectedVersion: number;
  actorRoles: readonly (Role | 'system')[];
  /** Set when the transition requires second approval and an approved approval id is supplied. */
  approvalId?: string;
}

export function assertTransitionAllowed<S extends string>(machine: StateMachine<S>, req: TransitionRequest, currentState: S): Transition<S> {
  const t = findTransition(machine, req.transition);
  if (!t) throw new DomainError('ILLEGAL_TRANSITION', `unknown transition ${req.transition} for ${machine.entity}`);
  if (!t.from.includes(currentState)) {
    throw new DomainError('ILLEGAL_TRANSITION', `${machine.entity} cannot ${req.transition} from ${currentState}`, { from: t.from, current: currentState });
  }
  if (!t.roles.some((r) => req.actorRoles.includes(r))) {
    throw new DomainError('FORBIDDEN', `role not allowed to ${req.transition} ${machine.entity}`, { allowed: t.roles });
  }
  if (t.secondApproval && !req.approvalId) {
    throw new DomainError('PRECONDITION_FAILED', `${req.transition} requires an independent approval`, { secondApproval: true });
  }
  return t;
}

export async function applyTransition<S extends string, D extends StatefulDoc & { state: S }>(
  machine: StateMachine<S>,
  col: Collection<D>,
  id: string,
  req: TransitionRequest,
  extraSet: Partial<D> = {},
  session?: ClientSession,
): Promise<{ doc: D; transition: Transition<S> }> {
  const opts = session ? { session } : {};
  const current = await col.findOne({ _id: id } as Filter<D>, opts);
  if (!current) throw new DomainError('NOT_FOUND', `${machine.entity} not found`);
  if (current.version !== req.expectedVersion) {
    throw new DomainError('VERSION_CONFLICT', `${machine.entity} changed since it was read`, { expected: req.expectedVersion, actual: current.version });
  }
  const t = assertTransitionAllowed(machine, req, current.state);
  const updated = await col.findOneAndUpdate(
    { _id: id, version: req.expectedVersion, state: { $in: [...t.from] } } as Filter<D>,
    { $set: { ...extraSet, state: t.to, updatedAt: new Date().toISOString() }, $inc: { version: 1 } } as unknown as UpdateFilter<D>,
    { returnDocument: 'after', ...opts },
  );
  if (!updated) throw new DomainError('VERSION_CONFLICT', `${machine.entity} changed concurrently`);
  return { doc: updated as D, transition: t };
}
