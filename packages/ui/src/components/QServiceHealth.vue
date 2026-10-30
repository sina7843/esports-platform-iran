<script setup lang="ts">
import { computed } from 'vue';
import { fa, isRtl, num, tr } from '../locale';
import type { IconName } from '../icons';
import { HEALTH, latin, tx, type Health } from '../maps/broadcast';
import QBadge from './QBadge.vue';
import QIcon from './QIcon.vue';

export interface QServiceHealthCheck { /** Response time in ms (bar height). */ ms: number; status: 'ok' | 'degraded' | 'down' }
/** Provider/service health tile: Latin name, status word, last check, a bar sparkline of recent checks and outbox / dead-letter counts. */
export interface QServiceHealthProps {
  /** Provider name, Latin shown LTR. */
  name: string;
  kind?: (string) | undefined;
  /** Default 'server'. */
  icon?: (IconName) | undefined;
  status: Health;
  statusLabels?: (Partial<Record<Health, string>>) | undefined;
  detail?: (string) | undefined;
  checkedAt?: (string) | undefined;
  checkedLabel?: (string) | undefined;
  /** Last checks, oldest first; the last 12 are drawn. */
  checks?: (QServiceHealthCheck[]) | undefined;
  /** Caption under the bars (say when data is sample). */
  sparkCaption?: (string) | undefined;
  outbox?: (number) | undefined;
  outboxLabel?: (string) | undefined;
  /** Dead-letter count (danger-text when > 0). */
  deadLetters?: (number) | undefined;
  deadLabel?: (string) | undefined;
}
const p = withDefaults(defineProps<QServiceHealthProps>(), { icon: 'server', status: 'unconfigured' });

const s = computed(() => HEALTH[p.status] ?? HEALTH.unconfigured);
const words = computed<Record<Health, string>>(() => ({
  ok: tx(HEALTH.ok.word), degraded: tx(HEALTH.degraded.word), down: tx(HEALTH.down.word), unconfigured: tx(HEALTH.unconfigured.word), ...p.statusLabels,
}));
const word = computed(() => words.value[p.status] ?? words.value.unconfigured);
const checks = computed(() => (p.checks ?? []).slice(-12));
const lastN = computed(() => { const n = checks.value.length; return tr(`آخرین ${fa(n)} بررسی`, `Last ${n}${n === 1 ? ' check' : ' checks'}`); });
const sparkLabel = computed(() => {
  const t = { ok: 0, degraded: 0, down: 0 };
  for (const c of checks.value) t[c.status] = (t[c.status] ?? 0) + 1;
  const w = words.value;
  const sp = tr('، ', ', ');
  return `${p.sparkCaption || lastN.value}: ${fa(t.ok)} ${w.ok}${sp}${fa(t.degraded)} ${w.degraded}${sp}${fa(t.down)} ${w.down}`;
});
const bars = computed(() => {
  const max = Math.max(1, ...checks.value.map((c) => c.ms));
  return checks.value.map((c) => ({
    cls: ['q-service-health__bar', `q-service-health__bar--${c.status}`],
    height: `${c.status === 'down' ? 100 : Math.max(12, Math.round((c.ms / max) * 100))}%`,
    title: c.status === 'down' ? words.value.down : `${num(c.ms)} ms`,
  }));
});
const caption = computed(() => p.sparkCaption || `${lastN.value}${tr('، ', ', ')}${isRtl() ? tr('قدیمی ← جدید', 'oldest ← newest') : tr('قدیمی → جدید', 'oldest → newest')}`);
const facts = computed(() => {
  const f: { k: string; label: string; value: string; bad?: boolean }[] = [{ k: 'checked', label: p.checkedLabel || tr('آخرین بررسی', 'Last checked'), value: p.checkedAt || '—' }];
  if (p.outbox != null) f.push({ k: 'outbox', label: p.outboxLabel || tr('صف ارسال', 'Event outbox'), value: num(p.outbox) });
  if (p.deadLetters != null) f.push({ k: 'dead', label: p.deadLabel || tr('نامه‌ی مرده', 'Dead letters'), value: num(p.deadLetters), bad: p.deadLetters > 0 });
  return f;
});
const isLatin = computed(() => latin(p.name));
</script>

<template>
  <article :class="['q-service-health', `q-service-health--${status}`]" :aria-label="`${name} — ${word}`">
    <div class="q-service-health__head">
      <span class="q-service-health__glyph q-chamfer-sm" aria-hidden="true"><QIcon :name="icon" :size="20" /></span>
      <div class="q-service-health__titles">
        <strong class="q-service-health__name" :dir="isLatin ? 'ltr' : undefined" :title="name"><bdi :class="isLatin ? 'q-ltr' : undefined">{{ name }}</bdi></strong>
        <span v-if="kind" class="q-service-health__kind">{{ kind }}</span>
      </div>
      <QBadge :tone="s.tone" :icon="s.icon" class="q-service-health__badge">{{ word }}</QBadge>
    </div>
    <p v-if="detail" class="q-service-health__detail"><bdi>{{ detail }}</bdi></p>
    <figure v-if="checks.length" class="q-service-health__spark">
      <!-- bars sit in a flex row, so DOM order (oldest first) puts the newest check at inline-end in both directions -->
      <div class="q-service-health__bars" role="img" :aria-label="sparkLabel">
        <span v-for="(b, i) in bars" :key="i" :class="b.cls" :style="{ height: b.height }" :title="b.title" />
      </div>
      <figcaption class="q-service-health__caption">{{ caption }}</figcaption>
    </figure>
    <dl class="q-service-health__facts">
      <div v-for="f in facts" :key="f.k" :class="['q-service-health__fact', { 'q-service-health__fact--bad': f.bad }]"><dt>{{ f.label }}</dt><dd>{{ f.value }}</dd></div>
    </dl>
  </article>
</template>
