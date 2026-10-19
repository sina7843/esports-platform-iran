<script setup lang="ts">
import { reactive, ref } from 'vue';
import type { ApiClientError } from '../api/client';
import { api } from '../api/client';
import { esp02 } from '../api/esp02';
import { esp03 as esp03Api } from '../api/esp03';
import DataState from '../components/DataState.vue';
import ErrorNote from '../components/ErrorNote.vue';
import FormField from '../components/FormField.vue';
import JalaliDate from '../components/JalaliDate.vue';
import PageHeader from '../components/PageHeader.vue';
import { isForbidden, toClientError } from '../errors';
import { stateLabel, t } from '../i18n';
import { useLoad } from '../useLoad';

/** USR-010 (account reviews, never auto-merged) and ADM-002/004 (organizer application review) for staff. */
const reviews = useLoad(() => esp02.accountReviews());
const apps = useLoad(() => esp02.organizerApplications());
const failure = ref<ApiClientError | null>(null);

const ratings = useLoad(() => esp02.ratingsForModeration());
const pendingIds = useLoad(() => esp02.pendingGameIdentities());
/** template alias (vue-tsc mis-types direct use of this import inside template arrow functions) */
const esp03: typeof esp03Api = esp03Api;
const affs = useLoad(() => esp03.pendingAffiliations());
const affNote = reactive<Record<string, string>>({});
// evidence opens through a short-lived signed link; access to the private file is checked by the server
const openEvidence = (fileId: string) => staff(async () => void window.open((await api.fileLink(fileId)).url, '_blank', 'noopener'));
const notice = ref('');
async function staff(fn: () => Promise<unknown>, reload?: () => Promise<void>) {
  failure.value = null;
  notice.value = '';
  try {
    await fn();
    notice.value = '✓';
    await reload?.();
  } catch (e) {
    failure.value = toClientError(e);
  }
}
const modReason = reactive<Record<string, string>>({});
const moderate = (id: string, action: 'hide' | 'unhide') => staff(() => esp02.moderateRating(id, action, modReason[id] ?? ''), ratings.load);
const verifyId = (id: string) => staff(() => esp02.verifyGameIdentity(id), pendingIds.load);
const level = reactive({ principalId: '', gameId: '', value: '' });
const setLevel = () => staff(() => esp02.setVerifiedLevel(level.principalId.trim(), level.gameId.trim(), level.value.trim() || null));
const badge = reactive({ kind: 'identity', principalId: '', referenceText: '', organizationId: '', position: '' });
const issueBadge = () =>
  staff(() =>
    esp02.issueBadge(
      badge.kind === 'identity'
        ? { kind: 'identity', principalId: badge.principalId.trim(), referenceText: badge.referenceText.trim(), expiresAt: null }
        : { kind: 'org_position', principalId: badge.principalId.trim(), organizationId: badge.organizationId.trim(), position: badge.position.trim(), expiresAt: null },
    ),
  );

const notes = reactive<Record<string, string>>({});
async function decide(id: string, decision: string, version: number) {
  failure.value = null;
  try {
    await esp02.decideReview(id, decision, notes[id] ?? '', version);
    await reviews.load();
  } catch (e) {
    failure.value = toClientError(e);
  }
}

const appForm = reactive<Record<string, { action: string; note: string; level: string; maxEvents: number; maxCapacity: number; paid: boolean }>>({});
const form = (id: string) => (appForm[id] ??= { action: 'start_review', note: '', level: 'basic', maxEvents: 2, maxCapacity: 64, paid: false });
async function review(id: string, version: number) {
  failure.value = null;
  const f = form(id);
  const body: Record<string, unknown> = { action: f.action, note: f.note, expectedVersion: version };
  if (f.action === 'approve') Object.assign(body, { level: f.level, limits: { maxActiveEvents: f.maxEvents, maxCapacityPerEvent: f.maxCapacity, paidEventsAllowed: f.paid } });
  try {
    await esp02.reviewOrganizer(id, body);
    await apps.load();
  } catch (e) {
    failure.value = toClientError(e);
  }
}
</script>

<template>
  <PageHeader :title="t('reviews.title')" :lead="t('reviews.noMerge')" />
  <ErrorNote :error="failure" />

  <section aria-labelledby="ar-h">
    <h2 id="ar-h">{{ t('nav.accountReviews') }}</h2>
    <DataState :loading="reviews.loading.value" :error="reviews.error.value" :forbidden="isForbidden(reviews.error.value)" :empty="!!reviews.data.value && reviews.data.value.items.length === 0" @retry="reviews.load">
      <ul v-if="reviews.data.value" class="cards">
        <li v-for="r in reviews.data.value.items" :key="r.id" class="card stack">
          <span>{{ t('reviews.reason') }}: <bdi>{{ r.reason }}</bdi></span>
          <span>{{ t('reviews.accounts') }}: <bdi v-for="p in r.principals" :key="p.id" class="ltr acc">{{ p.nickname ?? p.id }}</bdi></span>
          <span class="muted"><JalaliDate :iso="r.createdAt" /> · {{ r.state }}</span>
          <template v-if="r.state === 'open'">
            <FormField :id="`n-${r.id}`" :label="t('org.note')"><template #default="{ id }"><input :id="id" v-model="notes[r.id]" class="input" dir="auto" /></template></FormField>
            <div class="row">
              <button type="button" class="btn btn-sm" :disabled="!notes[r.id]" @click="decide(r.id, 'resolved_distinct', r.version)">{{ t('reviews.distinct') }}</button>
              <button type="button" class="btn btn-sm" :disabled="!notes[r.id]" @click="decide(r.id, 'resolved_merged_manually', r.version)">{{ t('reviews.mergedManually') }}</button>
            </div>
          </template>
        </li>
      </ul>
    </DataState>
  </section>

  <p v-if="notice" role="status">{{ notice }}</p>
  <section class="block" aria-labelledby="gi-h">
    <h2 id="gi-h">{{ t('adm.pendingIds') }}</h2>
    <DataState :loading="pendingIds.loading.value" :error="pendingIds.error.value" :forbidden="isForbidden(pendingIds.error.value)" :empty="!!pendingIds.data.value && pendingIds.data.value.items.length === 0" @retry="pendingIds.load">
      <ul v-if="pendingIds.data.value" class="list">
        <li v-for="g in pendingIds.data.value.items" :key="g.id"><bdi class="ltr">{{ g.principalId }} · {{ g.gameId }} · {{ g.platform }} · {{ g.value }}</bdi> · {{ g.verification.state }}
          <button v-if="g.verification.state !== 'disputed'" type="button" class="btn btn-sm" @click="verifyId(g.id)">{{ t('adm.verify') }}</button>
        </li>
      </ul>
    </DataState>
  </section>

  <section class="block grid2">
    <form class="card stack" novalidate @submit.prevent="setLevel">
      <h2>{{ t('adm.verifyLevel') }}</h2>
      <FormField id="vl-p" :label="t('adm.principal')"><template #default="{ id }"><input :id="id" v-model="level.principalId" class="input ltr" /></template></FormField>
      <FormField id="vl-g" :label="t('adm.gameId')"><template #default="{ id }"><input :id="id" v-model="level.gameId" class="input ltr" /></template></FormField>
      <FormField id="vl-v" :label="t('adm.value')"><template #default="{ id }"><input :id="id" v-model="level.value" class="input" dir="auto" /></template></FormField>
      <button type="submit" class="btn" :disabled="!level.principalId || !level.gameId">{{ t('mgmt.save') }}</button>
    </form>
    <form class="card stack" novalidate @submit.prevent="issueBadge">
      <h2>{{ t('adm.badge') }}</h2>
      <FormField id="bd-k" :label="t('adm.badgeKind')">
        <template #default="{ id }"><select :id="id" v-model="badge.kind" class="input"><option value="identity">{{ t('badge.identity') }}</option><option value="org_position">{{ t('badge.org_position') }}</option></select></template>
      </FormField>
      <FormField id="bd-p" :label="t('adm.principal')"><template #default="{ id }"><input :id="id" v-model="badge.principalId" class="input ltr" /></template></FormField>
      <FormField v-if="badge.kind === 'identity'" id="bd-r" :label="t('adm.reference')"><template #default="{ id }"><input :id="id" v-model="badge.referenceText" class="input" dir="auto" /></template></FormField>
      <template v-else>
        <FormField id="bd-o" :label="t('teams.orgId')"><template #default="{ id }"><input :id="id" v-model="badge.organizationId" class="input ltr" /></template></FormField>
        <FormField id="bd-pos" :label="t('teams.role')"><template #default="{ id }"><input :id="id" v-model="badge.position" class="input" dir="auto" /></template></FormField>
      </template>
      <button type="submit" class="btn" :disabled="!badge.principalId">{{ t('adm.badge') }}</button>
    </form>
  </section>

  <section class="block" aria-labelledby="rt-h">
    <h2 id="rt-h">{{ t('adm.ratings') }}</h2>
    <DataState :loading="ratings.loading.value" :error="ratings.error.value" :forbidden="isForbidden(ratings.error.value)" :empty="!!ratings.data.value && ratings.data.value.items.length === 0" @retry="ratings.load">
      <ul v-if="ratings.data.value" class="list">
        <li v-for="r in ratings.data.value.items" :key="r.id" class="row">
          <bdi class="ltr">{{ r.organizationId }} · {{ r.eventId }}</bdi> · {{ r.score }} · <bdi>{{ r.comment }}</bdi> · {{ r.state }}
          <label class="sr-only" :for="`mr-${r.id}`">{{ t('adm.reason') }}</label>
          <input :id="`mr-${r.id}`" v-model="modReason[r.id]" class="input sm" dir="auto" :placeholder="t('adm.reason')" />
          <button type="button" class="btn btn-sm" :disabled="(modReason[r.id] ?? '').length < 5" @click="moderate(r.id, r.state === 'hidden' ? 'unhide' : 'hide')">{{ r.state === 'hidden' ? t('adm.unhide') : t('adm.hide') }}</button>
        </li>
      </ul>
    </DataState>
  </section>

  <section class="block" aria-labelledby="oa-h">
    <h2 id="oa-h">{{ t('org.review') }}</h2>
    <DataState :loading="apps.loading.value" :error="apps.error.value" :forbidden="isForbidden(apps.error.value)" :empty="!!apps.data.value && apps.data.value.items.length === 0" @retry="apps.load">
      <ul v-if="apps.data.value" class="cards">
        <li v-for="a in apps.data.value.items" :key="a.id" class="card stack">
          <span><bdi class="ltr">{{ a.organizationId }}</bdi> — {{ stateLabel(a.state) }}</span>
          <p dir="auto">{{ a.description }}</p>
          <form v-if="!['approved', 'rejected'].includes(a.state)" class="stack" novalidate @submit.prevent="review(a.id, a.version)">
            <FormField :id="`a-${a.id}`" :label="t('org.action')">
              <template #default="{ id }">
                <select :id="id" v-model="form(a.id).action" class="input">
                  <option value="start_review">start_review</option><option value="request_info">request_info</option><option value="approve">approve</option><option value="reject">reject</option>
                </select>
              </template>
            </FormField>
            <template v-if="form(a.id).action === 'approve'">
              <FormField :id="`l-${a.id}`" :label="t('org.level')"><template #default="{ id }"><select :id="id" v-model="form(a.id).level" class="input"><option>basic</option><option>trusted</option><option>partner</option></select></template></FormField>
              <FormField :id="`me-${a.id}`" :label="t('org.maxEvents')"><template #default="{ id }"><input :id="id" v-model.number="form(a.id).maxEvents" type="number" min="0" class="input ltr" /></template></FormField>
              <FormField :id="`mc-${a.id}`" :label="t('org.maxCapacity')"><template #default="{ id }"><input :id="id" v-model.number="form(a.id).maxCapacity" type="number" min="0" class="input ltr" /></template></FormField>
              <label class="row"><input v-model="form(a.id).paid" type="checkbox" /> {{ t('org.paidAllowed') }}</label>
            </template>
            <FormField :id="`no-${a.id}`" :label="t('org.note')" required><template #default="{ id }"><input :id="id" v-model="form(a.id).note" class="input" dir="auto" /></template></FormField>
            <button type="submit" class="btn btn-primary" :disabled="!form(a.id).note">{{ t('org.submit') }}</button>
          </form>
        </li>
      </ul>
    </DataState>
  </section>

  <!-- EVT-008: official affiliation claims; the claimant can never decide their own -->
  <section class="block" aria-labelledby="af-h">
    <h2 id="af-h">{{ t('evm.affReview') }}</h2>
    <DataState :loading="affs.loading.value" :error="affs.error.value" :forbidden="isForbidden(affs.error.value)" :empty="!!affs.data.value && affs.data.value.items.length === 0" @retry="affs.load">
      <ul v-if="affs.data.value" class="cards">
        <li v-for="a in affs.data.value.items" :key="a.eventId" class="card stack">
          <RouterLink :to="`/events/${a.eventId}`"><bdi>{{ a.name }}</bdi></RouterLink>
          <p>{{ t(`evm.aff.${a.affiliation.kind}` as never) }}: <bdi>{{ a.affiliation.body }}</bdi></p>
          <button type="button" class="btn btn-sm" @click="openEvidence(a.affiliation.evidenceFileId)">{{ t('evm.affEvidence') }}</button>
          <FormField :id="`afn-${a.eventId}`" :label="t('evm.reason')"><template #default="{ id }"><input :id="id" v-model="affNote[a.eventId]" class="input" dir="auto" /></template></FormField>
          <div class="row">
            <button type="button" class="btn btn-primary btn-sm" :disabled="(affNote[a.eventId] ?? '').length < 5" @click="staff(() => esp03.decideAffiliation(a.eventId, 'verify', affNote[a.eventId] ?? ''), affs.load)">{{ t('evm.affVerify') }}</button>
            <button type="button" class="btn btn-danger btn-sm" :disabled="(affNote[a.eventId] ?? '').length < 5" @click="staff(() => esp03.decideAffiliation(a.eventId, 'reject', affNote[a.eventId] ?? ''), affs.load)">{{ t('evm.reject') }}</button>
          </div>
        </li>
      </ul>
    </DataState>
  </section>
</template>

<style scoped>
.cards { list-style: none; padding: 0; margin: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(20rem, 1fr)); gap: var(--sp-4); }
.block { margin-block-start: var(--sp-6); }
.acc { margin-inline-end: var(--sp-2); }
.list { margin: 0; padding-inline-start: var(--sp-5); display: grid; gap: var(--sp-2); }
.grid2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(18rem, 1fr)); gap: var(--sp-4); }
.sm { max-inline-size: 12rem; }
.row { gap: var(--sp-2); flex-wrap: wrap; }
p { margin: 0; }
</style>
