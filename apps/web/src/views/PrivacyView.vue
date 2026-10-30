<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { QAlert, QBadge, QButton, QCard, QCheckbox, QConfirmDialog, QContainer, QDataState, QPageHeader, QSection, QStatusBadge, QSwitch, QTextField, fa, formatJalali, useToast } from '@esp/ui';
import type { ApiClientError } from '../api/client';
import { esp07 as esp07Api, type Obj } from '../api/esp07';
import { toClientError } from '../errors';
import { t } from '../i18n';
import { useLoad } from '../useLoad';

/**
 * ADM-012 for the account holder: accept the current terms/privacy text, withdraw optional consents, export my data
 * (immediate), request correction or deletion (deletion waits while a legal hold or open case applies), and appeal a
 * moderation decision about my content (ADM-009).
 */
const esp07: typeof esp07Api = esp07Api;
const pending = useLoad(() => esp07.legalPending());
const consents = useLoad(() => esp07.consents());
const requests = useLoad(() => esp07.myRequests());
const marketing = useLoad(() => esp07.legal('consent_marketing'));
const failure = ref<ApiClientError | null>(null);
const notice = ref('');
async function act(fn: () => Promise<unknown>, reload: Array<() => Promise<void>>, ok = t('a7.saved')) {
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
const detail = reactive({ correction: '', deletion: '' });
const confirmDelete = ref(false);
function download(data: Obj) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'my-data.json';
  a.click();
  URL.revokeObjectURL(url);
}
const exportNow = () =>
  act(async () => {
    const r = await esp07.createRequest('export', '');
    if (r.export) download(r.export);
  }, [requests.load], t('a7.me.exported'));
const appealId = ref('');
const appealText = ref('');
const activeMarketing = () => consents.data.value?.items.some((c) => c.kind === 'consent_marketing' && !c.withdrawnAt) ?? false;
const { push } = useToast();
watch(notice, (n) => { if (n) push({ tone: 'success', message: n, duration: 4000 }); });
const marketingOn = computed(() => activeMarketing());
function toggleMarketing(v: boolean | null) {
  if (v && marketing.data.value) void act(() => esp07.accept('consent_marketing', marketing.data.value!.version), [consents.load]);
  else if (!v) void act(() => esp07.withdraw('consent_marketing'), [consents.load]);
}
const deleteOk = computed({ get: () => confirmDelete.value, set: (v: boolean | null) => { confirmDelete.value = !!v; } });
const askDelete = ref(false);
const sendDeletion = () => act(async () => { await esp07.createRequest('deletion', detail.deletion); detail.deletion = ''; confirmDelete.value = false; askDelete.value = false; }, [requests.load], t('a7.me.requested'));
const sendCorrection = () => act(async () => { await esp07.createRequest('correction', detail.correction); detail.correction = ''; }, [requests.load], t('a7.me.requested'));
const sendAppeal = () => act(async () => { await esp07.appeal(appealId.value, appealText.value); appealId.value = ''; appealText.value = ''; }, [], t('a7.me.appealed'));
</script>

<template>
  <QContainer>
    <div class="k-stack p-priv">
      <QPageHeader compact :title="t('a7.me.title')" :description="t('a7.me.lead')" />
      <QAlert v-if="failure" tone="danger">{{ failure.message }}</QAlert>

      <QSection id="pending" small :title="t('a7.me.pending')">
        <QCard>
          <QDataState v-if="pending.error.value || (pending.loading.value && !pending.data.value)" :state="pending.error.value ? 'error' : 'loading'" skeleton="rows" @retry="pending.load" />
          <p v-else-if="!pending.data.value?.items.length" class="p-priv-muted">{{ t('pv.nothing') }}</p>
          <ul v-else class="p-priv-rows">
            <li v-for="d in pending.data.value.items" :key="d.kind">
              <span><RouterLink :to="`/legal/${d.kind}`"><bdi>{{ d.title }}</bdi></RouterLink> <QBadge tone="neutral">{{ t('a7.legal.version', { v: fa(d.version) }) }}</QBadge></span>
              <QButton size="sm" variant="primary" @click="act(() => esp07.accept(d.kind, d.version), [pending.load, consents.load])">{{ t('a7.me.accept') }}</QButton>
            </li>
          </ul>
        </QCard>
      </QSection>

      <QSection id="marketing" small :title="t('a7.me.marketing')" :description="t('a7.me.marketingLead')">
        <QCard>
          <div class="k-stack">
            <QSwitch v-if="marketing.data.value" block :label="t('a7.me.marketing')" :model-value="marketingOn" @update:model-value="toggleMarketing" />
            <p v-else class="p-priv-muted">{{ t('a7.me.noMarketingText') }}</p>
            <ul v-if="consents.data.value?.items.length" class="p-priv-rows">
              <li v-for="c in consents.data.value.items" :key="c._id">
                <bdi class="q-ltr">{{ c.kind }} v{{ c.version }}</bdi>
                <span class="p-priv-muted">{{ formatJalali(c.acceptedAt) }}<template v-if="c.withdrawnAt"> · {{ t('a7.me.withdrawn') }} {{ formatJalali(c.withdrawnAt) }}</template></span>
              </li>
            </ul>
          </div>
        </QCard>
      </QSection>

      <QSection id="rights" small :title="t('a7.me.dataRights')">
        <QCard>
          <div class="k-stack">
            <div class="k-row"><QButton variant="secondary" icon="download" @click="exportNow">{{ t('a7.me.export') }}</QButton><span class="p-priv-muted">{{ t('a7.me.exportHint') }}</span></div>
            <form class="p-priv-inline" novalidate @submit.prevent="sendCorrection">
              <QTextField v-model="detail.correction" :label="t('a7.me.correction')" :placeholder="t('a7.me.correctionPlaceholder')" />
              <QButton type="submit" variant="secondary" :disabled="detail.correction.trim().length < 5">{{ t('a7.me.correction') }}</QButton>
            </form>
            <form class="k-stack" novalidate @submit.prevent="askDelete = true">
              <QAlert tone="warning">{{ t('a7.me.deletionWarning') }}</QAlert>
              <QTextField v-model="detail.deletion" :label="t('a7.me.deletionReason')" />
              <QCheckbox v-model="deleteOk" :label="t('a7.me.deletionConfirm')" />
              <div><QButton type="submit" variant="danger" :disabled="!confirmDelete">{{ t('a7.me.deletion') }}</QButton></div>
            </form>
            <ul v-if="requests.data.value?.items.length" class="p-priv-rows">
              <li v-for="r in requests.data.value.items" :key="r._id">
                <span>{{ t(`a7.req.${r.kind}` as never) }}<template v-if="r.decisionNote"> — {{ r.decisionNote }}</template></span>
                <span class="k-row"><QStatusBadge :state="r.state" /><span class="p-priv-muted">{{ formatJalali(r.createdAt) }}</span></span>
              </li>
            </ul>
          </div>
        </QCard>
      </QSection>

      <QSection id="appeal" small :title="t('a7.me.appeal')" :description="t('a7.me.appealLead')">
        <QCard>
          <form class="k-stack" novalidate @submit.prevent="sendAppeal">
            <QTextField v-model="appealId" :label="t('a7.me.decisionId')" ltr />
            <QTextField v-model="appealText" :label="t('a7.me.appealText')" multiline :rows="3" />
            <div><QButton type="submit" variant="secondary" icon="send" :disabled="!appealId || appealText.trim().length < 10">{{ t('a7.me.appealSend') }}</QButton></div>
          </form>
        </QCard>
      </QSection>
    </div>
    <QConfirmDialog
      :open="askDelete" icon="trash" :title="t('a7.me.deletion')" :message="t('a7.me.deletionWarning')" :confirm-label="t('a7.me.deletion')" :cancel-label="t('pv.cancel')"
      @close="askDelete = false" @confirm="sendDeletion"
    />
  </QContainer>
</template>

<style scoped>
.p-priv { gap: var(--space-7); }
.p-priv-muted { margin: 0; color: var(--ink-muted); font-size: 13px; }
.p-priv-rows { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; }
.p-priv-rows li { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: var(--space-3); padding-block: var(--space-3); border-block-end: 1px solid var(--line); font-size: 14px; }
.p-priv-rows li:last-child { border-block-end: 0; }
.p-priv-inline { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: var(--space-3); align-items: end; }
@media (max-width: 640px) { .p-priv-inline { grid-template-columns: minmax(0, 1fr); } }
</style>
