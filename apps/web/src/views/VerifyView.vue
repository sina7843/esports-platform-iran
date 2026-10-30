<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { QAlert, QButton, QCard, QCertificateCard, QCode, QContainer, QDataState, QEmptyState, QFacts, QPageHeader, QSkeleton, QTextField, fa, formatJalali, isRtl } from '@esp/ui';
import type { ApiClientError } from '../api/client';
import { esp05, type Certificate, type Honor } from '../api/esp05';
import { toClientError } from '../errors';
import { honorLabel, t } from '../i18n';

/** Spec docs/redesign/03-specs/verify.md — AWD-004: anyone can check an honour or certificate code; revoked ones say why. */
const LEN = 12;
const route = useRoute();
const router = useRouter();
const raw = ref(String(route.params['code'] ?? ''));
const err = ref<string | undefined>(undefined);
const busy = ref(false);
const failure = ref<ApiClientError | null>(null);
type Result = { type: 'valid' | 'revoked'; code: string; honor?: Honor | undefined; cert?: Certificate | undefined } | { type: 'notfound' | 'ratelimited'; code: string };
const res = ref<Result | null>(null);

const MAP = '۰۱۲۳۴۵۶۷۸۹';
const AR = '٠١٢٣٤٥٦٧٨٩';
function normalise(v: string): string {
  return v.replace(/[۰-۹]/g, (d) => String(MAP.indexOf(d))).replace(/[٠-٩]/g, (d) => String(AR.indexOf(d))).toUpperCase()
    .replace(/[\s\-_.·‌‍]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
}
const code = computed(() => normalise(raw.value));
const ready = computed(() => code.value.length === LEN && /^[0-9A-F]+$/.test(code.value));
function validate(v: string): string | undefined {
  if (!v) return t('vf.empty');
  if (/[^0-9A-F]/.test(v)) return t('vf.chars');
  if (v.length !== LEN) return t('vf.len', { total: fa(LEN), n: fa(v.length) });
  return undefined;
}
async function lookup() {
  const v = code.value;
  err.value = validate(v);
  if (err.value) { res.value = null; return; }
  if (route.params['code'] !== v) void router.replace(`/verify/${v}`);
  busy.value = true;
  failure.value = null;
  res.value = null;
  try {
    const r = await esp05.verify(v);
    res.value = { type: r.valid ? 'valid' : 'revoked', code: v, honor: r.honor, cert: r.certificate };
  } catch (e) {
    const ce = toClientError(e);
    if (ce.code === 'NOT_FOUND') res.value = { type: 'notfound', code: v };
    else if (ce.code === 'RATE_LIMITED') res.value = { type: 'ratelimited', code: v };
    else failure.value = ce;
  } finally {
    busy.value = false;
  }
}
onMounted(() => { if (raw.value) void lookup(); });

const cells = computed(() => [0, 1, 2].map((g) => [0, 1, 2, 3].map((i) => code.value.charAt(g * 4 + i))));
const grouped = (c: string) => c.replace(/(.{4})(?=.)/g, '$1 ');
const verifyUrl = (c: string) => `${location.origin}/verify/${c}`;
const view = computed(() => {
  const r = res.value;
  if (!r || (r.type !== 'valid' && r.type !== 'revoked')) return null;
  const h = r.honor; const c = r.cert;
  const title = h ? honorLabel(h.label) : t('vf.cert');
  const recipient = h ? (h.team?.nameAtTime ?? h.recipients.map((x) => x.displayName).join(isRtl() ? '، ' : ', ')) : (c?.displayName ?? '');
  const event = h?.eventName ?? c?.eventName ?? '';
  const eventId = h?.eventId ?? c?.eventId ?? '';
  const issued = h?.issuedAt ?? c?.issuedAt ?? '';
  const place = h?.place ?? c?.place ?? null;
  const facts = [
    { label: t('vf.type'), value: `${h ? t('vf.honor') : t('vf.cert')}${place ? ` · ${t('vf.place', { n: fa(place) })}` : ''}` },
    { label: h?.team ? t('vf.teamAtTime') : t('vf.holder'), value: recipient },
    ...(h?.team && h.recipients.length ? [{ label: t('vf.members'), value: h.recipients.map((x) => x.displayName).join(isRtl() ? '، ' : ', ') }] : []),
    { label: t('vf.event'), value: event },
    { label: t('vf.issued'), value: formatJalali(issued, 'date') },
  ];
  return { title, recipient, event, eventId, issued, place, facts, teamId: h?.team?.teamId, reason: h?.revokedReason ?? '', kind: (h ? 'placement' : 'attendance') as 'placement' | 'attendance', rank: place === 1 || place === 2 || place === 3 ? (place as 1 | 2 | 3) : undefined };
});
</script>

<template>
  <QContainer>
    <div class="k-stack p-verify">
      <QPageHeader :title="t('vf.title')" :description="t('vf.desc')" :breadcrumb="[{ label: t('vf.home'), href: '/' }, { label: t('vf.title') }]" />
      <div class="p-verify-grid">
        <div class="k-stack p-verify-col">
          <QCard>
            <form class="p-verify-form" role="search" :aria-label="t('vf.form')" novalidate @submit.prevent="lookup">
              <div class="p-verify-row">
                <QTextField
                  id="ver-code" v-model="raw" :label="t('vf.code')" ltr auto-complete="off" :max-length="24" :error="err" placeholder="XXXX XXXX XXXX"
                  :hint="t('vf.hint')" @update:model-value="err = undefined"
                />
                <QButton variant="primary" type="submit" icon="shield" :loading="busy">{{ t('vf.submit') }}</QButton>
              </div>
              <div class="p-verify-groups" aria-hidden="true">
                <span class="p-verify-cells">
                  <span v-for="(g, gi) in cells" :key="gi" class="p-verify-group">
                    <span v-for="(ch, i) in g" :key="i" :class="['p-verify-cell', ch ? 'p-verify-cell--filled' : 'p-verify-cell--empty']">{{ ch || '·' }}</span>
                  </span>
                </span>
                <span :class="['p-verify-count', { 'p-verify-count--done': ready }]">
                  {{ ready ? t('vf.ready', { n: fa(LEN), total: fa(LEN) }) : t('vf.count', { n: fa(Math.min(code.length, 99)), total: fa(LEN) }) }}
                </span>
              </div>
              <p class="q-sr" aria-live="polite">{{ code.length ? t('vf.entered', { n: fa(code.length) }) : '' }}</p>
            </form>
          </QCard>

          <QSkeleton v-if="busy" variant="card" />
          <QDataState v-else-if="failure" :state="failure.code === 'NETWORK' ? 'offline' : 'error'" :request-id="failure.requestId ?? undefined" @retry="lookup" />
          <div v-else-if="view && res?.type === 'valid'" class="p-verify-result" aria-live="polite">
            <QAlert tone="success" icon="check-circle" :title="t('vf.valid')">{{ res.honor ? t('vf.validHonor') : t('vf.validCert') }}</QAlert>
            <QCertificateCard
              :title="view.title" :kind="view.kind" :kind-label="res.honor ? t('vf.honor') : t('vf.cert')" :rank="view.rank"
              :recipient="view.recipient" :event="view.event" :date="formatJalali(view.issued, 'date')" :code="res.code" verify-href="/verify" state="valid"
            />
            <QFacts variant="list" :items="view.facts" />
            <div class="p-verify-actions">
              <QButton v-if="view.eventId" variant="secondary" icon="trophy" :href="`/events/${encodeURIComponent(view.eventId)}`">{{ t('vf.eventPage') }}</QButton>
              <QButton v-if="view.teamId" variant="ghost" icon="users" :href="`/teams/${encodeURIComponent(view.teamId)}`">{{ t('vf.teamPage') }}</QButton>
            </div>
            <QCode copy :label="t('vf.link')" :copy-label="t('vf.copy')">{{ verifyUrl(res.code) }}</QCode>
          </div>
          <div v-else-if="view && res?.type === 'revoked'" class="p-verify-result" aria-live="polite">
            <QAlert tone="danger" icon="x-circle" :title="t('vf.revoked')">{{ view.reason ? t('vf.reason', { reason: view.reason }) : '' }}</QAlert>
            <QCertificateCard
              :title="view.title" :kind="view.kind" :rank="view.rank" :recipient="view.recipient" :event="view.event"
              :date="formatJalali(view.issued, 'date')" :code="res.code" state="revoked" :revoked-reason="view.reason || undefined"
            />
            <p class="p-verify-fine">{{ t('vf.revokedFine') }}</p>
          </div>
          <QEmptyState v-else-if="res?.type === 'notfound'" icon="search" :title="t('vf.notFound')">
            <template #body>{{ t('vf.checked') }} <bdi class="q-ltr q-mono">{{ grouped(res.code) }}</bdi>. {{ t('vf.notFoundBody') }}</template>
            <template #action><QButton variant="secondary" href="/support" icon="inbox">{{ t('vf.support') }}</QButton></template>
          </QEmptyState>
          <QAlert v-else-if="res?.type === 'ratelimited'" tone="warning" icon="clock" :title="t('vf.rate')" />
        </div>
        <aside>
          <QCard>
            <div class="k-stack">
              <h2 class="h4 p-verify-h">{{ t('vf.how') }}</h2>
              <ul class="p-verify-how">
                <li>{{ t('vf.how1') }}</li>
                <li>{{ t('vf.how2') }}</li>
                <li>{{ t('vf.how3') }}</li>
              </ul>
              <p class="p-verify-fine">{{ t('vf.fine') }}</p>
              <QButton variant="ghost" size="sm" href="/rankings/formula" :icon-end="isRtl() ? 'arrow-left' : 'arrow-right'">{{ t('vf.conditions') }}</QButton>
            </div>
          </QCard>
        </aside>
      </div>
    </div>
  </QContainer>
</template>

<style scoped>
.p-verify { gap: var(--space-7); }
.p-verify-col { gap: var(--space-5); }
.p-verify-h { margin: 0; }
.p-verify-grid { display: grid; grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr); gap: var(--space-6); align-items: start; }
.p-verify-form { display: flex; flex-direction: column; gap: var(--space-4); }
.p-verify-row { display: flex; align-items: flex-start; gap: var(--space-3); }
.p-verify-row > :first-child { flex: 1; min-width: 0; }
.p-verify-row > .q-btn { margin-block-start: 30px; flex: none; }
.p-verify-groups { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2) var(--space-4); }
.p-verify-cells { display: inline-flex; gap: var(--space-2); direction: ltr; }
.p-verify-group { display: inline-flex; gap: 2px; }
.p-verify-cell { display: inline-grid; place-items: center; width: 26px; height: 36px; font-family: var(--font-mono); font-size: 18px; font-weight: 700; border-block-end: 2px solid var(--line-strong); color: var(--ink); }
.p-verify-cell--empty { color: var(--ink-disabled); }
.p-verify-cell--filled { border-block-end-color: var(--green-line); }
.p-verify-count { font-size: 13px; color: var(--ink-subtle); }
.p-verify-count--done { color: var(--green-text); font-weight: 800; }
.p-verify-result { display: flex; flex-direction: column; gap: var(--space-4); }
.p-verify-actions { display: flex; flex-wrap: wrap; gap: var(--space-3); }
.p-verify-how { margin: 0; padding-inline-start: var(--space-5); display: flex; flex-direction: column; gap: var(--space-2); font-size: 14px; line-height: 26px; color: var(--ink-muted); }
.p-verify-how li::marker { color: var(--green-text); }
.p-verify-fine { margin: 0; font-size: 13px; line-height: 22px; color: var(--ink-subtle); }
@media (max-width: 960px) { .p-verify-grid { grid-template-columns: minmax(0, 1fr); } }
@media (max-width: 560px) {
  .p-verify-row { flex-direction: column; align-items: stretch; }
  .p-verify-row > .q-btn { margin-block-start: 0; }
  .p-verify-cell { width: 22px; font-size: 16px; }
}
</style>
