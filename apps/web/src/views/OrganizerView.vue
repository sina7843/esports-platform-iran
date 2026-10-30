<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { QAlert, QButton, QCard, QContainer, QDataState, QEventCard, QOrganizerCard, QPageHeader, QSection, QSelect, QTextField, dec, fa, useToast } from '@esp/ui';
import type { ApiClientError } from '../api/client';
import { esp02, type OrganizerPage } from '../api/esp02';
import { toClientError } from '../errors';
import { stateLabel, t } from '../i18n';
import { settings } from '../settings';
import { session } from '../session';
import { useDataState } from '../useDataState';
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
const { push } = useToast();
watch(notice, (n) => { if (n) push({ tone: 'success', message: t('op.rated'), duration: 4000 }); });
const ds = useDataState({ loading: computed(() => loading.value && !o.value), error });
const score = computed({ get: () => String(rate.score), set: (v: string) => { rate.score = Number(v) || 5; } });
</script>

<template>
  <QContainer>
    <QDataState v-if="ds.state.value !== 'content' || !o" v-bind="ds.props.value" @retry="load" />
    <div v-else class="k-stack p-orgp">
      <QPageHeader :title="o.name" :breadcrumb="[{ label: t('shell.home'), href: '/' }, { label: t('shell.organizers'), href: '/organizers' }, { label: o.name }]">
        <template v-if="session.me && !edit.open" #actions><QButton variant="secondary" icon="edit" @click="openEdit">{{ t('adm.orgProfile') }}</QButton></template>
      </QPageHeader>
      <QAlert v-if="failure" tone="danger">{{ failure.message }}</QAlert>
      <div class="p-orgp-grid">
        <div class="p-orgp-main">
          <QOrganizerCard
            :name="o.name" :initial="Array.from(o.name)[0]" :verified="o.verification.verified" :verified-label="t('org.verified')"
            :disclaimer="settings.locale === 'fa' ? o.verification.disclaimerFa : o.verification.disclaimerEn" :rating="o.ratingSummary" :level="o.verification.level ?? undefined"
          />
          <p v-if="o.intro" class="p-orgp-intro" dir="auto">{{ o.intro }}</p>
          <QCard v-if="edit.open">
            <form class="k-stack" novalidate @submit.prevent="saveEdit">
              <QTextField id="oe-intro" v-model="edit.intro" :label="t('org.description')" multiline :rows="3" />
              <QTextField id="oe-venue" v-model="edit.venue" :label="t('org.venue')" />
              <QTextField id="oe-addr" v-model="edit.venueAddressText" :label="`${t('org.venue')} — ${t('profile.city')}`" multiline :rows="2" />
              <QTextField id="oe-fac" v-model="edit.facilities" :label="t('org.facilities')" :hint="t('adm.list')" />
              <div class="k-row"><QButton type="submit" variant="primary">{{ t('mgmt.save') }}</QButton><QButton variant="secondary" @click="edit.open = false">{{ t('op.cancel') }}</QButton></div>
            </form>
          </QCard>
          <QSection id="upcoming" small :title="t('org.upcoming')">
            <p v-if="!o.upcomingEvents.length" class="p-orgp-muted">—</p>
            <div v-else class="k-grid">
              <QEventCard v-for="e in o.upcomingEvents" :key="e.id" :href="`/events/${e.id}`" :title="e.name" :status="(e.state === 'active' ? 'live' : e.state) as never" :status-label="stateLabel(e.state)" />
            </div>
          </QSection>
          <QSection id="past" small :title="t('org.past')">
            <p v-if="!o.pastEvents.length" class="p-orgp-muted">—</p>
            <ul v-else class="p-orgp-list"><li v-for="e in o.pastEvents" :key="e.id"><RouterLink :to="`/events/${e.id}`"><bdi>{{ e.name }}</bdi></RouterLink></li></ul>
          </QSection>
        </div>
        <aside class="p-orgp-side">
          <QCard>
            <div class="k-stack">
              <h2 class="h4 p-orgp-h">{{ t('org.rating') }}</h2>
              <p v-if="o.ratingSummary.average !== null" class="p-orgp-score">{{ dec(o.ratingSummary.average, 1) }} / {{ fa(5) }} <span class="p-orgp-muted">({{ fa(o.ratingSummary.count) }})</span></p>
              <p v-else class="p-orgp-muted">{{ t('org.noRating') }}</p>
              <form v-if="session.me" class="k-stack" novalidate @submit.prevent="submitRating">
                <!-- OPEN-QUESTION(organizer-page): eligible events for rating need an API listing; the event ID is entered -->
                <QTextField id="r-ev" v-model="rate.eventId" :label="t('adm.eventId')" ltr />
                <QSelect id="r-sc" v-model="score" :label="t('adm.score')" :options="[1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: fa(n) }))" />
                <QTextField id="r-cm" v-model="rate.comment" :label="t('adm.comment')" />
                <div><QButton type="submit" variant="green" icon="star" :disabled="!rate.eventId">{{ t('adm.rate') }}</QButton></div>
              </form>
            </div>
          </QCard>
          <QCard v-if="o.venue || o.venueAddressText">
            <div class="k-stack">
              <h2 class="h4 p-orgp-h">{{ t('org.venue') }}</h2>
              <p class="p-orgp-p" dir="auto">{{ o.venue }}</p>
              <address class="p-orgp-p" dir="auto">{{ o.venueAddressText }}</address>
            </div>
          </QCard>
          <QCard v-if="o.staff.length">
            <div class="k-stack">
              <h2 class="h4 p-orgp-h">{{ t('org.staff') }}</h2>
              <ul class="p-orgp-list"><li v-for="s in o.staff" :key="s.name + s.role"><bdi>{{ s.name }}</bdi> — <bdi>{{ s.role }}</bdi></li></ul>
            </div>
          </QCard>
          <QCard v-if="o.facilities.length || o.sponsors.length">
            <div class="k-stack">
              <template v-if="o.facilities.length"><h2 class="h4 p-orgp-h">{{ t('org.facilities') }}</h2><ul class="p-orgp-list"><li v-for="f in o.facilities" :key="f"><bdi>{{ f }}</bdi></li></ul></template>
              <template v-if="o.sponsors.length"><h2 class="h4 p-orgp-h">{{ t('org.sponsors') }}</h2><ul class="p-orgp-list"><li v-for="s in o.sponsors" :key="s.name"><bdi>{{ s.name }}</bdi></li></ul></template>
            </div>
          </QCard>
        </aside>
      </div>
    </div>
  </QContainer>
</template>

<style scoped>
.p-orgp { gap: var(--space-6); }
.p-orgp-h { margin: 0; }
.p-orgp-p { margin: 0; font-size: 14px; font-style: normal; }
.p-orgp-intro { margin: 0; color: var(--ink-muted); font-size: 15px; line-height: 28px; white-space: pre-line; }
.p-orgp-grid { display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 1fr); gap: var(--space-6); align-items: start; }
.p-orgp-main, .p-orgp-side { display: flex; flex-direction: column; gap: var(--space-6); min-width: 0; }
.p-orgp-muted { margin: 0; color: var(--ink-muted); font-size: 13px; }
.p-orgp-score { margin: 0; font-size: 28px; font-weight: 900; }
.p-orgp-list { margin: 0; padding-inline-start: var(--space-5); display: flex; flex-direction: column; gap: var(--space-1); font-size: 14px; }
@media (max-width: 960px) { .p-orgp-grid { grid-template-columns: minmax(0, 1fr); } }
</style>
