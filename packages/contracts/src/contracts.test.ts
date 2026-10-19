import { describe, expect, it } from 'vitest';
import { allMachines, findTransition, matchMachine } from './states.js';
import { formatToman, rialToToman, tomanToRial, formatRial } from './money.js';
import { formatInstant, normalizeDigits, toJalaliParts, UtcInstantSchema } from './time.js';
import { Roles, rolePermissions, roleScopeTypes, scopeInheritance } from './acl.js';
import { decodeCursor, encodeCursor } from './pagination.js';
import { z } from 'zod';

describe('money (DATA-005)', () => {
  it('converts integer rial to labeled toman without floating point', () => {
    expect(rialToToman(123450)).toEqual({ toman: 12345, rial: 0 });
    expect(rialToToman(7)).toEqual({ toman: 0, rial: 7 });
    expect(tomanToRial(5)).toBe(50);
    expect(formatToman(123450, 'fa')).toBe('۱۲٬۳۴۵ تومان');
    expect(formatToman(123450, 'en')).toBe('12,345 Toman');
    expect(formatToman(123457, 'en')).toBe('12,345 Toman and 7 Rial');
    expect(formatRial(1000, 'fa')).toBe('۱٬۰۰۰ ریال');
  });
  it('rejects non-integer and negative amounts', () => {
    expect(() => rialToToman(1.5)).toThrow();
    expect(() => rialToToman(-1)).toThrow();
  });
});

describe('time (DATA-004, UX-004)', () => {
  it('normalizes Persian and Arabic-Indic digits', () => {
    expect(normalizeDigits('۰۹۱۲۳۴۵۶۷۸۹')).toBe('09123456789');
    expect(normalizeDigits('٠٩١٢')).toBe('0912');
    expect(normalizeDigits('۱۲٫۵')).toBe('12.5');
  });
  it('accepts only UTC instants for storage', () => {
    expect(UtcInstantSchema.safeParse('2026-10-18T09:30:00.000Z').success).toBe(true);
    expect(UtcInstantSchema.safeParse('2026-10-18T13:00:00+03:30').success).toBe(false);
  });
  it('renders Tehran time in the Persian calendar', () => {
    const parts = toJalaliParts('2026-03-21T00:00:00Z'); // Nowruz 1405 at 03:30 Tehran
    expect(parts).toEqual({ year: 1405, month: 1, day: 1 });
    const fa = formatInstant('2026-10-18T09:30:00Z', { locale: 'fa', style: 'date' });
    expect(fa).toContain('۱۴۰۵');
    const en = formatInstant('2026-10-18T09:30:00Z', { locale: 'en', style: 'time' });
    expect(en).toBe('13:00');
  });
});

describe('state machines (chapter 15)', () => {
  it('every transition references declared states and at least one role', () => {
    for (const m of allMachines) {
      expect(m.states).toContain(m.initial);
      for (const t of m.transitions) {
        for (const f of t.from) expect(m.states).toContain(f);
        expect(m.states).toContain(t.to);
        expect(t.roles.length).toBeGreaterThan(0);
        expect(t.precondition.length).toBeGreaterThan(5);
      }
      const names = m.transitions.map((t) => t.name);
      expect(new Set(names).size).toBe(names.length);
    }
  });
  it('every non-initial state is reachable', () => {
    for (const m of allMachines) {
      const reachable = new Set<string>([m.initial]);
      let changed = true;
      while (changed) {
        changed = false;
        for (const t of m.transitions) {
          if (t.from.some((f) => reachable.has(f)) && !reachable.has(t.to)) {
            reachable.add(t.to);
            changed = true;
          }
        }
      }
      for (const s of m.states) expect(reachable.has(s), `${m.entity}:${s}`).toBe(true);
    }
  });
  it('final results cannot be reopened without second approval', () => {
    expect(findTransition(matchMachine, 'reopen')?.secondApproval).toBe(true);
  });
});

describe('acl matrix', () => {
  it('every role has scope types and no undefined permissions', () => {
    for (const r of Roles) {
      expect(roleScopeTypes[r].length).toBeGreaterThan(0);
      expect(Array.isArray(rolePermissions[r])).toBe(true);
    }
    for (const [role, kids] of Object.entries(scopeInheritance)) {
      expect(Roles).toContain(role);
      expect(kids!.length).toBeGreaterThan(0);
    }
  });
  it('referees never gain finance or publish permissions', () => {
    expect(rolePermissions.referee).not.toContain('finance.payout');
    expect(rolePermissions.referee).not.toContain('news.publish');
    expect(rolePermissions.reporter).not.toContain('match.result.correct');
  });
});

describe('pagination cursors', () => {
  it('round-trips and rejects garbage', () => {
    const schema = z.object({ k: z.string() });
    const c = encodeCursor({ k: 'abc' });
    expect(decodeCursor(c, schema)).toEqual({ k: 'abc' });
    expect(decodeCursor('not-base64-json', schema)).toBeNull();
  });
});
