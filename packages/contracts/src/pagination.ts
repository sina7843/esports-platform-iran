import { z } from 'zod';

/**
 * Cursor pagination contract. Cursors are opaque base64url strings produced by the server;
 * clients never construct them. Offsets are not used for public lists (unstable under inserts).
 */
export const PageQuerySchema = z.object({
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type PageQuery = z.infer<typeof PageQuerySchema>;

export const PageInfoSchema = z.object({
  nextCursor: z.string().nullable(),
  limit: z.number().int(),
});

export function pageOf<T extends z.ZodTypeAny>(item: T) {
  return z.object({ items: z.array(item), page: PageInfoSchema });
}

// base64url without Node Buffer so the contracts package stays browser-safe
function toBase64Url(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromBase64Url(s: string): string {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function encodeCursor(value: unknown): string {
  return toBase64Url(JSON.stringify(value));
}

export function decodeCursor<T>(cursor: string | undefined, schema: z.ZodType<T>): T | null {
  if (!cursor) return null;
  try {
    return schema.parse(JSON.parse(fromBase64Url(cursor)));
  } catch {
    return null;
  }
}
