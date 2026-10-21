<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import type { ApiClientError } from '../api/client';
import { esp07 as esp07Api } from '../api/esp07';
import DataState from '../components/DataState.vue';
import ErrorNote from '../components/ErrorNote.vue';
import JalaliDate from '../components/JalaliDate.vue';
import PageHeader from '../components/PageHeader.vue';
import StatusBadge from '../components/StatusBadge.vue';
import { toClientError } from '../errors';
import { num, t } from '../i18n';
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
    notice.value = t('a7.settings.rotated', { n: num(Number(r['totp'] ?? 0) + Number(r['partners'] ?? 0) + Number(r['webhooks'] ?? 0)) });
  } catch (e) {
    failure.value = toClientError(e);
  }
}
const mb = (b: number) => num(Math.round(b / 1_048_576));
const outboxLine = computed(() => Object.entries(health.data.value?.outbox ?? {}));
</script>

<template>
  <PageHeader :title="t('a7.settings.title')" :lead="t('a7.settings.lead')" />
  <ErrorNote :error="failure" />
  <p v-if="notice" role="status" class="ok">{{ notice }}</p>

  <section class="block" aria-labelledby="hl-h">
    <div class="row between"><h2 id="hl-h">{{ t('a7.health.title') }}</h2><button type="button" class="btn btn-sm" @click="health.load">{{ t('a7.refresh') }}</button></div>
    <DataState :loading="health.loading.value && !health.data.value" :error="health.error.value" @retry="health.load">
      <template v-if="health.data.value">
        <div v-if="health.data.value.alerts.length" class="card" role="alert"><ul class="plain stack"><li v-for="a in health.data.value.alerts" :key="a.kind" :class="a.level"><strong>{{ a.level === 'critical' ? t('a7.ops.critical') : t('a7.ops.warn') }}</strong> — {{ a.detail }}</li></ul></div>
        <p v-else class="ok" role="status">{{ t('a7.ops.noAlerts') }}</p>
        <div class="grid block">
          <section class="card stack"><h3>{{ t('a7.health.providers') }}</h3><ul class="plain"><li v-for="p in health.data.value.providers" :key="p.kind"><bdi class="ltr">{{ p.kind }}/{{ p.adapter }}</bdi> <StatusBadge :state="p.status" /> <span class="muted small">{{ p.mode === 'production' ? t('a7.health.prod') : t('a7.health.double') }}</span></li></ul></section>
          <section class="card stack"><h3>{{ t('a7.health.queues') }}</h3><ul class="plain"><li v-for="[k, n] in outboxLine" :key="k"><StatusBadge :state="k" /> {{ num(n) }}</li></ul><p class="small">{{ t('a7.health.lag') }}: {{ num(health.data.value.outboxLagSeconds) }} {{ t('a7.health.seconds') }}</p><p class="small">{{ t('a7.health.notif') }}: {{ num(health.data.value.notifications.pending) }} / {{ num(health.data.value.notifications.failed) }}</p><p class="small">{{ t('a7.health.webhooks') }}: {{ num(health.data.value.webhooks.pending) }} / {{ num(health.data.value.webhooks.dead) }}</p></section>
          <section class="card stack"><h3>{{ t('a7.health.backup') }}</h3><p v-if="health.data.value.lastBackup"><JalaliDate :iso="health.data.value.lastBackup.at" /> · {{ mb(health.data.value.lastBackup.sizeBytes) }} MB</p><p v-else class="bad">{{ t('a7.health.noBackup') }}</p><h3>{{ t('a7.health.disk') }}</h3><p v-if="health.data.value.disk">{{ num(health.data.value.disk.usedPct) }}% — {{ mb(health.data.value.disk.freeBytes) }} MB {{ t('a7.health.free') }}</p><p v-else class="muted">—</p></section>
          <section class="card stack"><h3>{{ t('a7.health.realtime') }}</h3><p class="small">seq {{ num(health.data.value.realtime.lastSeq) }} · floor {{ num(health.data.value.realtime.floor) }}</p><p class="small"><JalaliDate :iso="health.data.value.realtime.lastAt" /></p></section>
        </div>
      </template>
    </DataState>
  </section>

  <section class="block" aria-labelledby="sg-h">
    <h2 id="sg-h">{{ t('a7.settings.values') }}</h2>
    <DataState :loading="settings.loading.value" :error="settings.error.value" @retry="settings.load">
      <ul v-if="settings.data.value" class="plain stack">
        <li v-for="k in settings.data.value.keys" :key="k" class="card stack">
          <div class="row between"><strong class="ltr">{{ k }}</strong><span v-if="current(k)" class="small muted">v{{ num(current(k)!.version) }} · <JalaliDate :iso="current(k)!.updatedAt" /></span></div>
          <p class="small">{{ t('a7.settings.current') }}: <bdi class="ltr">{{ current(k) ? JSON.stringify(current(k)!.value) : t('a7.settings.default') }}</bdi></p>
          <div class="row">
            <input v-model="draft[k]" class="input ltr" :placeholder="t('a7.settings.newValue')" :aria-label="t('a7.settings.newValue')" />
            <input v-model="why[k]" class="input" dir="auto" :placeholder="t('a7.reason')" :aria-label="t('a7.reason')" />
            <button type="button" class="btn btn-sm" :disabled="!(draft[k] ?? '').trim() || (why[k] ?? '').trim().length < 5" @click="save(k)">{{ t('a7.save') }}</button>
          </div>
          <details v-if="current(k)?.history.length"><summary>{{ t('a7.settings.history') }}</summary><ul class="small"><li v-for="(h, i) in current(k)!.history.slice().reverse()" :key="i"><JalaliDate :iso="h.at" /> — <bdi class="ltr">{{ JSON.stringify(h.value) }}</bdi> — {{ h.reason }}</li></ul></details>
        </li>
      </ul>
    </DataState>
  </section>

  <section class="card stack block" aria-labelledby="rk-h">
    <h2 id="rk-h">{{ t('a7.settings.rotateTitle') }}</h2>
    <p class="muted small">{{ t('a7.settings.rotateLead') }}</p>
    <div><button type="button" class="btn" @click="rotate">{{ t('a7.settings.rotate') }}</button></div>
  </section>
</template>

<style scoped>
section { min-block-size: 10rem; } /* reserve space while data loads (CLS) */
.row { display: flex; flex-wrap: wrap; gap: var(--sp-2); align-items: center; }
.between { justify-content: space-between; }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr)); gap: var(--sp-3); align-items: start; }
.plain { list-style: none; margin: 0; padding: 0; }
.block { margin-block-start: var(--sp-4); }
.critical, .bad { color: var(--danger, #b00020); }
.warn { color: var(--warn); }
.ok { color: var(--ok); }
.small { font-size: var(--fs-xs); }
h2, h3, p { margin: 0; }
</style>
