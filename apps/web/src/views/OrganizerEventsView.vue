<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { zonedWallTimeToUtc } from '@esp/contracts';
import type { ApiClientError } from '../api/client';
import { esp03 } from '../api/esp03';
import DataState from '../components/DataState.vue';
import ErrorNote from '../components/ErrorNote.vue';
import FormField from '../components/FormField.vue';
import JalaliDate from '../components/JalaliDate.vue';
import PageHeader from '../components/PageHeader.vue';
import StatusBadge from '../components/StatusBadge.vue';
import { toClientError } from '../errors';
import { t } from '../i18n';
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

const f = reactive({ name: '', slug: '', visibility: 'public', presence: 'online', startsAt: '', endsAt: '', description: '', contact: '', before: 100, after: 50, cancel: 100, dq: 0, refundText: '', cancellationTerms: '', disputeTerms: '', prizeTitle: '', prizeRial: 0, prizeResp: 'organizer' });
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
</script>

<template>
  <PageHeader :title="t('nav.organizer')" :lead="t('evm.lead')" />
  <FormField id="ev-org" :label="t('evm.org')">
    <template #default="{ id }">
      <select v-if="orgIds.length" :id="id" v-model="orgId" class="input ltr"><option v-for="o in orgIds" :key="o" :value="o">{{ o }}</option></select>
      <input v-else :id="id" v-model.lazy="orgId" class="input ltr" />
    </template>
  </FormField>

  <DataState :loading="loading" :error="error" :empty="!!orgId && !loading && !items.length" @retry="load">
    <ul class="cards">
      <li v-for="e in items" :key="String(e.id)" class="card row between">
        <RouterLink :to="`/organizer/events/${e.id}`"><bdi>{{ e.name }}</bdi></RouterLink>
        <span class="row"><JalaliDate :iso="(e.startsAt as string | null)" format="date" /> <StatusBadge :state="String(e.state)" /></span>
      </li>
    </ul>
  </DataState>

  <form v-if="orgId" class="card stack block" novalidate @submit.prevent="create">
    <h2>{{ t('evm.create') }}</h2>
    <div class="grid">
      <FormField id="ev-name" :label="t('events.name')" required><template #default="{ id }"><input :id="id" v-model="f.name" class="input" dir="auto" required minlength="2" /></template></FormField>
      <FormField id="ev-slug" :label="t('adm.slug')" :hint="t('evm.slugHint')" required><template #default="{ id, describedBy }"><input :id="id" v-model="f.slug" class="input ltr" pattern="[a-z0-9-]+" :aria-describedby="describedBy" required /></template></FormField>
      <FormField id="ev-vis" :label="t('evm.visibility')"><template #default="{ id }"><select :id="id" v-model="f.visibility" class="input"><option v-for="v in ['public', 'private', 'invite', 'link_only']" :key="v" :value="v">{{ t(`evm.vis.${v}` as never) }}</option></select></template></FormField>
      <FormField id="ev-pres" :label="t('reg.presence')"><template #default="{ id }"><select :id="id" v-model="f.presence" class="input"><option v-for="v in ['online', 'offline', 'hybrid']" :key="v" :value="v">{{ t(`reg.presence.${v}` as never) }}</option></select></template></FormField>
      <FormField id="ev-start" :label="t('evm.startsTehran')"><template #default="{ id }"><input :id="id" v-model="f.startsAt" type="datetime-local" class="input" /></template></FormField>
      <FormField id="ev-end" :label="t('evm.endsTehran')"><template #default="{ id }"><input :id="id" v-model="f.endsAt" type="datetime-local" class="input" /></template></FormField>
      <FormField id="ev-contact" :label="t('reg.contact')"><template #default="{ id }"><input :id="id" v-model="f.contact" class="input" dir="auto" /></template></FormField>
    </div>
    <FormField id="ev-desc" :label="t('mgmt.description')"><template #default="{ id }"><textarea :id="id" v-model="f.description" class="input" rows="3" dir="auto" /></template></FormField>
    <fieldset class="stack">
      <legend>{{ t('reg.refundPolicy') }}</legend>
      <div class="grid">
        <FormField id="ev-rb" :label="t('evm.pBefore')"><template #default="{ id }"><input :id="id" v-model.number="f.before" type="number" min="0" max="100" class="input ltr" /></template></FormField>
        <FormField id="ev-ra" :label="t('evm.pAfter')"><template #default="{ id }"><input :id="id" v-model.number="f.after" type="number" min="0" max="100" class="input ltr" /></template></FormField>
        <FormField id="ev-rc" :label="t('evm.pCancel')"><template #default="{ id }"><input :id="id" v-model.number="f.cancel" type="number" min="0" max="100" class="input ltr" /></template></FormField>
        <FormField id="ev-rd" :label="t('evm.pDq')"><template #default="{ id }"><input :id="id" v-model.number="f.dq" type="number" min="0" max="100" class="input ltr" /></template></FormField>
      </div>
      <FormField id="ev-rt" :label="t('evm.refundText')" :hint="t('evm.refundTextHint')"><template #default="{ id }"><textarea :id="id" v-model="f.refundText" class="input" rows="2" dir="auto" /></template></FormField>
    </fieldset>
    <FormField id="ev-ct" :label="t('reg.cancelTerms')"><template #default="{ id }"><textarea :id="id" v-model="f.cancellationTerms" class="input" rows="2" dir="auto" /></template></FormField>
    <FormField id="ev-dt" :label="t('reg.disputeTerms')"><template #default="{ id }"><textarea :id="id" v-model="f.disputeTerms" class="input" rows="2" dir="auto" /></template></FormField>
    <fieldset class="grid">
      <legend>{{ t('reg.prizes') }}</legend>
      <FormField id="ev-pt" :label="t('adm.title')"><template #default="{ id }"><input :id="id" v-model="f.prizeTitle" class="input" dir="auto" /></template></FormField>
      <FormField id="ev-pr" :label="t('evm.amountRial')"><template #default="{ id }"><input :id="id" v-model.number="f.prizeRial" type="number" min="0" step="10" class="input ltr" /></template></FormField>
      <FormField id="ev-pp" :label="t('reg.responsible')"><template #default="{ id }"><select :id="id" v-model="f.prizeResp" class="input"><option v-for="v in ['platform', 'organizer', 'sponsor']" :key="v" :value="v">{{ t(`reg.resp.${v}` as never) }}</option></select></template></FormField>
    </fieldset>
    <ErrorNote :error="failure" />
    <button type="submit" class="btn btn-primary" :disabled="!f.name || !f.slug">{{ t('evm.createDraft') }}</button>
  </form>
</template>

<style scoped>
.cards { list-style: none; padding: 0; margin: var(--sp-4) 0; display: grid; gap: var(--sp-2); }
.between { justify-content: space-between; flex-wrap: wrap; gap: var(--sp-2); }
.block { margin-block-start: var(--sp-6); }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr)); gap: var(--sp-3); border: 0; padding: 0; margin: 0; }
fieldset { border: 1px solid var(--border); border-radius: var(--radius-sm); padding: var(--sp-3); }
h2 { margin: 0; }
</style>
