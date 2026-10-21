<script setup lang="ts">
import { reactive, ref } from 'vue';
import type { ApiClientError } from '../api/client';
import { esp07 as esp07Api } from '../api/esp07';
import KavenegarPanel from '../components/KavenegarPanel.vue';
import DataState from '../components/DataState.vue';
import ErrorNote from '../components/ErrorNote.vue';
import FormField from '../components/FormField.vue';
import JalaliDate from '../components/JalaliDate.vue';
import PageHeader from '../components/PageHeader.vue';
import StatusBadge from '../components/StatusBadge.vue';
import { toClientError } from '../errors';
import { num, t } from '../i18n';
import { useLoad } from '../useLoad';

/**
 * INTG-001..009: provider registry with evaluation (capabilities, limits, cost, contract, exit plan, test result),
 * selection rules and network allowlist, production readiness checklist, partner API clients (secrets shown once)
 * and the webhook dead-letter queue.
 */
const esp07: typeof esp07Api = esp07Api;
const providers = useLoad(() => esp07.providers());
const readiness = useLoad(() => esp07.readiness());
const allow = useLoad(() => esp07.allowlist());
const partners = useLoad(() => esp07.partners());
const dead = useLoad(() => esp07.deliveries('dead'));
const failure = ref<ApiClientError | null>(null);
const notice = ref('');
const secret = ref<{ keyId?: string; secret: string } | null>(null);
async function act(fn: () => Promise<unknown>, reload: Array<() => Promise<void>> = [], ok = t('a7.saved')) {
  failure.value = null;
  notice.value = '';
  try {
    await fn();
    notice.value = ok;
    for (const r of reload) await r();
  } catch (e) {
    failure.value = toClientError(e);
  }
}
/** Server blockers are stable English sentences; show them in the user's language. */
function blocker(b: string): string {
  if (b.startsWith('no provider selected')) return t('a7.int.b.noProvider');
  if (b.startsWith('a development double')) return t('a7.int.b.double');
  const h = /^health: (\w+)/.exec(b);
  if (h) return t('a7.int.b.health', { s: h[1] ?? '' });
  const e = /^environment variable (\S+) is not set/.exec(b);
  if (e) return t('a7.int.b.env', { n: e[1] ?? '' });
  return b;
}
const CATS = ['sms', 'payment', 'storage', 'cdn', 'video', 'email', 'map', 'search', 'analytics', 'errors', 'metrics', 'push', 'publisher'];
const p = reactive({ id: '', category: 'sms', name: '', origins: '', iranian: true, selfHosted: false, capabilities: '', limits: '', costNote: '', contractRef: '', exitPlan: '', result: 'not_tested', keys: '', perMinute: '' });
function kavenegarPreset() {
  if (providers.data.value?.items.some(x => x.category === 'sms' && x.origins.includes('https://api.kavenegar.com'))) {
    notice.value = t('sms.alreadyAdded'); return;
  }
  Object.assign(p, { id: 'prv_kavenegar', category: 'sms', name: 'کاوه‌نگار / Kavenegar', origins: 'https://api.kavenegar.com', iranian: true, selfHosted: false,
    capabilities: 'OTP, Verify Lookup, Transactional SMS, Delivery status', keys: 'KAVENEGAR_API_KEY KAVENEGAR_OTP_TEMPLATE', result: 'not_tested', contractRef: '', limits: '', costNote: '', exitPlan: '', perMinute: '' });
  notice.value = t('sms.presetNote');
  document.getElementById('pv-n')?.focus();
}
const saveProvider = () =>
  act(async () => {
    await esp07.saveProvider({
      ...(p.id ? { id: p.id } : {}), category: p.category, name: p.name, origins: p.origins.split(/[\s,]+/).filter(Boolean), iranian: p.iranian, selfHosted: p.selfHosted, publisherException: null,
      evaluation: { capabilities: p.capabilities.split(/[,،]+/).map((x) => x.trim()).filter(Boolean), limits: p.limits, costNote: p.costNote, contractRef: p.contractRef || null, exitPlan: p.exitPlan, result: p.result },
      keyEnvNames: p.keys.split(/[\s,]+/).filter(Boolean), quota: { perMinute: p.perMinute ? Number(p.perMinute) : null, perDay: null },
    });
    p.id = '';
  }, [providers.load, allow.load, readiness.load]);
const c = reactive({ name: '', scopes: ['events:read', 'results:read'] as string[], eventIds: '', quota: 60 });
const SCOPES = ['events:read', 'results:read', 'news:read', 'webhooks:manage'];
const createPartner = () =>
  act(async () => {
    const r = await esp07.createPartner({ name: c.name, scopes: c.scopes, eventIds: c.eventIds.split(/[\s,]+/).filter(Boolean), quotaPerMinute: c.quota });
    secret.value = { keyId: r.keyId, secret: r.secret };
  }, [partners.load]);
</script>

<template>
  <PageHeader :title="t('a7.int.title')" :lead="t('a7.int.lead')" />
  <ErrorNote :error="failure" />
  <p v-if="notice" role="status" class="ok">{{ notice }}</p>
  <p v-if="secret" class="warn card" role="alert">{{ t('a7.int.secretOnce') }} <code class="ltr">{{ secret.keyId }}</code> <code class="ltr">{{ secret.secret }}</code> <button type="button" class="btn btn-sm" @click="secret = null">{{ t('a7.int.hide') }}</button></p>

  <KavenegarPanel @preset="kavenegarPreset" />

  <section class="card stack" aria-labelledby="rd-h">
    <div class="row between"><h2 id="rd-h">{{ t('a7.int.readiness') }}</h2><button type="button" class="btn btn-sm" @click="readiness.load">{{ t('a7.refresh') }}</button></div>
    <DataState :loading="readiness.loading.value" :error="readiness.error.value" @retry="readiness.load">
      <template v-if="readiness.data.value">
        <p :class="readiness.data.value.ready ? 'ok' : 'bad'" role="status"><strong>{{ readiness.data.value.ready ? t('a7.int.ready') : t('a7.int.notReady') }}</strong></p>
        <ul class="plain stack">
          <li v-for="r in readiness.data.value.rows" :key="r.kind" class="item">
            <div class="row between"><strong class="ltr">{{ r.kind }}</strong><span class="row small"><StatusBadge :state="r.ready ? 'ok' : 'failed'" /> <span v-if="r.optional" class="muted">{{ t('a7.int.optional') }}</span> <bdi v-if="r.provider">{{ r.provider.name }}</bdi><span v-else class="muted">{{ t('a7.int.noProvider') }}</span></span></div>
            <ul v-if="r.blockers.length" class="small bad"><li v-for="b in r.blockers" :key="b">{{ blocker(b) }}</li></ul>
            <p v-if="r.keys.length" class="small">{{ t('a7.int.keys') }}: <span v-for="k in r.keys" :key="k.name" class="ltr">{{ k.name }}={{ k.set ? t('a7.int.keySet') : t('a7.int.keyMissing') }} </span></p>
          </li>
        </ul>
      </template>
    </DataState>
  </section>

  <section class="card stack block" aria-labelledby="pv-h">
    <h2 id="pv-h">{{ t('a7.int.providers') }}</h2>
    <p class="muted small">{{ t('a7.int.providersLead') }}</p>
    <DataState :loading="providers.loading.value" :error="providers.error.value" :empty="!!providers.data.value && providers.data.value.items.length === 0" @retry="providers.load">
      <ul v-if="providers.data.value" class="plain stack">
        <li v-for="x in providers.data.value.items" :key="x._id" class="item stack">
          <div class="row between"><span><strong>{{ x.category }}</strong> — <bdi>{{ x.name }}</bdi> <span class="small muted">{{ x.iranian ? t('a7.int.iranian') : '' }} {{ x.selfHosted ? t('a7.int.selfHosted') : '' }}</span></span><StatusBadge :state="x.state" /></div>
          <p class="small">{{ t('a7.int.test') }}: <StatusBadge :state="x.evaluation.result" /> · {{ t('a7.int.contract') }}: <bdi>{{ x.evaluation.contractRef ?? '—' }}</bdi> · <bdi class="ltr">{{ x.origins.join(' ') }}</bdi></p>
          <div class="row">
            <button type="button" class="btn btn-sm btn-primary" @click="act(() => esp07.decideProvider(x._id, 'selected'), [providers.load, allow.load, readiness.load])">{{ t('a7.int.select') }}</button>
            <button type="button" class="btn btn-sm" @click="act(() => esp07.decideProvider(x._id, 'rejected'), [providers.load, allow.load])">{{ t('a7.int.rejectProvider') }}</button>
            <button type="button" class="btn btn-sm" @click="act(() => esp07.decideProvider(x._id, 'retired'), [providers.load, allow.load, readiness.load])">{{ t('a7.int.retire') }}</button>
          </div>
        </li>
      </ul>
    </DataState>
    <p class="small">{{ t('a7.int.allowlist') }}: <bdi class="ltr">{{ allow.data.value?.origins.join(' · ') || '—' }}</bdi></p>
    <form class="stack" @submit.prevent="saveProvider">
      <h3>{{ t('a7.int.addProvider') }}</h3>
      <div class="grid">
        <FormField id="pv-c" :label="t('a7.int.category')"><template #default="{ id: fid }"><select :id="fid" v-model="p.category" class="input"><option v-for="k in CATS" :key="k" :value="k">{{ k }}</option></select></template></FormField>
        <FormField id="pv-n" :label="t('a7.int.name')"><template #default="{ id: fid }"><input :id="fid" v-model="p.name" class="input" dir="auto" /></template></FormField>
        <FormField id="pv-o" :label="t('a7.int.origins')" :hint="t('a7.int.originsHint')"><template #default="{ id: fid, describedBy }"><input :id="fid" v-model="p.origins" class="input ltr" :aria-describedby="describedBy" /></template></FormField>
        <FormField id="pv-k" :label="t('a7.int.keyNames')" :hint="t('a7.int.keyNamesHint')"><template #default="{ id: fid, describedBy }"><input :id="fid" v-model="p.keys" class="input ltr" :aria-describedby="describedBy" /></template></FormField>
        <FormField id="pv-q" :label="t('a7.int.quota')"><template #default="{ id: fid }"><input :id="fid" v-model="p.perMinute" class="input ltr" inputmode="numeric" /></template></FormField>
        <FormField id="pv-r" :label="t('a7.int.test')"><template #default="{ id: fid }"><select :id="fid" v-model="p.result" class="input"><option v-for="r in ['not_tested', 'passed', 'failed']" :key="r" :value="r">{{ r }}</option></select></template></FormField>
      </div>
      <div class="row"><label><input v-model="p.iranian" type="checkbox" /> {{ t('a7.int.iranian') }}</label><label><input v-model="p.selfHosted" type="checkbox" /> {{ t('a7.int.selfHosted') }}</label></div>
      <div class="grid">
        <FormField id="pv-cap" :label="t('a7.int.capabilities')"><template #default="{ id: fid }"><input :id="fid" v-model="p.capabilities" class="input" dir="auto" /></template></FormField>
        <FormField id="pv-l" :label="t('a7.int.limits')"><template #default="{ id: fid }"><input :id="fid" v-model="p.limits" class="input" dir="auto" /></template></FormField>
        <FormField id="pv-cost" :label="t('a7.int.cost')"><template #default="{ id: fid }"><input :id="fid" v-model="p.costNote" class="input" dir="auto" /></template></FormField>
        <FormField id="pv-ct" :label="t('a7.int.contract')"><template #default="{ id: fid }"><input :id="fid" v-model="p.contractRef" class="input" dir="auto" /></template></FormField>
        <FormField id="pv-ex" :label="t('a7.int.exitPlan')"><template #default="{ id: fid }"><input :id="fid" v-model="p.exitPlan" class="input" dir="auto" /></template></FormField>
      </div>
      <div><button type="submit" class="btn" :disabled="p.name.trim().length < 2">{{ t('a7.save') }}</button></div>
    </form>
  </section>

  <section class="card stack block" aria-labelledby="pt-h">
    <h2 id="pt-h">{{ t('a7.int.partners') }}</h2>
    <p class="muted small">{{ t('a7.int.partnersLead') }}</p>
    <DataState :loading="partners.loading.value" :error="partners.error.value" :empty="!!partners.data.value && partners.data.value.items.length === 0" @retry="partners.load">
      <ul v-if="partners.data.value" class="plain stack">
        <li v-for="x in partners.data.value.items" :key="x._id" class="item stack">
          <div class="row between"><span><strong><bdi>{{ x.name }}</bdi></strong> <code class="ltr small">{{ x.keyId }}</code></span><StatusBadge :state="x.revokedAt ? 'revoked' : 'active'" /></div>
          <p class="small ltr">{{ x.scopes.join(' ') }} · {{ num(x.quotaPerMinute) }}/min</p>
          <p class="small">{{ t('a7.int.lastUsed') }}: <JalaliDate :iso="x.lastUsedAt" /></p>
          <div v-if="!x.revokedAt" class="row">
            <button type="button" class="btn btn-sm" @click="act(async () => { const r = await esp07.rotatePartner(x._id); secret = { secret: r.secret }; }, [partners.load])">{{ t('a7.int.rotate') }}</button>
            <button type="button" class="btn btn-sm" @click="act(() => esp07.revokePartner(x._id), [partners.load])">{{ t('a7.int.revoke') }}</button>
          </div>
        </li>
      </ul>
    </DataState>
    <form class="stack" @submit.prevent="createPartner">
      <div class="grid">
        <FormField id="pt-n" :label="t('a7.int.name')"><template #default="{ id: fid }"><input :id="fid" v-model="c.name" class="input" dir="auto" /></template></FormField>
        <FormField id="pt-q" :label="t('a7.int.quota')"><template #default="{ id: fid }"><input :id="fid" v-model.number="c.quota" type="number" min="1" max="6000" class="input ltr" /></template></FormField>
        <FormField id="pt-e" :label="t('a7.int.eventIds')" :hint="t('a7.int.eventIdsHint')"><template #default="{ id: fid, describedBy }"><input :id="fid" v-model="c.eventIds" class="input ltr" :aria-describedby="describedBy" /></template></FormField>
      </div>
      <fieldset class="row"><legend>{{ t('a7.int.scopes') }}</legend><label v-for="s in SCOPES" :key="s"><input v-model="c.scopes" type="checkbox" :value="s" /> <span class="ltr">{{ s }}</span></label></fieldset>
      <div><button type="submit" class="btn" :disabled="c.name.trim().length < 3 || !c.scopes.length">{{ t('a7.int.createPartner') }}</button></div>
    </form>
  </section>

  <section class="card stack block" aria-labelledby="dl-h">
    <h2 id="dl-h">{{ t('a7.int.dead') }}</h2>
    <DataState :loading="dead.loading.value" :error="dead.error.value" :empty="!!dead.data.value && dead.data.value.items.length === 0" @retry="dead.load">
      <ul v-if="dead.data.value" class="plain stack"><li v-for="d in dead.data.value.items" :key="d._id" class="row between"><span><bdi class="ltr">{{ d.type }}</bdi> — {{ num(d.attempts) }} — <span class="bad small">{{ d.lastError }}</span></span><button type="button" class="btn btn-sm" @click="act(() => esp07.replayDelivery(d._id), [dead.load])">{{ t('a7.int.replay') }}</button></li></ul>
    </DataState>
  </section>
</template>

<style scoped>
section { min-block-size: 10rem; } /* reserve space while data loads (CLS) */
.row { display: flex; flex-wrap: wrap; gap: var(--sp-2); align-items: center; }
.between { justify-content: space-between; }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr)); gap: var(--sp-2); align-items: end; }
.plain { list-style: none; margin: 0; padding: 0; }
.block { margin-block-start: var(--sp-4); }
.item { border-block-end: 1px solid var(--border); padding-block: var(--sp-2); }
fieldset { border: 0; padding: 0; margin: 0; }
code { word-break: break-all; }
.small { font-size: var(--fs-xs); }
.bad { color: var(--danger, #b00020); }
.warn { color: var(--warn); }
.ok { color: var(--ok); }
h2, h3, p { margin: 0; }
</style>
