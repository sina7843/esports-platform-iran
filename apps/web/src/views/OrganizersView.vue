<script setup lang="ts">
import { ref } from 'vue';
import type { ApiClientError } from '../api/client';
import { esp02 } from '../api/esp02';
import DataState from '../components/DataState.vue';
import ErrorNote from '../components/ErrorNote.vue';
import FormField from '../components/FormField.vue';
import PageHeader from '../components/PageHeader.vue';
import { toClientError } from '../errors';
import { num, stateLabel, t } from '../i18n';
import { session } from '../session';
import { useLoad } from '../useLoad';

/** ADM-002/003/004: verified organizers and the application any user can submit for their organization. */
const list = useLoad(() => esp02.organizers({}));
const mine = useLoad(() => (session.me ? esp02.myOrganizerApplications() : Promise.resolve({ items: [] })));
const form = ref({ organizationId: '', description: '', experience: '', contactPhone: '' });
const failure = ref<ApiClientError | null>(null);
const busy = ref(false);

async function submit() {
  if (!form.value.organizationId.trim() || form.value.description.trim().length < 20) return;
  busy.value = true;
  failure.value = null;
  try {
    await esp02.applyOrganizer({ organizationId: form.value.organizationId.trim(), description: form.value.description.trim(), experience: form.value.experience.trim() || null, contactPhone: form.value.contactPhone.trim() || null });
    form.value = { organizationId: '', description: '', experience: '', contactPhone: '' };
    await mine.load();
  } catch (e) {
    failure.value = toClientError(e);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <PageHeader :title="t('org.title')" />
  <DataState :loading="list.loading.value" :error="list.error.value" :empty="!!list.data.value && list.data.value.items.length === 0" @retry="list.load">
    <ul v-if="list.data.value" class="cards">
      <li v-for="o in list.data.value.items" :key="o.id" class="card stack">
        <RouterLink :to="`/organizers/${o.slug}`"><bdi>{{ o.name }}</bdi></RouterLink>
        <span class="muted">{{ t('org.level') }}: <bdi class="ltr">{{ o.level }}</bdi></span>
        <span v-if="o.ratingSummary.average !== null">{{ t('org.rating') }}: {{ num(o.ratingSummary.average.toFixed(1)) }} ({{ num(o.ratingSummary.count) }})</span>
        <span v-else class="muted">{{ t('org.noRating') }}</span>
      </li>
    </ul>
  </DataState>

  <template v-if="session.me">
    <section class="card stack block" aria-labelledby="my-h">
      <h2 id="my-h">{{ t('org.myApplications') }}</h2>
      <DataState :loading="mine.loading.value" :error="mine.error.value" :empty="!!mine.data.value && mine.data.value.items.length === 0" @retry="mine.load">
        <ul v-if="mine.data.value" class="list">
          <li v-for="a in mine.data.value.items" :key="a.id"><bdi class="ltr">{{ a.organizationId }}</bdi> — {{ stateLabel(a.state) }}</li>
        </ul>
      </DataState>
    </section>

    <form class="card stack block form" novalidate aria-labelledby="ap-h" @submit.prevent="submit">
      <h2 id="ap-h">{{ t('org.apply') }}</h2>
      <FormField id="ap-org" :label="t('org.applyOrg')" required><template #default="{ id }"><input :id="id" v-model="form.organizationId" class="input ltr" /></template></FormField>
      <FormField id="ap-desc" :label="t('org.description')" required><template #default="{ id }"><textarea :id="id" v-model="form.description" class="input" rows="4" dir="auto" minlength="20" /></template></FormField>
      <FormField id="ap-exp" :label="t('org.experience')"><template #default="{ id }"><textarea :id="id" v-model="form.experience" class="input" rows="3" dir="auto" /></template></FormField>
      <ErrorNote :error="failure" />
      <button type="submit" class="btn btn-primary" :disabled="busy">{{ t('org.submit') }}</button>
    </form>
  </template>
</template>

<style scoped>
.cards { list-style: none; padding: 0; margin: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(16rem, 1fr)); gap: var(--sp-4); }
.block { margin-block-start: var(--sp-6); }
.list { margin: 0; padding-inline-start: var(--sp-5); }
.form { max-inline-size: 40rem; }
</style>
