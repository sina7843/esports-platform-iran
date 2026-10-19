import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testContainer, rid } from '../test/harness.js';
import { seedIds } from '../db/seed.js';

let t: Awaited<ReturnType<typeof testContainer>>;
beforeAll(async () => {
  t = await testContainer({ seed: true });
});
afterAll(async () => {
  await t.drop();
});

describe('contextual ACL (ACL-001..004, chapter 3 acceptance)', () => {
  it('referee of event A cannot read evidence or lobby of event B, and the attempt is audited (AC-17)', async () => {
    expect(await t.acl.can(seedIds.referee, 'event.evidence.read', { type: 'event', id: seedIds.eventA })).toBe(true);
    expect(await t.acl.can(seedIds.referee, 'event.evidence.read', { type: 'event', id: seedIds.eventB })).toBe(false);
    expect(await t.acl.can(seedIds.referee, 'match.lobby.read', { type: 'match', id: seedIds.matchA })).toBe(true);
    expect(await t.acl.can(seedIds.referee, 'match.lobby.read', { type: 'match', id: seedIds.matchB })).toBe(false);
    const requestId = rid();
    await expect(t.acl.require(seedIds.referee, 'match.lobby.read', { type: 'match', id: seedIds.matchB }, requestId)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await t.c.audit.countDocuments({ requestId, outcome: 'denied' })).toBe(1);
  });

  it('is deny-by-default: unknown principals and missing resources are rejected', async () => {
    expect(await t.acl.can('usr_nobody', 'event.read_private', { type: 'event', id: seedIds.eventA })).toBe(false);
    await expect(t.acl.can(seedIds.admin, 'event.manage', { type: 'event', id: 'evt_missing' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('organizer grants inherit from organization to its events and matches, but not to other organizations', async () => {
    expect(await t.acl.can(seedIds.organizer, 'event.manage', { type: 'event', id: seedIds.eventA })).toBe(true);
    expect(await t.acl.can(seedIds.organizer, 'match.manage', { type: 'match', id: seedIds.matchA })).toBe(true);
    expect(await t.acl.can(seedIds.organizer, 'event.manage', { type: 'event', id: seedIds.eventB })).toBe(false);
    expect(await t.acl.can(seedIds.organizerB, 'event.manage', { type: 'event', id: seedIds.eventA })).toBe(false);
  });

  it('reporter can draft news for the event but can never verify or correct results', async () => {
    expect(await t.acl.can(seedIds.reporter, 'news.draft', { type: 'event', id: seedIds.eventA })).toBe(true);
    expect(await t.acl.can(seedIds.reporter, 'match.result.verify', { type: 'match', id: seedIds.matchA })).toBe(false);
    expect(await t.acl.can(seedIds.reporter, 'match.result.correct', { type: 'match', id: seedIds.matchA })).toBe(false);
  });

  it('platform admin does not reach match lobby credentials or event evidence (no ambiguous global role)', async () => {
    expect(await t.acl.can(seedIds.admin, 'acl.grant', { type: 'event', id: seedIds.eventB })).toBe(true);
    expect(await t.acl.can(seedIds.admin, 'match.lobby.read', { type: 'match', id: seedIds.matchA })).toBe(false);
    expect(await t.acl.can(seedIds.admin, 'event.evidence.read', { type: 'event', id: seedIds.eventA })).toBe(false);
  });

  it('revocation is immediate for the next request and bumps aclVersion', async () => {
    const before = (await t.c.principals.findOne({ _id: seedIds.refereeB }))!.aclVersion;
    const grant = (await t.c.grants.findOne({ principalId: seedIds.refereeB, revokedAt: null }))!;
    expect(await t.acl.can(seedIds.refereeB, 'event.evidence.read', { type: 'event', id: seedIds.eventB })).toBe(true);
    await t.acl.revoke(grant._id, { principalId: seedIds.admin, requestId: rid() }, 'test');
    expect(await t.acl.can(seedIds.refereeB, 'event.evidence.read', { type: 'event', id: seedIds.eventB })).toBe(false);
    expect((await t.c.principals.findOne({ _id: seedIds.refereeB }))!.aclVersion).toBe(before + 1);
    expect(await t.c.outbox.countDocuments({ type: 'acl.grant.revoked', 'payload.grantId': grant._id })).toBe(1);
  });

  it('rejects grants in scope types the role does not allow, and expired grants do not count', async () => {
    await expect(t.acl.grant({ principalId: seedIds.player, role: 'referee', scope: { type: 'team', id: seedIds.teamA }, expiresAt: null, reason: null }, { principalId: seedIds.admin, requestId: rid() })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await t.acl.grant({ principalId: seedIds.player, role: 'referee', scope: { type: 'event', id: seedIds.eventB }, expiresAt: new Date(Date.now() - 1000).toISOString(), reason: 'expired' }, { principalId: seedIds.admin, requestId: rid() });
    expect(await t.acl.can(seedIds.player, 'event.evidence.read', { type: 'event', id: seedIds.eventB })).toBe(false);
  });

  it('blocks conflict of interest: a team member cannot judge their own match', async () => {
    await t.acl.grant({ principalId: seedIds.captain, role: 'referee', scope: { type: 'match', id: seedIds.matchA }, expiresAt: null, reason: 'test' }, { principalId: seedIds.admin, requestId: rid() });
    expect(await t.acl.can(seedIds.captain, 'match.result.verify', { type: 'match', id: seedIds.matchA })).toBe(true);
    await expect(t.acl.requireNoConflict(seedIds.captain, { type: 'match', id: seedIds.matchA }, rid())).rejects.toMatchObject({ code: 'CONFLICT_OF_INTEREST' });
    await expect(t.acl.requireNoConflict(seedIds.referee, { type: 'match', id: seedIds.matchA }, rid())).resolves.toBeUndefined();
  });
});

describe('independent second approval (ACL-003)', () => {
  it('requester cannot approve their own request; a different finance officer can; consumption is single-use', async () => {
    const req = await t.approvals.request({ action: 'finance.payout', scope: { type: 'site', id: 'site' }, payload: { amount: 1000 }, reason: 'prize' }, { principalId: seedIds.finance, requestId: rid() });
    await expect(t.approvals.decide(req._id, { decision: 'approve', reason: 'ok', expectedVersion: 0 }, { principalId: seedIds.finance, requestId: rid() })).rejects.toMatchObject({ code: 'SEPARATION_OF_DUTIES' });
    await expect(t.approvals.decide(req._id, { decision: 'approve', reason: 'ok', expectedVersion: 0 }, { principalId: seedIds.reporter, requestId: rid() })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(t.approvals.decide(req._id, { decision: 'approve', reason: 'ok', expectedVersion: 5 }, { principalId: seedIds.finance2, requestId: rid() })).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
    const approved = await t.approvals.decide(req._id, { decision: 'approve', reason: 'ok', expectedVersion: 0 }, { principalId: seedIds.finance2, requestId: rid() });
    expect(approved.state).toBe('approved');
    await expect(t.approvals.consume(req._id, 'finance.refund.large', { type: 'site', id: 'site' }, { principalId: seedIds.finance, requestId: rid() })).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    const used = await t.approvals.consume(req._id, 'finance.payout', { type: 'site', id: 'site' }, { principalId: seedIds.finance, requestId: rid() });
    expect(used.state).toBe('executed');
    await expect(t.approvals.consume(req._id, 'finance.payout', { type: 'site', id: 'site' }, { principalId: seedIds.finance, requestId: rid() })).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
  });
});
