<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { zonedWallTimeToUtc } from '@esp/contracts';
import { QAlert, QButton, QCard, QContainer, QDataState, QDateField, QEventCard, QPageHeader, QSection, QSelect, QTextField, formatJalali } from '@esp/ui';
import type { ApiClientError } from '../api/client';
import { esp03 } from '../api/esp03';
import { toClientError } from '../errors';
import { stateLabel, t } from '../i18n';
import { session } from '../session';

/** EVT-001/002: organizer's events per organization and the create-event form. */
const router = useRouter();
const orgIds = computed(() => [...new Set((session.me?.grants ?? []).filter((g) => g.scope.type === 'organization' && !g.revokedAt).map((g) => g.scope.id))]);
const orgId = ref(orgIds.value[0] ?? '');
const items = ref<Array<Record<string, unknown>>>([]);
const loading = ref(false);
const error = ref<ApiClientError | null>(null);
async function load() {
  if (!orgId.value) return;
  loading.value = true;
  error.value = null;
  try {
    items.value = (await esp03.orgEvents(orgId.value)).items;
  } catch (e) {
    error.value = toClientError(e);
  } finally {
    loading.value = false;
  }
}
watch(orgId, () => void load(), { immediate: true });

const f = reactive({ name: '', slug: '', visibility: 'public', presence: 'online', startsAt: '' as string | null, endsAt: '' as string | null,
 description: '', contact: '', before: 100, after: 50, cancel: 100, dq: 0, refundText: '', cancellationTerms: '', disputeTerms: '', prizeTitle: '', prizeRial: 0, prizeResp: 'organizer' });
const failure = ref<ApiClientError | null>(null);
async function create() {
  failure.value = null;
  try {
    const body: Record<string, unknown> = {
      organizerOrgId: orgId.value, name: f.name.trim(), slug: f.slug.trim(), visibility: f.visibility, presence: f.presence,
      startsAt: f.startsAt ? zonedWallTimeToUtc(f.startsAt) : null, endsAt: f.endsAt ? zonedWallTimeToUtc(f.endsAt) : null,
      description: f.description || null, contact: f.contact || null,
      refundPolicy: f.refundText ? { beforeDeadlinePercent: f.before, afterDeadlinePercent: f.after, onEventCancelPercent: f.cancel, onDisqualificationPercent: f.dq, text: f.refundText } : null,
      cancellationTerms: f.cancellationTerms || null, disputeTerms: f.disputeTerms || null,
      prizes: f.prizeTitle ? [{ key: 'first', title: f.prizeTitle, kind: f.prizeRial > 0 ? 'cash' : 'non_cash', amountRial: f.prizeRial, responsible: f.prizeResp }] : [],
    };
    const { id } = await esp03.createEvent(body);
    await router.push(`/organizer/events/${id}`);
  } catch (e) {
    failure.value = toClientError(e);
  }
}
const numField = (k: 'before' | 'after' | 'cancel' | 'dq' | 'prizeRial') => computed({ get: () => String(f[k]), set: (v: string) => { f[k] = Number(v) || 0; } });
const fBefore = numField('before');
const fAfter = numField('after');
const fCancel = numField('cancel');
const fDq = numField('dq');
const fPrize = numField('prizeRial');
const opts = (keys: string[], prefix: string) => keys.map((v) => ({ value: v, label: t(`${prefix}.${v}` as never) }));
</script>

<template>
  <QContainer>
    <div class="k-stack p-orgev">
      <QPageHeader compact :title="t('nav.organizer')" :description="t('evm.lead')">
        <template v-if="orgId" #actions><QButton variant="primary" icon="plus" href="#create">{{ t('evm.create') }}</QButton></template>
      </QPageHeader>
      <QCard>
        <QSelect v-if="orgIds.length" id="ev-org" v-model="orgId" :label="t('evm.org')" :options="orgIds.map((o) => ({ value: o, label: o }))" />
        <!-- OPEN-QUESTION(organizer): organization names need backlog 0.2; the organization ID is shown -->
        <QTextField v-else id="ev-org" v-model="orgId" :label="t('evm.org')" ltr />
      </QCard>
      <QDataState
        v-if="loading || error || (!!orgId && !items.length)" :state="error ? (error.code === 'FORBIDDEN' ? 'forbidden' : 'error') : loading ? 'loading' : 'empty'"
        skeleton="cards" icon="trophy" :empty-title="t('oe.empty')" @retry="load"
      />
      <div v-else class="k-grid">
        <QEventCard
          v-for="e in items" :key="String(e.id)" :href="`/organizer/events/${e.id}`" :title="String(e.name)" :status="(e.state === 'active' ? 'live' : String(e.state)) as never"
          :status-label="stateLabel(String(e.state))" :date="e.startsAt ? formatJalali(String(e.startsAt), 'date') : undefined"
        />
      </div>

      <QSection v-if="orgId" id="create" small :title="t('evm.create')">
        <QCard>
          <form class="k-stack" novalidate @submit.prevent="create">
            <div class="p-orgev-grid">
              <QTextField id="ev-name" v-model="f.name" :label="t('events.name')" required />
              <QTextField id="ev-slug" v-model="f.slug" :label="t('adm.slug')" :hint="t('evm.slugHint')" required ltr />
              <QSelect id="ev-vis" v-model="f.visibility" :label="t('evm.visibility')" :options="opts(['public', 'private', 'invite', 'link_only'], 'evm.vis')" />
              <QSelect id="ev-pres" v-model="f.presence" :label="t('reg.presence')" :options="opts(['online', 'offline', 'hybrid'], 'reg.presence')" />
              <QDateField id="ev-start" v-model="f.startsAt" :label="t('evm.startsTehran')" with-time />
              <QDateField id="ev-end" v-model="f.endsAt" :label="t('evm.endsTehran')" with-time />
              <QTextField id="ev-contact" v-model="f.contact" :label="t('reg.contact')" />
            </div>
            <QTextField id="ev-desc" v-model="f.description" :label="t('mgmt.description')" multiline :rows="3" />
            <fieldset class="p-orgev-set">
              <legend>{{ t('reg.refundPolicy') }}</legend>
              <div class="p-orgev-grid">
                <QTextField id="ev-rb" v-model="fBefore" :label="t('evm.pBefore')" type="number" ltr />
                <QTextField id="ev-ra" v-model="fAfter" :label="t('evm.pAfter')" type="number" ltr />
                <QTextField id="ev-rc" v-model="fCancel" :label="t('evm.pCancel')" type="number" ltr />
                <QTextField id="ev-rd" v-model="fDq" :label="t('evm.pDq')" type="number" ltr />
              </div>
              <QTextField id="ev-rt" v-model="f.refundText" :label="t('evm.refundText')" :hint="t('evm.refundTextHint')" multiline :rows="2" />
            </fieldset>
            <QTextField id="ev-ct" v-model="f.cancellationTerms" :label="t('reg.cancelTerms')" multiline :rows="2" />
            <QTextField id="ev-dt" v-model="f.disputeTerms" :label="t('reg.disputeTerms')" multiline :rows="2" />
            <fieldset class="p-orgev-set">
              <legend>{{ t('reg.prizes') }}</legend>
              <div class="p-orgev-grid">
                <QTextField id="ev-pt" v-model="f.prizeTitle" :label="t('adm.title')" />
                <QTextField id="ev-pr" v-model="fPrize" :label="t('evm.amountRial')" type="number" ltr />
                <QSelect id="ev-pp" v-model="f.prizeResp" :label="t('reg.responsible')" :options="opts(['platform', 'organizer', 'sponsor'], 'reg.resp')" />
              </div>
            </fieldset>
            <QAlert v-if="failure" tone="danger">{{ failure.message }}</QAlert>
            <div><QButton type="submit" variant="primary" icon="plus" :disabled="!f.name || !f.slug">{{ t('evm.createDraft') }}</QButton></div>
          </form>
        </QCard>
      </QSection>
    </div>
  </QContainer>
</template>

<style scoped>
.p-orgev { gap: var(--space-6); }
.p-orgev-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr)); gap: var(--space-4); }
.p-orgev-set { margin: 0; padding: var(--space-4); border: 1px solid var(--line); border-radius: var(--radius-md); display: flex; flex-direction: column; gap: var(--space-4); }
.p-orgev-set legend { padding-inline: var(--space-2); font-weight: 800; }
</style>
