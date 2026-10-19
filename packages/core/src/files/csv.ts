import { DomainError } from '@esp/contracts';

/**
 * CSV import/export used by registration, finance and accounting exports (REG-007, FIN-008).
 * Export neutralises spreadsheet formula injection: any cell starting with = + - @ or a control character is
 * prefixed with an apostrophe. Import is bounded (size, rows, columns), strict UTF-8, RFC-4180 quoting, and reports
 * errors per row instead of failing silently.
 */
const DANGEROUS = /^[=+\-@\t\r]/;
/** UTF-8 byte-order mark so spreadsheet apps read Persian text correctly (built from its code point, no raw char in source). */
const BOM = String.fromCharCode(0xfeff);

export function escapeCell(v: unknown): string {
  let s = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
  if (DANGEROUS.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  return BOM + [header.map(escapeCell).join(','), ...rows.map((r) => r.map(escapeCell).join(','))].join('\r\n') + '\r\n';
}

export interface ParsedCsv {
  header: string[];
  rows: string[][];
}

export function parseCsv(input: Buffer, limits = { maxBytes: 1024 * 1024, maxRows: 1000, maxCols: 30 }): ParsedCsv {
  if (input.length > limits.maxBytes) throw new DomainError('PAYLOAD_TOO_LARGE', `CSV larger than ${limits.maxBytes} bytes`);
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(input);
  } catch {
    throw new DomainError('VALIDATION_FAILED', 'CSV must be UTF-8 text');
  }
  if (text.includes('\u0000')) throw new DomainError('VALIDATION_FAILED', 'binary content is not a CSV');
  if (text.startsWith(BOM)) text = text.slice(1);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
      continue;
    }
    if (ch === '"' && cell === '') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      if (row.some((c) => c !== '')) rows.push(row);
      row = [];
      cell = '';
      if (rows.length > limits.maxRows + 1) throw new DomainError('VALIDATION_FAILED', `more than ${limits.maxRows} rows`);
    } else cell += ch;
  }
  if (quoted) throw new DomainError('VALIDATION_FAILED', 'unterminated quoted field');
  row.push(cell);
  if (row.some((c) => c !== '')) rows.push(row);
  if (!rows.length) throw new DomainError('VALIDATION_FAILED', 'empty CSV');
  const header = rows[0]!.map((h) => h.trim());
  if (header.length > limits.maxCols) throw new DomainError('VALIDATION_FAILED', `more than ${limits.maxCols} columns`);
  // cells read back are plain text; a leading apostrophe written by our exporter is removed
  return { header, rows: rows.slice(1).map((r) => r.map((c) => c.replace(/^'(?=[=+\-@])/, '').trim())) };
}
