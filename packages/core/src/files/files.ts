import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { DomainError, type Scope } from '@esp/contracts';
import type { Collections, FileDoc } from '../db/collections.js';
import { newId } from '../ids.js';
import type { Acl } from '../acl/acl.js';
import type { AuditLog } from '../audit/audit.js';
import type { Adapters } from '../adapters/types.js';

/**
 * Upload pipeline (SEC-003/004, OPS-003):
 * 1. declared type must be allowed for the visibility class; 2. real type is sniffed from magic bytes;
 * 3. size limits per class; 4. content is written OUTSIDE any code path with 0600 mode under a random key;
 * 5. scanner verdict decides quarantine (infected/failed → quarantined, never served); 6. private files are only
 * reachable through short-lived HMAC links minted after a server-side permission check; public files are served
 * directly. Retention class and the Persian notice shown to the uploader are recorded on the file.
 */
const MAGIC: Array<{ mime: string; test: (b: Buffer) => boolean }> = [
  { mime: 'image/png', test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: 'image/jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/webp', test: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
  { mime: 'image/gif', test: (b) => ['GIF87a', 'GIF89a'].includes(b.subarray(0, 6).toString('latin1')) },
  { mime: 'application/pdf', test: (b) => b.subarray(0, 5).toString('latin1') === '%PDF-' },
  { mime: 'video/mp4', test: (b) => b.subarray(4, 8).toString('latin1') === 'ftyp' },
  { mime: 'application/zip', test: (b) => b[0] === 0x50 && b[1] === 0x4b && (b[2] === 0x03 || b[2] === 0x05) },
];

export const allowedByVisibility: Record<'private' | 'public', readonly string[]> = {
  public: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
  private: ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf', 'video/mp4', 'application/zip'],
};

export const retentionClasses: Record<string, { noticeFa: string; days: number | null }> = {
  dispute_evidence: { noticeFa: 'مدارک اعتراض تا ۱۲ ماه پس از بسته‌شدن پرونده نگهداری می‌شود (پیشنهاد OPS-001).', days: 365 },
  demo: { noticeFa: 'دمو تا ۹۰ روز پس از قطعی‌شدن نتیجه نگهداری می‌شود (پیشنهاد OPS-001).', days: 90 },
  media_public: { noticeFa: 'رسانه عمومی تا عمر سرویس یا تا درخواست حذف دارنده حق نگهداری می‌شود.', days: null },
  profile_media: { noticeFa: 'تصویر پروفایل تا تغییر یا حذف حساب نگهداری می‌شود.', days: null },
  identity_document: { noticeFa: 'سیاست نگهداری اسناد هویتی هنوز مصوب نشده است؛ بارگذاری این دسته مسدود است (OPS-002).', days: null },
};

export function sniffMime(buf: Buffer): string | null {
  for (const m of MAGIC) if (buf.length >= 12 && m.test(buf)) return m.mime;
  return null;
}

export class Files {
  constructor(
    private readonly c: Collections,
    private readonly acl: Acl,
    private readonly audit: AuditLog,
    private readonly adapters: Adapters,
    private readonly opts: { secret: string; linkTtlSeconds: number; maxPrivate: number; maxPublic: number; apiOrigin: string },
  ) {}

  async upload(
    input: { data: Buffer; originalName: string; declaredMime: string; visibility: 'private' | 'public'; scope: Scope; retentionClass: string },
    actor: { principalId: string; requestId: string },
  ): Promise<FileDoc> {
    const permission = input.visibility === 'public' ? 'file.upload_public' : 'file.upload_private';
    // A participant's private document/evidence is tagged to the event or match it belongs to, but players hold
    // upload_private only at site level (no inheritance): a private upload may be authorized there. The file stays
    // private (owner + staff with file.read_private in that scope). Public uploads need the permission in the scope.
    const inScope = await this.acl.can(actor.principalId, permission, input.scope);
    if (!inScope) await this.acl.require(actor.principalId, permission, input.visibility === 'private' ? { type: 'site', id: 'site' } : input.scope, actor.requestId);
    const retention = retentionClasses[input.retentionClass];
    if (!retention) throw new DomainError('VALIDATION_FAILED', 'unknown retention class');
    if (input.retentionClass === 'identity_document') throw new DomainError('PRECONDITION_FAILED', 'identity document retention policy not approved; collection blocked (OPS-002)');
    const max = input.visibility === 'public' ? this.opts.maxPublic : this.opts.maxPrivate;
    if (input.data.length === 0) throw new DomainError('VALIDATION_FAILED', 'empty file');
    if (input.data.length > max) throw new DomainError('PAYLOAD_TOO_LARGE', `file exceeds ${max} bytes`);
    const real = sniffMime(input.data);
    if (!real || !allowedByVisibility[input.visibility].includes(real)) throw new DomainError('UNSUPPORTED_MEDIA_TYPE', 'file content type is not allowed', { detected: real });
    if (real !== input.declaredMime) throw new DomainError('UNSUPPORTED_MEDIA_TYPE', 'declared type does not match content', { declared: input.declaredMime, detected: real });

    const scan = await this.adapters.scanner.scan(input.data);
    const quarantined = scan.verdict === 'infected' || scan.verdict === 'failed';
    const id = newId('fil');
    const ext = real.split('/')[1] === 'jpeg' ? 'jpg' : real.split('/')[1]!;
    const storageKey = `${id.slice(-2)}/${id}.${ext}`;
    const sha256 = createHash('sha256').update(input.data).digest('hex');
    if (!quarantined) await this.adapters.storage.put(storageKey, input.data, input.visibility, real);
    else await this.adapters.storage.put(`quarantine/${storageKey}`, input.data, 'private', real);
    const doc: FileDoc = {
      _id: id,
      visibility: input.visibility,
      scope: input.scope,
      ownerPrincipalId: actor.principalId,
      originalName: input.originalName.slice(0, 255),
      mimeType: real,
      sizeBytes: input.data.length,
      sha256,
      scanState: scan.verdict === 'skipped_dev' ? 'skipped_dev' : scan.verdict,
      quarantined,
      retentionClass: input.retentionClass,
      retentionNoticeFa: retention.noticeFa,
      createdAt: new Date().toISOString(),
      publicUrl: input.visibility === 'public' && !quarantined ? this.adapters.storage.publicUrl(storageKey) : null,
      storageKey,
      version: 0,
    };
    await this.c.files.insertOne(doc);
    await this.audit.append({ actorPrincipalId: actor.principalId, action: quarantined ? 'file.quarantined' : 'file.uploaded', target: { type: 'file', id }, scope: input.scope, outcome: quarantined ? 'failed' : 'success', details: { mime: real, size: doc.sizeBytes, scan: scan.verdict, retentionClass: input.retentionClass }, requestId: actor.requestId });
    return doc;
  }

  /** Mints a short-lived link after checking `file.read_private` in the file's scope (SEC-004). */
  async signPrivateLink(fileId: string, actor: { principalId: string; requestId: string }): Promise<{ url: string; expiresAt: string }> {
    const f = await this.c.files.findOne({ _id: fileId });
    if (!f) throw new DomainError('NOT_FOUND', 'file not found');
    if (f.quarantined) throw new DomainError('PRECONDITION_FAILED', 'file is quarantined');
    if (f.ownerPrincipalId !== actor.principalId) await this.acl.require(actor.principalId, 'file.read_private', f.scope, actor.requestId);
    const exp = Math.floor(Date.now() / 1000) + this.opts.linkTtlSeconds;
    const sig = this.signature(fileId, exp, actor.principalId);
    await this.audit.append({ actorPrincipalId: actor.principalId, action: 'file.link_signed', target: { type: 'file', id: fileId }, scope: f.scope, outcome: 'success', details: { exp }, requestId: actor.requestId });
    return { url: `${this.opts.apiOrigin}/api/v1/files/private/${fileId}?exp=${exp}&p=${encodeURIComponent(actor.principalId)}&sig=${sig}`, expiresAt: new Date(exp * 1000).toISOString() };
  }

  private signature(fileId: string, exp: number, principalId: string): string {
    return createHmac('sha256', this.opts.secret).update(`${fileId}.${exp}.${principalId}`).digest('base64url');
  }

  /** Verifies a signed link and returns the bytes; the link is bound to the principal it was minted for. */
  async readSigned(fileId: string, exp: number, principalId: string, sig: string): Promise<{ data: Buffer; mime: string; name: string }> {
    if (!Number.isFinite(exp) || exp * 1000 < Date.now()) throw new DomainError('FORBIDDEN', 'link expired');
    const expected = Buffer.from(this.signature(fileId, exp, principalId));
    const given = Buffer.from(sig);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) throw new DomainError('FORBIDDEN', 'invalid signature');
    const f = await this.c.files.findOne({ _id: fileId });
    if (!f || f.quarantined) throw new DomainError('NOT_FOUND', 'file not found');
    const data = await this.adapters.storage.get(f.storageKey, f.visibility);
    if (!data) throw new DomainError('NOT_FOUND', 'file content missing');
    return { data, mime: f.mimeType, name: f.originalName };
  }

  async readPublic(storageKey: string): Promise<{ data: Buffer; mime: string } | null> {
    const f = await this.c.files.findOne({ storageKey, visibility: 'public', quarantined: false });
    if (!f) return null;
    const data = await this.adapters.storage.get(storageKey, 'public');
    return data ? { data, mime: f.mimeType } : null;
  }

  async get(fileId: string): Promise<FileDoc | null> {
    return this.c.files.findOne({ _id: fileId });
  }
}
