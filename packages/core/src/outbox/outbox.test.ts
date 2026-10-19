import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testContainer, rid } from '../test/harness.js';
import { orgDoc } from '../test/harness.js';

let t: Awaited<ReturnType<typeof testContainer>>;
beforeAll(async () => {
  t = await testContainer();
});
afterAll(async () => {
  await t.drop();
});

const actor = { principalId: 'usr_test', kind: 'user' as const };

describe('transactional outbox', () => {
  it('writes the domain change and the event atomically — rollback drops both', async () => {
    await expect(
      t.dbh.withTransaction(async (session) => {
        await t.c.organizations.insertOne(orgDoc('org_ob_1', 'ob-1', 'x'), { session });
        await t.outbox.append({ type: 'organization.created', aggregate: { type: 'organization', id: 'org_ob_1' }, aggregateVersion: 0, actor, payload: {}, correlationId: rid() }, session);
        throw new Error('abort');
      }),
    ).rejects.toThrow('abort');
    expect(await t.c.organizations.countDocuments({ _id: 'org_ob_1' })).toBe(0);
    expect(await t.c.outbox.countDocuments({ 'aggregate.id': 'org_ob_1' })).toBe(0);

    await t.dbh.withTransaction(async (session) => {
      await t.c.organizations.insertOne(orgDoc('org_ob_2', 'ob-2', 'x'), { session });
      await t.outbox.append({ type: 'organization.created', aggregate: { type: 'organization', id: 'org_ob_2' }, aggregateVersion: 0, actor, payload: {}, correlationId: rid() }, session);
    });
    expect(await t.c.outbox.countDocuments({ 'aggregate.id': 'org_ob_2', status: 'pending' })).toBe(1);
    // no consumer matches this type: the record completes as done and leaves the queue clean for the next tests
    expect(await t.consumer.drain()).toBe(1);
    expect(await t.c.outbox.countDocuments({ 'aggregate.id': 'org_ob_2', status: 'done' })).toBe(1);
  });

  it('applies a handler exactly once even when the worker crashes after side effects', async () => {
    let calls = 0;
    t.consumer.register({
      name: 'crashy',
      matches: ['test.crash'],
      async handle(event, session) {
        calls++;
        await t.c.counters.updateOne({ _id: `effect:${event.id}` }, { $inc: { value: 1 } }, { upsert: true, session });
        if (calls === 1) throw new Error('simulated crash after side effect');
      },
    });
    const ev = await t.outbox.append({ type: 'test.crash', aggregate: { type: 'x', id: '1' }, aggregateVersion: 0, actor, payload: {}, correlationId: rid() });
    const first = await t.consumer.claim();
    expect(first?._id).toBe(ev._id);
    expect(await t.consumer.process(first!)).toBe('retry');
    // side effect rolled back together with the missing marker
    expect(await t.c.counters.findOne({ _id: `effect:${ev._id}` })).toBeNull();
    const pending = await t.c.outbox.findOne({ _id: ev._id });
    expect(pending?.status).toBe('pending');
    expect(pending?.attempts).toBe(1);
    // force immediate retry
    await t.c.outbox.updateOne({ _id: ev._id }, { $set: { nextAttemptAt: new Date(0).toISOString() } });
    const second = await t.consumer.claim();
    expect(await t.consumer.process(second!)).toBe('done');
    expect((await t.c.counters.findOne({ _id: `effect:${ev._id}` }))?.value).toBe(1);
    // processing the same record again is a no-op for the handler
    await t.consumer.process(second!);
    expect((await t.c.counters.findOne({ _id: `effect:${ev._id}` }))?.value).toBe(1);
    expect(calls).toBe(2);
  });

  it('retries a bounded number of times then dead-letters, and replay is explicit and audited', async () => {
    t.consumer.register({ name: 'always-fails', matches: ['test.fail'], handle: async () => { throw new Error('nope'); } });
    const ev = await t.outbox.append({ type: 'test.fail', aggregate: { type: 'x', id: '2' }, aggregateVersion: 0, actor, payload: {}, correlationId: rid() });
    await t.c.outbox.updateOne({ _id: ev._id }, { $set: { maxAttempts: 2 } });
    expect(await t.consumer.process((await t.consumer.claim())!)).toBe('retry');
    await t.c.outbox.updateOne({ _id: ev._id }, { $set: { nextAttemptAt: new Date(0).toISOString() } });
    expect(await t.consumer.process((await t.consumer.claim())!)).toBe('dead_letter');
    expect((await t.c.outbox.findOne({ _id: ev._id }))?.status).toBe('dead_letter');
    expect(await t.c.audit.countDocuments({ action: 'outbox.dead_letter', 'target.id': ev._id })).toBe(1);

    const replay = await t.consumer.replay(ev._id, { principalId: 'usr_admin', requestId: rid() });
    expect(replay.replayOf).toBe(ev._id);
    expect(replay.status).toBe('pending');
    expect(await t.c.audit.countDocuments({ action: 'outbox.replay' })).toBe(1);
    await expect(t.consumer.replay(ev._id, { principalId: 'usr_admin', requestId: rid() })).resolves.toBeTruthy();
    await expect(t.consumer.replay(replay._id, { principalId: 'usr_admin', requestId: rid() })).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
  });

  it('survives a restart: leases are released and pending work is not lost', async () => {
    t.consumer.register({ name: 'ok', matches: ['test.ok'], handle: async () => undefined });
    await t.c.outbox.updateMany({ type: 'test.fail', status: 'pending' }, { $set: { status: 'done' } }); // isolate from the replayed records above
    const ev = await t.outbox.append({ type: 'test.ok', aggregate: { type: 'x', id: '3' }, aggregateVersion: 0, actor, payload: {}, correlationId: rid() });
    const claimed = await t.consumer.claim();
    expect(claimed?.status).toBe('processing');
    await t.consumer.stop(); // simulates graceful shutdown mid-flight
    expect((await t.c.outbox.findOne({ _id: ev._id }))?.status).toBe('pending');
    // an expired lease from a crashed worker is reclaimable
    await t.c.outbox.updateOne({ _id: ev._id }, { $set: { status: 'processing', leaseUntil: new Date(0).toISOString(), leaseOwner: 'dead-worker' } });
    const reclaimed = await t.consumer.claim();
    expect(reclaimed?._id).toBe(ev._id);
    expect(await t.consumer.process(reclaimed!)).toBe('done');
  });
});
