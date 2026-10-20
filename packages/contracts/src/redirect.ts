/** UX-007: only same-origin relative paths may be returned to after login (no open redirect). */
export function safeReturnPath(next: unknown): string {
  if (typeof next !== 'string') return '/';
  if (!next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\') || /[\r\n]/.test(next) || /^\/+[a-z][a-z0-9+.-]*:/i.test(next)) return '/';
  try {
    const u = new URL(next, 'https://x.invalid');
    return u.origin === 'https://x.invalid' ? `${u.pathname}${u.search}${u.hash}` : '/';
  } catch {
    return '/';
  }
}
