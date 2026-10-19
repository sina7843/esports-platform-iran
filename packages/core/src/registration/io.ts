import { DomainError } from '@esp/contracts';
import type { Container } from '../container.js';
import { parseCsv, toCsv } from '../files/csv.js';
import { EventsService } from '../events/events.js';

/**
 * REG-005/007: bulk invitations from a CSV file and registration export.
 * Import never creates registrations on behalf of participants (each must accept the rules and confirm); it issues
 * entry codes bound to holders. Export includes private form answers only for staff allowed to read evidence.
 */
export class RegistrationIo {
  constructor(private readonly ct: Container) {}

  async exportCsv(disciplineId: string, actor: string, requestId: string): Promise<string> {
    const d = await this.ct.c.disciplines.findOne({ _id: disciplineId });
    if (!d) throw new DomainError('NOT_FOUND', 'discipline not found');
    const scope = { type: 'event' as const, id: d.eventId };
    await this.ct.acl.require(actor, 'event.read_private', scope, requestId);
    const showPrivate = await this.ct.acl.can(actor, 'event.evidence.read', scope);
    const fields = d.config.formFields.filter((f) => showPrivate || !f.private);
    const regs = await this.ct.c.registrations.find({ disciplineId }).sort({ createdAt: 1 }).toArray();
    await this.ct.audit.append({ actorPrincipalId: actor, action: 'registration.export', target: { type: 'discipline', id: disciplineId }, scope, outcome: 'success', details: { rows: regs.length, privateFields: showPrivate }, requestId });
    return toCsv(
      ['trackingCode', 'displayName', 'kind', 'state', 'quota', 'late', 'createdAt', 'roster', ...fields.map((f) => f.key)],
      regs.map((r) => [r.trackingCode, r.displayName, r.kind, r.state, r.quotaKind, r.late, r.createdAt, r.roster.map((m) => `${m.displayName}:${m.role}:${m.status}`).join(' | '), ...fields.map((f) => r.formAnswers[f.key] ?? '')]),
    );
  }

  /** CSV columns: holderKey (team:<id> | player:<id>), quota (invite | organization). One bound entry code per row. */
  async importInvites(disciplineId: string, file: Buffer, actor: string, requestId: string): Promise<{ created: Array<{ row: number; holderKey: string; code: string }>; errors: Array<{ row: number; error: string }> }> {
    const { header, rows } = parseCsv(file);
    const hi = header.indexOf('holderKey');
    const qi = header.indexOf('quota');
    if (hi < 0) throw new DomainError('VALIDATION_FAILED', 'missing holderKey column');
    const created: Array<{ row: number; holderKey: string; code: string }> = [];
    const errors: Array<{ row: number; error: string }> = [];
    const events = new EventsService(this.ct);
    for (const [i, cells] of rows.entries()) {
      const row = i + 2;
      const holderKey = cells[hi] ?? '';
      const quota = (qi >= 0 ? cells[qi] : 'invite') || 'invite';
      if (!/^(team|player):[A-Za-z0-9_]+$/.test(holderKey)) {
        errors.push({ row, error: 'invalid holderKey' });
        continue;
      }
      if (quota !== 'invite' && quota !== 'organization') {
        errors.push({ row, error: 'quota must be invite or organization' });
        continue;
      }
      const [kind, id] = holderKey.split(':') as ['team' | 'player', string];
      const exists = kind === 'team' ? await this.ct.c.teams.findOne({ _id: id }, { projection: { _id: 1 } }) : await this.ct.c.principals.findOne({ _id: id, status: 'active' }, { projection: { _id: 1 } });
      if (!exists) {
        errors.push({ row, error: `${kind} not found` });
        continue;
      }
      try {
        const [code] = await events.createEntryCodes(disciplineId, { quotaKind: quota, holderKey, maxUses: 1, expiresAt: null }, 1, actor, requestId);
        created.push({ row, holderKey, code: code!._id });
      } catch (err) {
        errors.push({ row, error: (err as Error).message });
      }
    }
    return { created, errors };
  }
}
