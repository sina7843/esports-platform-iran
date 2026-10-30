#!/usr/bin/env node
/**
 * QeSB redesign audit — static checks for the rules in CLAUDE.md (tokens only, logical CSS, Persian digits, no CDN fonts).
 * No dependencies. Copy to apps/web/scripts/qesb-audit.mjs and run from the repo root:
 *
 *   node apps/web/scripts/qesb-audit.mjs                 # whole web app + packages/ui  (or: pnpm --filter @esp/web audit)
 *   node apps/web/scripts/qesb-audit.mjs apps/web/src/views/EventsView.vue   # specific files or folders
 *   node apps/web/scripts/qesb-audit.mjs --json > audit.json
 *   node apps/web/scripts/qesb-audit.mjs --legacy-only   # only the old-token / old-class report (migration progress)
 *
 * Exit code 1 when any "error" rule fires (use it in CI once P0 is merged); "legacy" findings are warnings until P4.
 * Vendored DS files (tokens.css, qesb.css = DS bundle.css) are skipped: they are the source of truth, not app code.
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative, extname, basename, dirname, resolve } from 'node:path';

/** Run from anywhere (repo root, apps/web via `pnpm --filter @esp/web audit`): paths resolve against the workspace root. */
function workspaceRoot(start) {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const up = dirname(dir);
    if (up === dir) return resolve(start);
    dir = up;
  }
}
const CWD = process.cwd();
const ROOT = workspaceRoot(CWD);
process.chdir(ROOT);
const args = process.argv.slice(2);
const asJson = args.includes('--json');
const legacyOnly = args.includes('--legacy-only');
const targets = args.filter((a) => !a.startsWith('--')).map((a) => relative(ROOT, resolve(CWD, a)) || '.');
const roots = targets.length ? targets : ['apps/web/src', 'packages/ui/src'].filter((p) => existsSync(p));
const VENDORED = new Set(['tokens.css', 'qesb.css', 'bundle.css']);
const EXT = new Set(['.vue', '.css', '.ts']);

function walk(p, out = []) {
  if (!existsSync(p)) return out;
  const st = statSync(p);
  if (st.isFile()) { if (EXT.has(extname(p))) out.push(p); return out; }
  for (const n of readdirSync(p)) {
    if (n === 'node_modules' || n === 'dist') continue;
    walk(join(p, n), out);
  }
  return out;
}

/** The parts of a file that are CSS: <style> blocks of .vue files, whole .css files. */
function cssOf(file, src) {
  if (file.endsWith('.css')) return [{ text: src, offset: 0 }];
  if (!file.endsWith('.vue')) return [];
  return [...src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => ({ text: m[1] ?? '', offset: (m.index ?? 0) + m[0].indexOf(m[1] ?? '') }));
}
function templateOf(src) {
  const m = src.match(/<template>([\s\S]*)<\/template>/);
  return m ? { text: m[1] ?? '', offset: (m.index ?? 0) + 10 } : null;
}
function scriptOf(file, src) {
  if (file.endsWith('.ts')) return [{ text: src, offset: 0 }];
  return [...src.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => ({ text: m[1] ?? '', offset: (m.index ?? 0) + m[0].indexOf(m[1] ?? '') }));
}
function lineAt(src, idx) { return src.slice(0, idx).split('\n').length; }

const OLD_TOKENS = ['--sp-1', '--sp-2', '--sp-3', '--sp-4', '--sp-5', '--sp-6', '--sp-7', '--fs-xs', '--fs-sm', '--fs-md', '--fs-lg', '--fs-xl', '--fs-2xl',
  '--lh-tight', '--lh-body', '--text', '--text-muted', '--accent', '--accent-strong', '--accent-soft', '--on-accent', '--border', '--surface-2',
  '--ok', '--ok-soft', '--warn', '--warn-soft', '--danger', '--info', '--focus', '--shadow', '--topbar-h', '--sidebar-w', '--radius',
  '--card', '--secondary', '--foreground', '--background', '--brand', '--brand-foreground', '--destructive', '--success', '--warning', '--muted-foreground',
  '--ring', '--depth-surface', '--dir-flip', '--info-soft'];
const OLD_CLASSES = ['btn', 'btn-primary', 'btn-danger', 'btn-sm', 'input', 'card', 'stack', 'row', 'grid', 'grid2', 'grid3', 'muted', 'num', 'bidi', 'mono', 'sr-only', 'skip-link'];

const rules = [
  // CSS rules
  { id: 'literal-colour', level: 'error', where: 'css', re: /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|lab|lch)\(/g, msg: 'literal colour — use a semantic token var(--…)' },
  { id: 'named-colour', level: 'error', where: 'css', re: /(?:^|[\s:;,(])(?:color|background(?:-color)?|border(?:-[a-z-]+)?|fill|stroke|outline(?:-color)?)\s*:\s*(?:white|black|red|green|blue|gray|grey)\b/gm, msg: 'named colour — use a semantic token' },
  { id: 'tabular-nums', level: 'error', where: 'css', re: /tabular-nums/g, msg: 'tabular-nums doubles the width of «۱» in Vazirmatn — remove (use .q-num / natural widths)' },
  { id: 'letter-spacing', level: 'error', where: 'css', re: /letter-spacing\s*:\s*[^;}\n]+/g, ok: (v) => /:\s*(?:0(?:px|em)?|normal)\s*$/.test(v), msg: 'letter-spacing — never on numbers or Persian text' },
  { id: 'physical-property', level: 'error', where: 'css', re: /\b(?:margin|padding|border)-(?:left|right)\b|(?:^|[\s;{])(?:left|right)\s*:|text-align\s*:\s*(?:left|right)\b|float\s*:\s*(?:left|right)\b|border-(?:top|bottom)-(?:left|right)-radius/gm, msg: 'physical CSS property — use logical (inline-start/end, inset-inline-…)' },
  { id: 'font-family', level: 'error', where: 'css', re: /font-family\s*:\s*[^;}\n]+/g, ok: (v) => /:\s*(?:var\(--font-(?:sans|mono)\)|inherit)\s*$/.test(v), msg: 'hard-coded font-family — use var(--font-sans) / var(--font-mono)' },
  { id: 'cdn-font', level: 'error', where: 'css', re: /fonts\.googleapis\.com|fonts\.gstatic\.com/g, msg: 'CDN font — the product loads Vazirmatn from the local `vazirmatn` package only' },
  { id: 'old-token', level: 'legacy', where: 'css', re: new RegExp(`var\\((?:${OLD_TOKENS.map((t) => t.replace(/-/g, '\\-')).join('|')})(?![\\w-])`, 'g'), msg: 'old (Violet Arena / Graphite) token — map it with 02-token-migration.md' },
  // template rules
  { id: 'old-class', level: 'legacy', where: 'template', re: new RegExp(`class="[^"]*(?<![\\w-])(?:${OLD_CLASSES.join('|')})\\b(?![\\w-])[^"]*"`, 'g'), msg: 'old base.css class — use the DS component / q-* class' },
  { id: 'inline-colour', level: 'error', where: 'template', re: /style="[^"]*(?:#[0-9a-fA-F]{3,8}\b|rgba?\()/g, msg: 'literal colour in an inline style' },
  // script rules
  { id: 'raw-number-format', level: 'error', where: 'script', re: /\.toLocaleString\(|\.toFixed\(/g, msg: 'raw toLocaleString/toFixed — use num()/dec()/toman() from @esp/ui (locale digits and «٬»/«٫»)' },
  { id: 'persian-digit-literal', level: 'warn', where: 'locale', re: /'[^'\n]*[۰-۹][^'\n]*'/g, msg: 'Persian digit hard-coded in a fa string — pass the number as a {param} and format it with num() so the Latin-digit preference works' },
];

const findings = [];
for (const root of roots) {
  for (const file of walk(root)) {
    const name = basename(file);
    if (VENDORED.has(name)) continue;
    if (file.endsWith('.test.ts')) continue;
    const src = readFileSync(file, 'utf8');
    const rel = relative(process.cwd(), file).replace(/\\/g, '/');
    const isLocale = /\/locales\//.test(rel);
    for (const r of rules) {
      if (legacyOnly && r.level !== 'legacy') continue;
      let parts = [];
      if (r.where === 'css') parts = cssOf(file, src);
      else if (r.where === 'template') { const t = templateOf(src); parts = t && file.endsWith('.vue') ? [t] : []; }
      else if (r.where === 'script') parts = isLocale ? [] : scriptOf(file, src);
      else if (r.where === 'locale') parts = isLocale ? [{ text: src, offset: 0 }] : [];
      for (const part of parts) {
        for (const m of part.text.matchAll(r.re)) {
          if (r.ok && r.ok(m[0].trim())) continue;
          // the DS formatter itself (packages/ui/src/locale.ts dec()) is where fixed-point conversion lives
          if (r.id === 'raw-number-format' && rel.endsWith('packages/ui/src/locale.ts')) continue;
          const idx = part.offset + (m.index ?? 0);
          findings.push({ rule: r.id, level: r.level, file: rel, line: lineAt(src, idx), match: m[0].trim().slice(0, 80), msg: r.msg });
        }
      }
    }
  }
}

if (asJson) {
  process.stdout.write(JSON.stringify(findings, null, 1));
} else {
  const byRule = new Map();
  for (const f of findings) { if (!byRule.has(f.rule)) byRule.set(f.rule, []); byRule.get(f.rule).push(f); }
  for (const [rule, list] of byRule) {
    const files = new Map();
    for (const f of list) files.set(f.file, (files.get(f.file) ?? 0) + 1);
    console.log(`\n[${list[0].level}] ${rule} — ${list.length} in ${files.size} files — ${list[0].msg}`);
    for (const f of list.slice(0, 40)) console.log(`  ${f.file}:${f.line}  ${f.match}`);
    if (list.length > 40) console.log(`  … ${list.length - 40} more (use --json)`);
  }
  const errors = findings.filter((f) => f.level === 'error').length;
  const legacy = findings.filter((f) => f.level === 'legacy').length;
  const warns = findings.filter((f) => f.level === 'warn').length;
  console.log(`\nqesb-audit: ${errors} errors, ${legacy} legacy (old tokens/classes still in use), ${warns} warnings`);
}
process.exitCode = findings.some((f) => f.level === 'error') ? 1 : 0;
