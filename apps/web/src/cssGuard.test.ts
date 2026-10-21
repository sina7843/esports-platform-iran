import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Regression guard (found by the ESP-07 browser lab): in a scoped style, `:global([dir='rtl']) .sep` was built into a
 * bare `[dir=rtl] { transform: scaleX(-1) }` rule that mirrored the whole page in every production build. A selector
 * with a tail after `:global(...)` is therefore forbidden; put the complete selector inside `:global(...)`.
 */
function vueFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? vueFiles(p) : p.endsWith('.vue') ? [p] : [];
  });
}

describe('scoped CSS guard', () => {
  it('no `:global(...)` is followed by a descendant/compound tail', () => {
    const bad: string[] = [];
    for (const f of vueFiles(join(__dirname))) {
      const css = [...readFileSync(f, 'utf8').matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1] ?? '').join('\n');
      for (const m of css.matchAll(/:global\((?:[^()]|\([^()]*\))*\)\s*[.#\w[:>+~]/g)) bad.push(`${f.split('src')[1]}: ${m[0]}`);
    }
    expect(bad).toEqual([]);
  });

  it('no rule applies a transform or mirror to the root or body in RTL', () => {
    const offenders: string[] = [];
    for (const f of vueFiles(join(__dirname))) {
      const css = readFileSync(f, 'utf8');
      if (/\[dir=['"]?rtl['"]?\]\s*\{[^}]*transform/.test(css)) offenders.push(f);
    }
    expect(offenders).toEqual([]);
  });
});
