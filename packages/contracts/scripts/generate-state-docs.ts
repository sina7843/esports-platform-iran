import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { allMachines } from '../src/states.js';

const out: string[] = [];
out.push('# جدول گذار وضعیت‌ها (ESP-SRS فصل ۱۵)');
out.push('');
out.push('> این فایل از `packages/contracts/src/states.ts` تولید می‌شود؛ دستی ویرایش نکنید. دستور: `pnpm docs:generate`.');
out.push('');
out.push('قاعده عمومی: تغییر وضعیت فقط از طریق گذار نام‌دار و با `expectedVersion` (optimistic concurrency) انجام می‌شود. ارسال مقدار دلخواه `status` از API رد می‌شود (`ILLEGAL_TRANSITION`). گذارهای علامت‌خورده با «تأیید دوم» نیازمند تأیید مستقل شخص دیگری با مجوز `approval.decide` هستند (ACL-003).');
out.push('');
for (const m of allMachines) {
  out.push(`## ${m.entityFa} (\`${m.entity}\`)`);
  out.push('');
  out.push(`وضعیت آغازین: \`${m.initial}\` (${m.statesFa[m.initial]})`);
  out.push('');
  out.push('| وضعیت | برچسب فارسی |');
  out.push('|---|---|');
  for (const s of m.states) out.push(`| \`${s}\` | ${m.statesFa[s]} |`);
  out.push('');
  out.push('| گذار | از | به | نقش مجاز | پیش‌شرط | اثر | اعلان | جبران/بازگشت | تأیید دوم |');
  out.push('|---|---|---|---|---|---|---|---|---|');
  for (const t of m.transitions) {
    out.push(
      `| \`${t.name}\` | ${t.from.map((f) => `\`${f}\``).join(', ')} | \`${t.to}\` | ${t.roles.join(', ')} | ${t.precondition} | ${t.effect} | ${t.notification} | ${t.compensation} | ${t.secondApproval ? 'بله' : '—'} |`,
    );
  }
  out.push('');
}
const target = resolve(process.cwd(), '../../docs/state-transitions.md');
writeFileSync(target, out.join('\n') + '\n', 'utf8');
console.log(`wrote ${target}`);
