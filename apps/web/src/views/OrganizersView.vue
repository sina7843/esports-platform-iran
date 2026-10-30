<script setup lang="ts">
import { computed, ref } from 'vue';
import { QAlert, QBadge, QButton, QCard, QContainer, QDataState, QEmptyState, QFilterBar, QOrganizerCard, QPageHeader, QSection, QTextField, fa, useToast } from '@esp/ui';
import { esp02 } from '../api/esp02';
import { toClientError } from '../errors';
import { stateLabel, t } from '../i18n';
import { session } from '../session';
import { useDataState } from '../useDataState';
import { useLoad } from '../useLoad';

/**
 * Spec docs/redesign/03-specs/organizers.md — ADM-002/003/004: verified organizers and the application any user can
 * submit for their organization. City/event counts need backlog 3.1 / 11.6, so those card fields are omitted.
 */
const { push } = useToast();
const list = useLoad(() => esp02.organizers({}));
const mine = useLoad(() => (session.me ? esp02.myOrganizerApplications() : Promise.resolve({ items: [] })));
const ds = useDataState({ loading: computed(() => list.loading.value && !list.data.value), error: list.error, empty: () => !!list.data.value && !list.data.value.items.length });
const query = ref('');
const shown = computed(() => (list.data.value?.items ?? []).filter((o) => o.name.toLowerCase().includes(query.value.trim().toLowerCase())));

const form = ref({ organizationId: '', description: '', experience: '' });
const touched = ref(false);
const busy = ref(false);
const failure = ref('');
const orgErr = computed(() => (touched.value && !form.value.organizationId.trim() ? t('og.orgErr') : undefined));
const descErr = computed(() => (touched.value && form.value.description.trim().length < 20 ? t('og.descErr') : undefined));
async function submit() {
  touched.value = true;
  if (orgErr.value || descErr.value) return;
  busy.value = true;
  failure.value = '';
  try {
    await esp02.applyOrganizer({ organizationId: form.value.organizationId.trim(), description: form.value.description.trim(), experience: form.value.experience.trim() || null, contactPhone: null });
    form.value = { organizationId: '', description: '', experience: '' };
    touched.value = false;
    push({ tone: 'success', message: t('og.sent'), duration: 4000 });
    await mine.load();
  } catch (e) {
    failure.value = toClientError(e).message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <QContainer>
    <div class="k-stack p-organizers">
      <QPageHeader :eyebrow="t('og.eyebrow')" :title="t('org.title')" :description="t('og.desc')" :breadcrumb="[{ label: t('shell.home'), href: '/' }, { label: t('org.title') }]">
        <template v-if="session.me" #actions><QButton variant="secondary" icon="send" href="#apply">{{ t('org.apply') }}</QButton></template>
      </QPageHeader>
      <QFilterBar v-model:query="query" :search-label="t('og.search')" :search-placeholder="t('og.searchPh')" :result-label="ds.state.value === 'content' ? t('og.count', { n: fa(shown.length) }) : undefined" />
      <QDataState v-if="ds.state.value !== 'content'" v-bind="ds.props.value" skeleton="cards" icon="flag" :empty-title="t('og.empty')" @retry="list.load" />
      <QEmptyState v-else-if="!shown.length" compact icon="search" :title="t('og.noMatch')" />
      <div v-else class="k-grid">
        <QOrganizerCard
          v-for="o in shown" :key="o.id" :name="o.name" :initial="Array.from(o.name)[0]" verified :verified-label="t('og.verified')"
          :rating="o.ratingSummary" :level="o.level" :href="`/organizers/${encodeURIComponent(o.slug)}`" :link-label="t('og.open')"
        />
      </div>

      <template v-if="session.me">
        <QSection id="mine" small :title="t('org.myApplications')">
          <QCard>
            <QDataState v-if="mine.error.value" state="error" @retry="mine.load" />
            <p v-else-if="!mine.data.value?.items.length" class="p-organizers-muted">{{ t('og.noMine') }}</p>
            <ul v-else class="p-organizers-list">
              <li v-for="a in mine.data.value.items" :key="a.id"><bdi class="q-ltr">{{ a.organizationId }}</bdi><QBadge tone="neutral">{{ stateLabel(a.state) }}</QBadge></li>
            </ul>
          </QCard>
        </QSection>
        <QSection id="apply" small :title="t('org.apply')" :description="t('og.applyDesc')">
          <QCard>
            <form class="k-stack" novalidate @submit.prevent="submit">
              <QTextField id="ap-org" v-model="form.organizationId" :label="t('org.applyOrg')" required ltr :error="orgErr" />
              <QTextField id="ap-desc" v-model="form.description" :label="t('org.description')" required multiline :rows="4" :error="descErr" />
              <QTextField id="ap-exp" v-model="form.experience" :label="t('org.experience')" multiline :rows="3" />
              <QAlert v-if="failure" tone="danger">{{ failure }}</QAlert>
              <div><QButton type="submit" variant="primary" icon="send" :loading="busy">{{ t('org.submit') }}</QButton></div>
            </form>
          </QCard>
        </QSection>
      </template>
    </div>
  </QContainer>
</template>

<style scoped>
.p-organizers { gap: var(--space-7); }
.p-organizers-muted { margin: 0; color: var(--ink-muted); font-size: 14px; }
.p-organizers-list { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: var(--space-2); }
.p-organizers-list li { display: flex; justify-content: space-between; align-items: center; gap: var(--space-3); padding-block: var(--space-2); border-block-end: 1px solid var(--line); }
</style>
