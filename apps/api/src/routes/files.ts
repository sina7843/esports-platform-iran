import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { DomainError, ErrorResponse, FileRecordSchema, ScopeTypes, SignedLinkSchema } from '@esp/contracts';
import { retentionClasses, type Container, type FileDoc } from '@esp/core';

const fileOut = (f: FileDoc) => ({ id: f._id, visibility: f.visibility, scope: f.scope, ownerPrincipalId: f.ownerPrincipalId, originalName: f.originalName, mimeType: f.mimeType, sizeBytes: f.sizeBytes, sha256: f.sha256, scanState: f.scanState, quarantined: f.quarantined, retentionClass: f.retentionClass, retentionNoticeFa: f.retentionNoticeFa, createdAt: f.createdAt, publicUrl: f.publicUrl });

/**
 * Upload (multipart) + metadata + short-lived private links + public serving.
 * Fields: `file` (binary), `visibility`, `scopeType`, `scopeId`, `retentionClass`.
 */
export function fileRoutes(app: FastifyInstance, container: Container): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get('/files/retention-classes', { schema: { tags: ['files'], response: { 200: z.record(z.string(), z.object({ noticeFa: z.string(), days: z.number().int().nullable() })) } } }, async () => retentionClasses);

  app.post('/files', { schema: { tags: ['files'], consumes: ['multipart/form-data'], summary: 'Upload a file (multipart: file, visibility, scopeType, scopeId, retentionClass)' } }, async (req, reply) => {
    const ctx = req.requireAuth();
    const parts = req.parts({ limits: { fileSize: container.config.UPLOAD_MAX_BYTES_PRIVATE, files: 1, fields: 8 } });
    const fields: Record<string, string> = {};
    let data: Buffer | null = null;
    let originalName = '';
    let declaredMime = '';
    for await (const part of parts) {
      if (part.type === 'file') {
        originalName = part.filename;
        declaredMime = part.mimetype;
        data = await part.toBuffer();
      } else fields[part.fieldname] = String(part.value);
    }
    const meta = z.object({ visibility: z.enum(['private', 'public']), scopeType: z.enum(ScopeTypes), scopeId: z.string().min(1).max(64), retentionClass: z.string().min(1).max(64) }).safeParse(fields);
    if (!meta.success) throw new DomainError('VALIDATION_FAILED', 'invalid upload fields', meta.error.issues);
    if (!data) throw new DomainError('VALIDATION_FAILED', 'file part missing');
    const doc = await container.files.upload({ data, originalName, declaredMime, visibility: meta.data.visibility, scope: { type: meta.data.scopeType, id: meta.data.scopeId }, retentionClass: meta.data.retentionClass }, { principalId: ctx.principal._id, requestId: req.id });
    return reply.status(201).send(fileOut(doc));
  });

  r.get('/files/:id', { schema: { tags: ['files'], params: z.object({ id: z.string() }), response: { 200: FileRecordSchema, 401: ErrorResponse, 403: ErrorResponse, 404: ErrorResponse } } }, async (req) => {
    const ctx = req.requireAuth();
    const f = await container.files.get(req.params.id);
    if (!f) throw new DomainError('NOT_FOUND', 'file not found');
    if (f.ownerPrincipalId !== ctx.principal._id && f.visibility === 'private') await req.requirePermission('file.read_private', f.scope);
    return fileOut(f);
  });

  r.post('/files/:id/link', { schema: { tags: ['files'], params: z.object({ id: z.string() }), response: { 200: SignedLinkSchema, 401: ErrorResponse, 403: ErrorResponse, 404: ErrorResponse, 412: ErrorResponse } } }, async (req) => {
    const ctx = req.requireAuth();
    return container.files.signPrivateLink(req.params.id, { principalId: ctx.principal._id, requestId: req.id });
  });

  r.get('/files/private/:id', { schema: { tags: ['files'], params: z.object({ id: z.string() }), querystring: z.object({ exp: z.coerce.number().int(), p: z.string(), sig: z.string() }) } }, async (req, reply) => {
    const f = await container.files.readSigned(req.params.id, req.query.exp, req.query.p, req.query.sig);
    reply.header('Content-Type', f.mime).header('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(f.name)}`).header('Cache-Control', 'private, no-store').header('X-Content-Type-Options', 'nosniff');
    return reply.send(f.data);
  });

  r.get('/files/public/*', { schema: { tags: ['files'] } }, async (req, reply) => {
    const key = (req.params as { '*': string })['*'];
    const f = await container.files.readPublic(key);
    if (!f) throw new DomainError('NOT_FOUND', 'file not found');
    reply.header('Content-Type', f.mime).header('Cache-Control', 'public, max-age=86400, immutable').header('X-Content-Type-Options', 'nosniff');
    return reply.send(f.data);
  });
}
