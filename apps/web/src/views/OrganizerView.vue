<script setup lang="ts">
import { ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import type { ApiClientError } from '../api/client';
import { esp02, type OrganizerPage } from '../api/esp02';
import DataState from '../components/DataState.vue';
import PageHeader from '../components/PageHeader.vue';
import { toClientError } from '../errors';
import { num, stateLabel, t } from '../i18n';
import { settings } from '../settings';
import ErrorNote from '../components/ErrorNote.vue';
import FormField from '../components/FormField.vue';
import { session } from '../session';
import { reactive } from 'vue';

const failure = ref<ApiClientError | null>(null);
const notice = ref('');
// ADM-003: organizer staff edit their page; the server checks organizer.profile.manage in this organization
const edit = reactive({ open: false, version: 0, intro: '', venue: '', venueAddressText: '', facilities: '' });
async function openEdit() {
  if (!o.value) return;
  failure.value = null;
  try {
    const p = await esp02.organizerProfile(o.value.id);
    Object.assign(edit, { open: true, version: p.version, intro: p.intro ?? '', venue: p.venue ?? '', venueAddressText: p.venueAddressText ?? '', facilities: p.facilities.join('، ') });
  } catch (e) {
    failure.value = toClientError(e);
  }
}
async function saveEdit() {
  if (!o.value) return;
  failure.value = null;
  try {
    await esp02.updateOrganizerProfile(o.value.id, { intro: edit.intro || null, venue: edit.venue || null, venueAddressText: edit.venueAddressText || null, facilities: edit.facilities.split(/[,،]/).map((x) => x.trim()).filter(Boolean), expectedVersion: edit.version });
    edit.open = false;
    await load();
  } catch (e) {
    failure.value = toClientError(e);
  }
}
// ADM-010: only an eligible participant of a finished event can rate; the server enforces eligibility
const rate = reactive({ eventId: '', score: 5, comment: '' });
async function submitRating() {
  if (!o.value || !rate.eventId) return;
  failure.value = null;
  notice.value = '';
  try {
    await esp02.rateOrganizer(o.value.id, rate.eventId, rate.score, rate.comment || null);
    notice.value = '✓';
    await load();
  } catch (e) {
    failure.value = toClientError(e);
  }
}

/** ADM-003/004/010: public organizer page. Verification is shown with its explicit disclaimer (EVT-008). */
const route = useRoute();
const o = ref<OrganizerPage | null>(null);
const loading = ref(false);
const error = ref<ApiClientError | null>(null);
async function load() {
  loading.value = true;
  error.value = null;
  try {
    o.value = await esp02.organizer(String(route.params['slug']));
  } catch (e) {
    error.value = toClientError(e);
  } finally {
    loading.value = false;
  }
}
watch(() => route.params['slug'], () => void load(), { immediate: true });
</script>

<template>
  <DataState :loading="loading" :error="error" @retry="load">
    <template v-if="o">
      <PageHeader :title="o.name"><template #title><bdi>{{ o.name }}</bdi></template></PageHeader>
      <section v-if="o.verification.verified" class="card stack verify" role="note">
        <strong>{{ t('org.verified') }}</strong>
        <span class="muted">{{ t('org.level') }}: <bdi class="ltr">{{ o.verification.level }}</bdi></span>
        <p>{{ settings.locale === 'fa' ? o.verification.disclaimerFa : o.verification.disclaimerEn }}</p>
      </section>
      <p v-if="o.intro" dir="auto">{{ o.intro }}</p>
      <ErrorNote :error="failure" />
      <p v-if="notice" role="status">{{ notice }}</p>
      <button v-if="session.me && !edit.open" type="button" class="btn btn-sm" @click="openEdit">{{ t('adm.orgProfile') }}</button>
      <form v-if="edit.open" class="card stack" novalidate @submit.prevent="saveEdit">
        <FormField id="oe-intro" :label="t('org.description')"><template #default="{ id }"><textarea :id="id" v-model="edit.intro" class="input" rows="3" dir="auto" /></template></FormField>
        <FormField id="oe-venue" :label="t('org.venue')"><template #default="{ id }"><input :id="id" v-model="edit.venue" class="input" dir="auto" /></template></FormField>
        <FormField id="oe-addr" :label="t('org.venue') + ' — ' + t('profile.city')"><template #default="{ id }"><textarea :id="id" v-model="edit.venueAddressText" class="input" rows="2" dir="auto" /></template></FormField>
        <FormField id="oe-fac" :label="t('org.facilities')" :hint="t('adm.list')"><template #default="{ id, describedBy }"><input :id="id" v-model="edit.facilities" class="input" dir="auto" :aria-describedby="describedBy" /></template></FormField>
        <button type="submit" class="btn btn-primary">{{ t('mgmt.save') }}</button>
      </form>

      <section class="card stack block">
        <h2>{{ t('org.rating') }}</h2>
        <p v-if="o.ratingSummary.average !== null">{{ num(o.ratingSummary.average.toFixed(1)) }} / {{ num(5) }} ({{ num(o.ratingSummary.count) }})</p>
        <p v-else class="muted">{{ t('org.noRating') }}</p>
        <form v-if="session.me" class="row rate" novalidate @submit.prevent="submitRating">
          <FormField id="r-ev" :label="t('adm.eventId')"><template #default="{ id }"><input :id="id" v-model="rate.eventId" class="input ltr" /></template></FormField>
          <FormField id="r-sc" :label="t('adm.score')"><template #default="{ id }"><input :id="id" v-model.number="rate.score" type="number" min="1" max="5" class="input ltr" /></template></FormField>
          <FormField id="r-cm" :label="t('adm.comment')"><template #default="{ id }"><input :id="id" v-model="rate.comment" class="input" dir="auto" /></template></FormField>
          <button type="submit" class="btn btn-sm">{{ t('adm.rate') }}</button>
        </form>
      </section>

      <section v-if="o.venue || o.venueAddressText" class="card stack block">
        <h2>{{ t('org.venue') }}</h2>
        <p dir="auto">{{ o.venue }}</p>
        <address dir="auto">{{ o.venueAddressText }}</address>
      </section>

      <section v-if="o.staff.length" class="card stack block">
        <h2>{{ t('org.staff') }}</h2>
        <ul class="list"><li v-for="s in o.staff" :key="s.name + s.role"><bdi>{{ s.name }}</bdi> — <bdi>{{ s.role }}</bdi></li></ul>
      </section>

      <section v-if="o.facilities.length || o.sponsors.length" class="card stack block">
        <h2 v-if="o.facilities.length">{{ t('org.facilities') }}</h2>
        <ul v-if="o.facilities.length" class="list"><li v-for="f in o.facilities" :key="f"><bdi>{{ f }}</bdi></li></ul>
        <h2 v-if="o.sponsors.length">{{ t('org.sponsors') }}</h2>
        <ul v-if="o.sponsors.length" class="list"><li v-for="s in o.sponsors" :key="s.name"><bdi>{{ s.name }}</bdi></li></ul>
      </section>

      <section class="card stack block">
        <h2>{{ t('org.upcoming') }}</h2>
        <ul v-if="o.upcomingEvents.length" class="list"><li v-for="e in o.upcomingEvents" :key="e.id"><RouterLink :to="`/events/${e.id}`"><bdi>{{ e.name }}</bdi></RouterLink> — {{ stateLabel(e.state) }}</li></ul>
        <p v-else class="muted">—</p>
        <h2>{{ t('org.past') }}</h2>
        <ul v-if="o.pastEvents.length" class="list"><li v-for="e in o.pastEvents" :key="e.id"><RouterLink :to="`/events/${e.id}`"><bdi>{{ e.name }}</bdi></RouterLink></li></ul>
        <p v-else class="muted">—</p>
      </section>
    </template>
  </DataState>
</template>

<style scoped>
.block { margin-block-start: var(--sp-6); }
.list { margin: 0; padding-inline-start: var(--sp-5); }
.verify { border-inline-start: 4px solid var(--accent-strong); }
.rate { flex-wrap: wrap; gap: var(--sp-3); align-items: flex-end; }
p, address { margin: 0; }
</style>
