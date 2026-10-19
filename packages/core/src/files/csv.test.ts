import { describe, expect, it } from 'vitest';
import { parseCsv, toCsv, escapeCell } from './csv.js';

describe('csv (REG-007, FIN-008)', () => {
  it('starts with a UTF-8 BOM, neutralises formulas and round-trips quoted Persian text', () => {
    const out = toCsv(['name', 'note'], [['تیم «الف», ب', '=1+1'], ['@SUM(A1)', 'line\nbreak']]);
    expect(out.charCodeAt(0)).toBe(0xfeff);
    expect(out).not.toContain('FEFF');
    expect(escapeCell('=cmd')).toBe("'=cmd");
    expect(escapeCell('-2')).toBe("'-2");
    const back = parseCsv(Buffer.from(out, 'utf8'));
    expect(back.header).toEqual(['name', 'note']);
    expect(back.rows[0]).toEqual(['تیم «الف», ب', '=1+1']);
    expect(back.rows[1]![1]).toBe('line\nbreak');
  });
  it('rejects binary, unterminated quotes and oversized input', () => {
    expect(() => parseCsv(Buffer.from([0xff, 0xfe, 0x41]))).toThrow();
    expect(() => parseCsv(Buffer.from('a,b\n"open,1\n'))).toThrow(/unterminated/);
    expect(() => parseCsv(Buffer.alloc(2_000_000, 0x41))).toThrow();
  });
});
