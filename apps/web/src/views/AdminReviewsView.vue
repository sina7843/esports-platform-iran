<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { QAlert, QBadge, QButton, QCard, QCheckbox, QContainer, QDataState, QPageHeader, QSelect, QStatusBadge, QTabs, QTextField, fa, formatJalali, useToast } from '@esp/ui';
import type { ApiClientError } from '../api/client';
import { api } from '../api/client';
import { esp02 } from '../api/esp02';
import { esp03 as esp03Api } from '../api/esp03';
import { toClientError } from '../errors';
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

const appForm = reactive<Record<string, { action: string; note: string; level: string; maxEvents: string; maxCapacity: string; paid: boolean }>>({});
const form = (id: string) => (appForm[id] ??= { action: 'start_review', note: '', level: 'basic', maxEvents: '2', maxCapacity: '64', paid: false });
async function review(id: string, version: number) {
  failure.value = null;
  const f = form(id);
  const body: Record<string, unknown> = { action: f.action, note: f.note, expectedVersion: version };
  if (f.action === 'approve') Object.assign(body, { level: f.level, limits: { maxActiveEvents: Number(f.maxEvents), maxCapacityPerEvent: Number(f.maxCapacity), paidEventsAllowed: f.paid } });
  try {
    await esp02.reviewOrganizer(id, body);
    await apps.load();
  } catch (e) {
    failure.value = toClientError(e);
  }
}
const { push } = useToast();
watch(notice, (n) => { if (n) push({ tone: 'success', message: t('rv.done'), duration: 3000 }); });
watch(failure, (f) => { if (f) push({ tone: 'danger', message: f.message }); });
type L = { loading: { value: boolean }; error: { value: ApiClientError | null }; data: { value: { items: unknown[] } | null } };
const st = (l: L) => (l.error.value ? 'error' : !l.data.value ? 'loading' : !l.data.value.items.length ? 'empty' : 'content');
const tab = ref('accounts');
const tabs = computed(() => [
  { key: 'accounts', label: t('nav.accountReviews'), icon: 'users' as const, count: (reviews.data.value?.items ?? []).filter((r) => r.state === 'open').length },
  { key: 'ids', label: t('adm.pendingIds'), icon: 'gamepad' as const, count: pendingIds.data.value?.items.length ?? 0 },
  { key: 'levels', label: t('rv.levels'), icon: 'shield' as const },
  { key: 'ratings', label: t('adm.ratings'), icon: 'star' as const, count: ratings.data.value?.items.length ?? 0 },
  { key: 'apps', label: t('org.review'), icon: 'flag' as const, count: (apps.data.value?.items ?? []).filter((a) => !['approved', 'rejected'].includes(a.state)).length },
  { key: 'affs', label: t('evm.affReview'), icon: 'award' as const, count: affs.data.value?.items.length ?? 0 },
]);
const ACTIONS = ['start_review', 'request_info', 'approve', 'reject'].map((a) => ({ value: a, label: t(`rv.act.${a}` as never) }));
const LEVELS = ['basic', 'trusted', 'partner'].map((a) => ({ value: a, label: a }));
</script>

<template>
  <QContainer>
    <div class="k-stack p-rv">
      <QPageHeader compact :title="t('reviews.title')" :description="t('rv.lead')" :breadcrumb="[{ label: t('shell.platform_admin'), href: '/admin' }, { label: t('reviews.title') }]" />
      <QTabs v-model="tab" variant="line" overflow="scroll" :items="tabs" :aria-label="t('reviews.title')">
        <template #panel="{ item }">
          <div v-if="item.key === 'accounts'" class="k-stack">
            <QAlert tone="info">{{ t('reviews.noMerge') }}</QAlert>
            <QDataState v-if="st(reviews) !== 'content'" :state="st(reviews) as never" :error="reviews.error.value" skeleton="cards" @retry="reviews.load" />
            <div v-else class="p-rv-cards">
              <QCard v-for="r in reviews.data.value!.items" :key="r.id">
                <div class="k-stack">
                  <div class="p-rv-head"><span class="q-ltr"><bdi v-for="(p, i) in r.principals" :key="p.id">{{ i ? ' + ' : '' }}{{ p.nickname ?? p.id }}</bdi></span><QStatusBadge :state="r.state" /></div>
                  <p class="p-rv-p">{{ t('reviews.reason') }}: <bdi>{{ r.reason }}</bdi></p>
                  <p class="p-rv-muted">{{ formatJalali(r.createdAt) }}</p>
                  <template v-if="r.state === 'open'">
                    <QTextField :id="`n-${r.id}`" v-model="notes[r.id]" :label="t('org.note')" />
                    <div class="k-row">
                      <QButton size="sm" variant="green" :disabled="!notes[r.id]" @click="decide(r.id, 'resolved_distinct', r.version)">{{ t('reviews.distinct') }}</QButton>
                      <QButton size="sm" variant="secondary" :disabled="!notes[r.id]" @click="decide(r.id, 'resolved_merged_manually', r.version)">{{ t('reviews.mergedManually') }}</QButton>
                    </div>
                  </template>
                </div>
              </QCard>
            </div>
          </div>

          <div v-else-if="item.key === 'ids'">
            <QDataState v-if="st(pendingIds) !== 'content'" :state="st(pendingIds) as never" :error="pendingIds.error.value" skeleton="rows" @retry="pendingIds.load" />
            <QCard v-else padding="none">
              <ul class="p-rv-rows">
                <li v-for="g in pendingIds.data.value!.items" :key="g.id">
                  <span><code class="q-mono q-ltr">{{ g.principalId }}</code> · <bdi class="q-ltr">{{ g.gameId }} · {{ g.platform }}</bdi> · <code class="q-mono q-ltr">{{ g.value }}</code> <QStatusBadge :state="g.verification.state" /></span>
                  <QButton v-if="g.verification.state !== 'disputed'" size="sm" variant="green" @click="verifyId(g.id)">{{ t('adm.verify') }}</QButton>
                </li>
              </ul>
            </QCard>
          </div>

          <div v-else-if="item.key === 'levels'" class="p-rv-cols">
            <QCard>
              <form class="k-stack" novalidate @submit.prevent="setLevel">
                <h2 class="h4 p-rv-p">{{ t('adm.verifyLevel') }}</h2>
                <QTextField id="vl-p" v-model="level.principalId" :label="t('adm.principal')" required ltr />
                <QTextField id="vl-g" v-model="level.gameId" :label="t('adm.gameId')" required ltr />
                <QTextField id="vl-v" v-model="level.value" :label="t('adm.value')" />
                <div><QButton type="submit" variant="green" :disabled="!level.principalId || !level.gameId">{{ t('mgmt.save') }}</QButton></div>
              </form>
            </QCard>
            <QCard>
              <form class="k-stack" novalidate @submit.prevent="issueBadge">
                <h2 class="h4 p-rv-p">{{ t('adm.badge') }}</h2>
                <QSelect id="bd-k" v-model="badge.kind" :label="t('adm.badgeKind')" :options="[{ value: 'identity', label: t('badge.identity') }, { value: 'org_position', label: t('badge.org_position') }]" />
                <QTextField id="bd-p" v-model="badge.principalId" :label="t('adm.principal')" required ltr />
                <QTextField v-if="badge.kind === 'identity'" id="bd-r" v-model="badge.referenceText" :label="t('adm.reference')" />
                <template v-else>
                  <QTextField id="bd-o" v-model="badge.organizationId" :label="t('teams.orgId')" ltr />
                  <QTextField id="bd-pos" v-model="badge.position" :label="t('teams.role')" />
                </template>
                <div><QButton type="submit" variant="green" icon="award" :disabled="!badge.principalId">{{ t('adm.badge') }}</QButton></div>
              </form>
            </QCard>
          </div>

          <div v-else-if="item.key === 'ratings'">
            <QDataState v-if="st(ratings) !== 'content'" :state="st(ratings) as never" :error="ratings.error.value" skeleton="rows" @retry="ratings.load" />
            <QCard v-else padding="none">
              <ul class="p-rv-rows">
                <li v-for="r in ratings.data.value!.items" :key="r.id">
                  <div class="k-stack p-rv-grow">
                    <span><code class="q-mono q-ltr">{{ r.organizationId }} · {{ r.eventId }}</code> · <QBadge tone="neutral">{{ fa(r.score) }}</QBadge> <QStatusBadge :state="r.state" /></span>
                    <p class="p-rv-p"><bdi>{{ r.comment }}</bdi></p>
                  </div>
                  <span class="k-row">
                    <QTextField :id="`mr-${r.id}`" v-model="modReason[r.id]" :label="t('adm.reason')" hide-label :placeholder="t('adm.reason')" />
                    <QButton size="sm" :variant="r.state === 'hidden' ? 'secondary' : 'danger'" :disabled="(modReason[r.id] ?? '').length < 5" @click="moderate(r.id, r.state === 'hidden' ? 'unhide' : 'hide')">{{ r.state === 'hidden' ? t('adm.unhide') : t('adm.hide') }}</QButton>
                  </span>
                </li>
              </ul>
            </QCard>
          </div>

          <div v-else-if="item.key === 'apps'">
            <QDataState v-if="st(apps) !== 'content'" :state="st(apps) as never" :error="apps.error.value" skeleton="cards" @retry="apps.load" />
            <div v-else class="p-rv-cards">
              <QCard v-for="a in apps.data.value!.items" :key="a.id">
                <div class="k-stack">
                  <div class="p-rv-head"><code class="q-mono q-ltr">{{ a.organizationId }}</code><QBadge tone="neutral">{{ stateLabel(a.state) }}</QBadge></div>
                  <p class="p-rv-p"><bdi>{{ a.description }}</bdi></p>
                  <form v-if="!['approved', 'rejected'].includes(a.state)" class="k-stack" novalidate @submit.prevent="review(a.id, a.version)">
                    <QSelect :id="`a-${a.id}`" v-model="form(a.id).action" :label="t('org.action')" :options="ACTIONS" />
                    <template v-if="form(a.id).action === 'approve'">
                      <QSelect :id="`l-${a.id}`" v-model="form(a.id).level" :label="t('org.level')" :options="LEVELS" />
                      <div class="p-rv-grid">
                        <QTextField :id="`me-${a.id}`" v-model="form(a.id).maxEvents" :label="t('org.maxEvents')" type="number" ltr />
                        <QTextField :id="`mc-${a.id}`" v-model="form(a.id).maxCapacity" :label="t('org.maxCapacity')" type="number" ltr />
                      </div>
                      <QCheckbox :model-value="form(a.id).paid" :label="t('org.paidAllowed')" @update:model-value="(v) => (form(a.id).paid = !!v)" />
                    </template>
                    <QTextField :id="`no-${a.id}`" v-model="form(a.id).note" :label="t('org.note')" required />
                    <div><QButton type="submit" :variant="form(a.id).action === 'reject' ? 'danger' : 'green'" :disabled="!form(a.id).note">{{ t('org.submit') }}</QButton></div>
                  </form>
                </div>
              </QCard>
            </div>
          </div>

          <div v-else>
            <QDataState v-if="st(affs) !== 'content'" :state="st(affs) as never" :error="affs.error.value" skeleton="cards" @retry="affs.load" />
            <div v-else class="p-rv-cards">
              <QCard v-for="a in affs.data.value!.items" :key="a.eventId">
                <div class="k-stack">
                  <RouterLink :to="`/events/${a.eventId}`" class="p-rv-link"><bdi>{{ a.name }}</bdi></RouterLink>
                  <p class="p-rv-p">{{ t(`evm.aff.${a.affiliation.kind}` as never) }}: <bdi>{{ a.affiliation.body }}</bdi></p>
                  <div><QButton size="sm" variant="ghost" icon="file" @click="openEvidence(a.affiliation.evidenceFileId)">{{ t('evm.affEvidence') }}</QButton></div>
                  <QTextField :id="`afn-${a.eventId}`" v-model="affNote[a.eventId]" :label="t('evm.reason')" />
                  <div class="k-row">
                    <QButton size="sm" variant="green" :disabled="(affNote[a.eventId] ?? '').length < 5" @click="staff(() => esp03.decideAffiliation(a.eventId, 'verify', affNote[a.eventId] ?? ''), affs.load)">{{ t('evm.affVerify') }}</QButton>
                    <QButton size="sm" variant="danger" :disabled="(affNote[a.eventId] ?? '').length < 5" @click="staff(() => esp03.decideAffiliation(a.eventId, 'reject', affNote[a.eventId] ?? ''), affs.load)">{{ t('evm.reject') }}</QButton>
                  </div>
                </div>
              </QCard>
            </div>
          </div>
        </template>
      </QTabs>
    </div>
  </QContainer>
</template>

<style scoped>
.p-rv-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 320px), 1fr)); gap: var(--space-4); }
.p-rv-cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 360px), 1fr)); gap: var(--space-4); align-items: start; }
.p-rv-grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-3); }
.p-rv-head { display: flex; justify-content: space-between; align-items: center; gap: var(--space-3); flex-wrap: wrap; font-weight: 800; }
.p-rv-rows { margin: 0; padding: 0; list-style: none; }
.p-rv-rows > li { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: var(--space-3); padding: var(--space-3) var(--space-4); border-block-end: 1px solid var(--line); }
.p-rv-grow { flex: 1 1 260px; gap: var(--space-1); }
.p-rv-p { margin: 0; }
.p-rv-muted { margin: 0; color: var(--ink-muted); font-size: 13px; }
.p-rv-link { font-weight: 800; color: var(--ink); }
</style>
