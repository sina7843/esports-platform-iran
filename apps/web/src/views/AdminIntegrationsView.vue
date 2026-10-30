<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { QAlert, QBadge, QButton, QCard, QCheckbox, QCode, QConfirmDialog, QContainer, QDataState, QPageHeader, QSection, QSelect, QStatusBadge, QTextField, fa, formatJalali, num, useToast } from '@esp/ui';
import type { ApiClientError } from '../api/client';
import { esp07 as esp07Api } from '../api/esp07';
import { toClientError } from '../errors';
import { t } from '../i18n';
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
const { push } = useToast();
watch(notice, (n) => { if (n) push({ tone: 'success', message: n, duration: 3000 }); });
const iranian = computed({ get: () => p.iranian, set: (v: boolean | null) => { p.iranian = !!v; } });
const selfHosted = computed({ get: () => p.selfHosted, set: (v: boolean | null) => { p.selfHosted = !!v; } });
const quota = computed({ get: () => String(c.quota), set: (v: string) => { c.quota = Number(v) || 1; } });
const toggleScope = (s: string, on: boolean | null) => { c.scopes = on ? [...new Set([...c.scopes, s])] : c.scopes.filter((x) => x !== s); };
const revoking = ref<string | null>(null);
const state = (l: { loading: { value: boolean }; error: { value: ApiClientError | null }; data: { value: { items: unknown[] } | null } }) =>
  (l.error.value ? 'error' : !l.data.value ? 'loading' : l.data.value && !l.data.value.items.length ? 'empty' : 'content');
</script>

<template>
  <QContainer>
    <div class="k-stack p-int">
      <QPageHeader compact :title="t('a7.int.title')" :description="t('a7.int.lead')" :breadcrumb="[{ label: t('shell.platform_admin'), href: '/admin' }, { label: t('a7.int.title') }]" />
      <QAlert v-if="failure" tone="danger">{{ failure.message }}</QAlert>
      <QAlert v-if="secret" tone="warning" icon="lock" :title="t('a7.int.secretOnce')" :actions="[{ label: t('a7.int.hide'), onClick: () => (secret = null) }]">
        <div class="k-stack"><QCode v-if="secret.keyId" copy>{{ secret.keyId }}</QCode><QCode copy>{{ secret.secret }}</QCode></div>
      </QAlert>

      <QSection id="readiness" small :title="t('a7.int.readiness')">
        <template #action><QButton variant="ghost" size="sm" icon="refresh" @click="readiness.load">{{ t('a7.refresh') }}</QButton></template>
        <QDataState v-if="!readiness.data.value" :state="readiness.error.value ? 'error' : 'loading'" skeleton="rows" @retry="readiness.load" />
        <div v-else class="k-stack">
          <QAlert :tone="readiness.data.value.ready ? 'success' : 'danger'" :title="readiness.data.value.ready ? t('a7.int.ready') : t('a7.int.notReady')" />
          <QCard padding="none">
            <ul class="p-int-rows">
              <li v-for="r in readiness.data.value.rows" :key="r.kind">
                <div class="p-int-head">
                  <code class="q-mono q-ltr">{{ r.kind }}</code>
                  <span class="k-row">
                    <QBadge :tone="r.ready ? 'success' : 'danger'" :icon="r.ready ? 'check' : 'x'">{{ r.ready ? t('a7.int.ready') : t('a7.int.notReady') }}</QBadge>
                    <QBadge v-if="r.optional" tone="neutral">{{ t('a7.int.optional') }}</QBadge>
                    <bdi v-if="r.provider">{{ r.provider.name }}</bdi><span v-else class="p-int-muted">{{ t('a7.int.noProvider') }}</span>
                  </span>
                </div>
                <ul v-if="r.blockers.length" class="p-int-bad"><li v-for="b in r.blockers" :key="b">{{ blocker(b) }}</li></ul>
                <p v-if="r.keys.length" class="p-int-muted">{{ t('a7.int.keys') }}: <span v-for="k in r.keys" :key="k.name" class="q-ltr">{{ k.name }}={{ k.set ? t('a7.int.keySet') : t('a7.int.keyMissing') }} </span></p>
              </li>
            </ul>
          </QCard>
        </div>
      </QSection>

      <QSection id="providers" small :title="t('a7.int.providers')" :description="t('a7.int.providersLead')">
        <div class="k-stack">
          <QDataState v-if="state(providers) !== 'content'" :state="state(providers) as never" skeleton="rows" @retry="providers.load" />
          <QCard v-for="x in providers.data.value?.items ?? []" :key="x._id">
            <div class="k-stack">
              <div class="p-int-head">
                <span><QBadge tone="neutral">{{ x.category }}</QBadge> <bdi><strong>{{ x.name }}</strong></bdi> <QBadge v-if="x.iranian" tone="green">{{ t('a7.int.iranian') }}</QBadge> <QBadge v-if="x.selfHosted" tone="info">{{ t('a7.int.selfHosted') }}</QBadge></span>
                <QStatusBadge :state="x.state" />
              </div>
              <p class="p-int-muted">{{ t('a7.int.test') }}: <QStatusBadge :state="x.evaluation.result" /> · {{ t('a7.int.contract') }}: <bdi>{{ x.evaluation.contractRef ?? '—' }}</bdi> · <bdi class="q-ltr">{{ x.origins.join(' ') }}</bdi></p>
              <div class="k-row">
                <QButton size="sm" variant="green" @click="act(() => esp07.decideProvider(x._id, 'selected'), [providers.load, allow.load, readiness.load])">{{ t('a7.int.select') }}</QButton>
                <QButton size="sm" variant="secondary" @click="act(() => esp07.decideProvider(x._id, 'rejected'), [providers.load, allow.load])">{{ t('a7.int.rejectProvider') }}</QButton>
                <QButton size="sm" variant="ghost" @click="act(() => esp07.decideProvider(x._id, 'retired'), [providers.load, allow.load, readiness.load])">{{ t('a7.int.retire') }}</QButton>
              </div>
            </div>
          </QCard>
          <p class="p-int-muted">{{ t('a7.int.allowlist') }}: <bdi class="q-ltr">{{ allow.data.value?.origins.join(' · ') || '—' }}</bdi></p>
          <QCard>
            <form class="k-stack" novalidate @submit.prevent="saveProvider">
              <h3 class="h4 p-int-h">{{ t('a7.int.addProvider') }}</h3>
              <div class="p-int-grid">
                <QSelect id="pv-c" v-model="p.category" :label="t('a7.int.category')" :options="CATS.map((k) => ({ value: k, label: k }))" />
                <QTextField id="pv-n" v-model="p.name" :label="t('a7.int.name')" />
                <QTextField id="pv-o" v-model="p.origins" :label="t('a7.int.origins')" :hint="t('a7.int.originsHint')" ltr />
                <QTextField id="pv-k" v-model="p.keys" :label="t('a7.int.keyNames')" :hint="t('a7.int.keyNamesHint')" ltr />
                <QTextField id="pv-q" v-model="p.perMinute" :label="t('a7.int.quota')" input-mode="numeric" ltr />
                <QSelect id="pv-r" v-model="p.result" :label="t('a7.int.test')" :options="['not_tested', 'passed', 'failed'].map((r) => ({ value: r, label: r }))" />
              </div>
              <div class="k-row"><QCheckbox v-model="iranian" :label="t('a7.int.iranian')" /><QCheckbox v-model="selfHosted" :label="t('a7.int.selfHosted')" /></div>
              <div class="p-int-grid">
                <QTextField id="pv-cap" v-model="p.capabilities" :label="t('a7.int.capabilities')" />
                <QTextField id="pv-l" v-model="p.limits" :label="t('a7.int.limits')" />
                <QTextField id="pv-cost" v-model="p.costNote" :label="t('a7.int.cost')" />
                <QTextField id="pv-ct" v-model="p.contractRef" :label="t('a7.int.contract')" />
                <QTextField id="pv-ex" v-model="p.exitPlan" :label="t('a7.int.exitPlan')" />
              </div>
              <div><QButton type="submit" variant="secondary" :disabled="p.name.trim().length < 2">{{ t('a7.save') }}</QButton></div>
            </form>
          </QCard>
        </div>
      </QSection>

      <QSection id="partners" small :title="t('a7.int.partners')" :description="t('a7.int.partnersLead')">
        <div class="k-stack">
          <QDataState v-if="state(partners) !== 'content'" :state="state(partners) as never" skeleton="rows" @retry="partners.load" />
          <QCard v-for="x in partners.data.value?.items ?? []" :key="x._id">
            <div class="k-stack">
              <div class="p-int-head"><span><strong><bdi>{{ x.name }}</bdi></strong> <code class="q-mono q-ltr">{{ x.keyId }}</code></span><QStatusBadge :state="x.revokedAt ? 'revoked' : 'active'" /></div>
              <p class="p-int-muted q-ltr">{{ x.scopes.join(' ') }} · {{ num(x.quotaPerMinute) }}/min</p>
              <p class="p-int-muted">{{ t('a7.int.lastUsed') }}: {{ formatJalali(x.lastUsedAt) }}</p>
              <div v-if="!x.revokedAt" class="k-row">
                <QButton size="sm" variant="secondary" icon="refresh" @click="act(async () => { const r = await esp07.rotatePartner(x._id); secret = { secret: r.secret }; }, [partners.load])">{{ t('a7.int.rotate') }}</QButton>
                <QButton size="sm" variant="danger" @click="revoking = x._id">{{ t('a7.int.revoke') }}</QButton>
              </div>
            </div>
          </QCard>
          <QCard>
            <form class="k-stack" novalidate @submit.prevent="createPartner">
              <div class="p-int-grid">
                <QTextField id="pt-n" v-model="c.name" :label="t('a7.int.name')" />
                <QTextField id="pt-q" v-model="quota" :label="t('a7.int.quota')" type="number" ltr />
                <QTextField id="pt-e" v-model="c.eventIds" :label="t('a7.int.eventIds')" :hint="t('a7.int.eventIdsHint')" ltr />
              </div>
              <fieldset class="p-int-set">
                <legend>{{ t('a7.int.scopes') }}</legend>
                <QCheckbox v-for="s in SCOPES" :key="s" :model-value="c.scopes.includes(s)" :label="s" @update:model-value="(v) => toggleScope(s, v)" />
              </fieldset>
              <div><QButton type="submit" variant="green" icon="plus" :disabled="c.name.trim().length < 3 || !c.scopes.length">{{ t('a7.int.createPartner') }}</QButton></div>
            </form>
          </QCard>
        </div>
      </QSection>

      <QSection id="dead" small :title="t('a7.int.dead')">
        <QDataState v-if="state(dead) !== 'content'" :state="state(dead) as never" skeleton="rows" @retry="dead.load" />
        <QCard v-else>
          <ul class="p-int-rows">
            <li v-for="d in dead.data.value!.items" :key="d._id" class="p-int-head">
              <span><bdi class="q-ltr">{{ d.type }}</bdi> — {{ fa(d.attempts) }} — <span class="p-int-err">{{ d.lastError }}</span></span>
              <QButton size="sm" variant="secondary" icon="refresh" @click="act(() => esp07.replayDelivery(d._id), [dead.load])">{{ t('a7.int.replay') }}</QButton>
            </li>
          </ul>
        </QCard>
      </QSection>
    </div>
    <QConfirmDialog
      :open="!!revoking" :require-reason="false" :title="t('a7.int.revoke')" :message="t('ai.revokeBody')" :confirm-label="t('a7.int.revoke')" :cancel-label="t('common.cancel')"
      @close="revoking = null" @confirm="() => { const id = revoking; revoking = null; if (id) act(() => esp07.revokePartner(id), [partners.load]); }"
    />
  </QContainer>
</template>

<style scoped>
.p-int { gap: var(--space-7); }
.p-int-h { margin: 0; }
.p-int-rows { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; }
.p-int-rows > li { display: flex; flex-direction: column; gap: var(--space-2); padding: var(--space-3) var(--space-4); border-block-end: 1px solid var(--line); }
.p-int-head { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: var(--space-3); }
.p-int-rows > li.p-int-head { flex-direction: row; }
.p-int-muted { margin: 0; color: var(--ink-muted); font-size: 13px; }
.p-int-bad { margin: 0; padding-inline-start: var(--space-5); color: var(--danger-text); font-size: 13px; }
.p-int-err { color: var(--danger-text); font-size: 13px; }
.p-int-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 200px), 1fr)); gap: var(--space-4); }
.p-int-set { margin: 0; padding: var(--space-4); border: 1px solid var(--line); border-radius: var(--radius-md); display: flex; flex-wrap: wrap; gap: var(--space-3) var(--space-5); }
.p-int-set legend { padding-inline: var(--space-2); font-weight: 800; }
</style>
