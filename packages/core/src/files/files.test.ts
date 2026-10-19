import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testContainer, rid } from '../test/harness.js';
import { seedIds } from '../db/seed.js';
import { sniffMime } from './files.js';

let t: Awaited<ReturnType<typeof testContainer>>;
beforeAll(async () => {
  t = await testContainer({ seed: true });
});
afterAll(async () => {
  await t.drop();
});

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
const EICAR = Buffer.from('X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*', 'latin1');
const scope = { type: 'event' as const, id: seedIds.eventA };

describe('upload pipeline (SEC-003/004, OPS-003)', () => {
  it('sniffs real content types', () => {
    expect(sniffMime(PNG)).toBe('image/png');
    expect(sniffMime(Buffer.from('%PDF-1.7 hello world'))).toBe('application/pdf');
    expect(sniffMime(Buffer.from('<script>alert(1)</script>'))).toBeNull();
  });

  it('stores a private file for an authorized uploader and serves it only through a bound, short-lived link', async () => {
    const f = await t.files.upload({ data: PNG, originalName: 'proof.png', declaredMime: 'image/png', visibility: 'private', scope, retentionClass: 'dispute_evidence' }, { principalId: seedIds.referee, requestId: rid() });
    expect(f.quarantined).toBe(false);
    expect(f.publicUrl).toBeNull();
    expect(f.retentionNoticeFa).toContain('۱۲ ماه');
    const link = await t.files.signPrivateLink(f._id, { principalId: seedIds.referee, requestId: rid() });
    const u = new URL(link.url);
    const read = await t.files.readSigned(f._id, Number(u.searchParams.get('exp')), u.searchParams.get('p')!, u.searchParams.get('sig')!);
    expect(read.data.equals(PNG)).toBe(true);
    await expect(t.files.readSigned(f._id, Number(u.searchParams.get('exp')), 'usr_other', u.searchParams.get('sig')!)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(t.files.readSigned(f._id, Math.floor(Date.now() / 1000) - 10, u.searchParams.get('p')!, u.searchParams.get('sig')!)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    // reporter of the same event has no file.read_private → cannot mint a link
    await expect(t.files.signPrivateLink(f._id, { principalId: seedIds.reporter, requestId: rid() })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    // referee of another event cannot either (cross-event evidence, AC-17)
    await expect(t.files.signPrivateLink(f._id, { principalId: seedIds.refereeB, requestId: rid() })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('rejects declared/real type mismatch, disallowed types, oversize and empty files', async () => {
    const actor = { principalId: seedIds.referee, requestId: rid() };
    await expect(t.files.upload({ data: PNG, originalName: 'x.pdf', declaredMime: 'application/pdf', visibility: 'private', scope, retentionClass: 'demo' }, actor)).rejects.toMatchObject({ code: 'UNSUPPORTED_MEDIA_TYPE' });
    await expect(t.files.upload({ data: Buffer.from('<?php echo 1; ?>'), originalName: 'x.php', declaredMime: 'text/plain', visibility: 'private', scope, retentionClass: 'demo' }, actor)).rejects.toMatchObject({ code: 'UNSUPPORTED_MEDIA_TYPE' });
    await expect(t.files.upload({ data: Buffer.alloc(0), originalName: 'e.png', declaredMime: 'image/png', visibility: 'private', scope, retentionClass: 'demo' }, actor)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    const big = Buffer.concat([PNG, Buffer.alloc(t.config.UPLOAD_MAX_BYTES_PUBLIC)]);
    await expect(t.files.upload({ data: big, originalName: 'big.png', declaredMime: 'image/png', visibility: 'public', scope, retentionClass: 'media_public' }, { principalId: seedIds.organizer, requestId: rid() })).rejects.toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
  });

  it('quarantines scanner hits and never serves them', async () => {
    const f = await t.files.upload({ data: Buffer.concat([PNG, EICAR]), originalName: 'bad.png', declaredMime: 'image/png', visibility: 'private', scope, retentionClass: 'demo' }, { principalId: seedIds.referee, requestId: rid() });
    expect(f.quarantined).toBe(true);
    expect(f.scanState).toBe('infected');
    await expect(t.files.signPrivateLink(f._id, { principalId: seedIds.referee, requestId: rid() })).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    expect(await t.c.audit.countDocuments({ action: 'file.quarantined', 'target.id': f._id })).toBe(1);
  });

  it('blocks identity documents until a retention policy is approved (OPS-002) and denies uploads without permission', async () => {
    await expect(t.files.upload({ data: PNG, originalName: 'id.png', declaredMime: 'image/png', visibility: 'private', scope, retentionClass: 'identity_document' }, { principalId: seedIds.referee, requestId: rid() })).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    await expect(t.files.upload({ data: PNG, originalName: 'x.png', declaredMime: 'image/png', visibility: 'public', scope, retentionClass: 'media_public' }, { principalId: seedIds.player, requestId: rid() })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
