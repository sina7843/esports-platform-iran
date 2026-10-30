<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { QAlert, QBadge, QButton, QCard, QConfirmDialog, QContainer, QDataState, QFacts, QOpsAlert, QPageHeader, QSection, QServiceHealth, QStatusBadge, QTextField, fa, formatJalali, num, useToast } from '@esp/ui';
import type { ApiClientError } from '../api/client';
import { esp07 as esp07Api } from '../api/esp07';
import { toClientError } from '../errors';
import { t } from '../i18n';
import { useLoad } from '../useLoad';

/** ADM-001 platform settings (versioned, with reason) and ADM-013 / OPS-006 service health with alerts. */
const esp07: typeof esp07Api = esp07Api;
const settings = useLoad(() => esp07.settings());
const health = useLoad(() => esp07.health());
const failure = ref<ApiClientError | null>(null);
const notice = ref('');
const draft = reactive<Record<string, string>>({});
const why = reactive<Record<string, string>>({});
const current = (key: string) => settings.data.value?.items.find((s) => s._id === key);
async function save(key: string) {
  failure.value = null;
  notice.value = '';
  try {
    let value: unknown = draft[key];
    try {
      value = JSON.parse(draft[key] ?? '');
    } catch {
      /* plain text value */
    }
    await esp07.setSetting(key, value, why[key] ?? '');
    notice.value = t('a7.saved');
    draft[key] = '';
    why[key] = '';
    await settings.load();
  } catch (e) {
    failure.value = toClientError(e);
  }
}
async function rotate() {
  failure.value = null;
  notice.value = '';
  try {
    const r = await esp07.rotateSecrets();
    notice.value = t('a7.settings.rotated', { n: fa(Number(r['totp'] ?? 0) + Number(r['partners'] ?? 0) + Number(r['webhooks'] ?? 0)) });

  } catch (e) {
    failure.value = toClientError(e);
  }
}
const mb = (b: number) => num(b / 1_048_576);

const outboxLine = computed(() => Object.entries(health.data.value?.outbox ?? {}));
const { push } = useToast();
watch(notice, (n) => { if (n) push({ tone: 'success', message: n, duration: 4000 }); });
const rotating = ref(false);
const healthStatus = (s: string) => (['healthy', 'ok', 'configured', 'available'].includes(s) ? 'ok' : ['degraded', 'test_only', 'slow'].includes(s) ? 'degraded' : ['down', 'failed', 'unavailable'].includes(s) ? 'down' : 'unconfigured') as never;
</script>

<template>
  <QContainer>
    <div class="k-stack p-aset">
      <QPageHeader compact :title="t('a7.settings.title')" :description="t('a7.settings.lead')" :breadcrumb="[{ label: t('shell.platform_admin'), href: '/admin' }, { label: t('a7.settings.title') }]" />
      <QAlert v-if="failure" tone="danger">{{ failure.message }}</QAlert>

      <QSection id="health" small :title="t('a7.health.title')">
        <template #action><QButton variant="ghost" size="sm" icon="refresh" @click="health.load">{{ t('a7.refresh') }}</QButton></template>
        <QDataState v-if="!health.data.value" :state="health.error.value ? 'error' : 'loading'" skeleton="cards" @retry="health.load" />
        <div v-else class="k-stack">
          <QOpsAlert v-for="a in health.data.value.alerts" :key="a.kind" :severity="a.level === 'critical' ? 'critical' : 'warning'" :title="a.level === 'critical' ? t('a7.ops.critical') : t('a7.ops.warn')" :detail="a.detail" />
          <QAlert v-if="!health.data.value.alerts.length" tone="success" icon="check-circle">{{ t('a7.ops.noAlerts') }}</QAlert>
          <div class="p-aset-grid">
            <QServiceHealth
              v-for="p in health.data.value.providers" :key="p.kind" :name="`${p.kind}/${p.adapter}`" :status="healthStatus(p.status)"
              :detail="p.mode === 'production' ? t('a7.health.prod') : t('a7.health.double')"
            />
          </div>
          <div class="p-aset-grid">
            <QCard>
              <div class="k-stack">
                <h3 class="h4 p-aset-h">{{ t('a7.health.queues') }}</h3>
                <ul class="p-aset-rows"><li v-for="[k, n] in outboxLine" :key="k"><QStatusBadge :state="k" /><span>{{ num(n) }}</span></li></ul>
                <QFacts dense :items="[
                  { label: t('a7.health.lag'), value: `${num(health.data.value.outboxLagSeconds)} ${t('a7.health.seconds')}` },
                  { label: t('a7.health.notif'), value: `${num(health.data.value.notifications.pending)} / ${num(health.data.value.notifications.failed)}` },
                  { label: t('a7.health.webhooks'), value: `${num(health.data.value.webhooks.pending)} / ${num(health.data.value.webhooks.dead)}` },
                ]" />
              </div>
            </QCard>
            <QCard>
              <div class="k-stack">
                <h3 class="h4 p-aset-h">{{ t('a7.health.backup') }}</h3>
                <p v-if="health.data.value.lastBackup" class="p-aset-p">{{ formatJalali(health.data.value.lastBackup.at) }} · {{ mb(health.data.value.lastBackup.sizeBytes) }} MB</p>
                <QAlert v-else tone="danger">{{ t('a7.health.noBackup') }}</QAlert>
                <h3 class="h4 p-aset-h">{{ t('a7.health.disk') }}</h3>
                <p class="p-aset-p">{{ health.data.value.disk ? `${fa(health.data.value.disk.usedPct)}% — ${mb(health.data.value.disk.freeBytes)} MB ${t('a7.health.free')}` : '—' }}</p>
              </div>
            </QCard>
            <QCard>
              <div class="k-stack">
                <h3 class="h4 p-aset-h">{{ t('a7.health.realtime') }}</h3>
                <p class="p-aset-p q-ltr">seq {{ num(health.data.value.realtime.lastSeq) }} · floor {{ num(health.data.value.realtime.floor) }}</p>
                <p class="p-aset-p">{{ formatJalali(health.data.value.realtime.lastAt) }}</p>
              </div>
            </QCard>
          </div>
        </div>
      </QSection>

      <QSection id="values" small :title="t('a7.settings.values')">
        <QDataState v-if="!settings.data.value" :state="settings.error.value ? 'error' : 'loading'" skeleton="rows" @retry="settings.load" />
        <div v-else class="k-stack">
          <QCard v-for="k in settings.data.value.keys" :key="k">
            <div class="k-stack">
              <div class="p-aset-head"><code class="q-mono q-ltr p-aset-key">{{ k }}</code><span v-if="current(k)" class="p-aset-muted">v{{ fa(current(k)!.version) }} · {{ formatJalali(current(k)!.updatedAt) }}</span></div>
              <p class="p-aset-muted">{{ t('a7.settings.current') }}: <bdi class="q-ltr">{{ current(k) ? JSON.stringify(current(k)!.value) : t('a7.settings.default') }}</bdi></p>
              <div class="p-aset-form">
                <QTextField v-model="draft[k]" :label="t('a7.settings.newValue')" ltr />
                <QTextField v-model="why[k]" :label="t('a7.reason')" />
                <QButton size="sm" variant="secondary" :disabled="!(draft[k] ?? '').trim() || (why[k] ?? '').trim().length < 5" @click="save(k)">{{ t('a7.save') }}</QButton>
              </div>
              <details v-if="current(k)?.history.length" class="p-aset-more">
                <summary>{{ t('a7.settings.history') }}</summary>
                <ul class="p-aset-log"><li v-for="(h, i) in current(k)!.history.slice().reverse()" :key="i">{{ formatJalali(h.at) }} — <bdi class="q-ltr">{{ JSON.stringify(h.value) }}</bdi> — {{ h.reason }}</li></ul>
              </details>
            </div>
          </QCard>
        </div>
      </QSection>

      <QSection id="rotate" small :title="t('a7.settings.rotateTitle')" :description="t('a7.settings.rotateLead')">
        <div><QButton variant="danger" icon="refresh" @click="rotating = true">{{ t('a7.settings.rotate') }}</QButton></div>
      </QSection>
    </div>
    <QConfirmDialog :require-reason="false"
      :open="rotating" icon="refresh" :title="t('a7.settings.rotateTitle')" :message="t('a7.settings.rotateLead')" :confirm-label="t('a7.settings.rotate')" :cancel-label="t('as.cancel')"
      @close="rotating = false" @confirm="rotating = false; rotate()"
    />
  </QContainer>
</template>

<style scoped>
.p-aset { gap: var(--space-7); }
.p-aset-h { margin: 0; }
.p-aset-p { margin: 0; font-size: 14px; }
.p-aset-grid { display: grid; gap: var(--space-4); grid-template-columns: repeat(auto-fill, minmax(min(100%, 300px), 1fr)); }
.p-aset-rows { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: var(--space-2); }
.p-aset-rows li { display: flex; justify-content: space-between; align-items: center; gap: var(--space-3); }
.p-aset-head { display: flex; flex-wrap: wrap; justify-content: space-between; gap: var(--space-3); }
.p-aset-key { font-weight: 800; }
.p-aset-muted { margin: 0; color: var(--ink-muted); font-size: 13px; }
.p-aset-form { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto; gap: var(--space-3); align-items: end; }
.p-aset-more summary { cursor: pointer; min-block-size: 44px; display: flex; align-items: center; font-weight: 700; color: var(--green-text); }
.p-aset-log { margin: 0; padding-inline-start: var(--space-5); font-size: 13px; color: var(--ink-muted); display: flex; flex-direction: column; gap: var(--space-1); }
@media (max-width: 720px) { .p-aset-form { grid-template-columns: minmax(0, 1fr); } }
</style>
