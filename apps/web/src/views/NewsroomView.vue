<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { QAlert, QButton, QCard, QCheckbox, QContainer, QDateField, QEmptyState, QFileUpload, QPageHeader, QSelect, QStatusBadge, QTextField, formatJalali, useToast } from '@esp/ui';
import type { ApiClientError } from '../api/client';
import { esp03 } from '../api/esp03';
import { esp06 as esp06Api, type ProjectedMatch } from '../api/esp06';
import { toClientError } from '../errors';
import { t } from '../i18n';
/**
 * EDIT-001..007 newsroom: event schedule/data next to the editor, quick templates with engine-written result text,
 * mobile upload (original private, display variant public with rights and consent), draft → review → scheduled or
 * editor publish, internal notes, duplicate warnings, per-stream visibility preview (CAST-007), assignments with
 * shift handover, the final-report draft and the community moderation queue.
 */
const esp06: typeof esp06Api = esp06Api;
const route = useRoute();
const router = useRouter();
const eventId = ref(typeof route.query['event'] === 'string' ? route.query['event'] : '');
const queue = ref<Awaited<ReturnType<typeof esp06.queue>>['items']>([]);
const matches = ref<ProjectedMatch[]>([]);
const assignments = ref<Awaited<ReturnType<typeof esp06.assignments>>['items']>([]);
const reports = ref<Awaited<ReturnType<typeof esp06.moderation>>['items']>([]);
const failure = ref<ApiClientError | null>(null);
const notice = ref('');
const warnings = ref<string[]>([]);
async function act(fn: () => Promise<unknown>, ok = t('case.saved')) {
  failure.value = null;
  notice.value = '';
  try {
    await fn();
    notice.value = ok;
    await loadAll();
  } catch (e) {
    failure.value = toClientError(e);
  }
}
async function loadAll() {
  if (!eventId.value) return;
  void router.replace({ query: { event: eventId.value } });
  try {
    queue.value = (await esp06.queue(eventId.value)).items;
    // newsroom staff see the latest view (they are not the delayed audience)
    matches.value = ((await esp06.tab<{ items: ProjectedMatch[] }>(eventId.value, 'schedule', { latest: true })).items) ?? [];
    assignments.value = (await esp06.assignments(eventId.value)).items;
    reports.value = (await esp06.moderation(eventId.value).catch(() => ({ items: [] }))).items;
  } catch (e) {
    failure.value = toClientError(e);
  }
}
const draft = reactive({ kind: 'text', format: 'live', title: '', body: '', matchId: '', spoiler: true, official: false, category: 'news', tags: '', seoDescription: '', quoteText: '', quoteSpeaker: '', linkUrl: '' });
const templates = ref<Array<{ key: string; title: string; body: string }>>([]);
async function loadTemplates() {
  templates.value = draft.matchId ? (await esp06.templates(draft.matchId)).templates : [];
}
async function create() {
  failure.value = null;
  try {
    const r = await esp06.createPost({
      eventId: eventId.value, kind: draft.kind, format: draft.format, title: draft.title, body: draft.body, spoiler: draft.spoiler, official: draft.official, category: draft.category,
      tags: draft.tags.split(/[,،]/).map((x) => x.trim()).filter(Boolean),
      relations: draft.matchId ? { matchId: draft.matchId } : {},
      ...(draft.kind === 'quote' ? { quote: { text: draft.quoteText, speaker: draft.quoteSpeaker } } : {}),
      ...(draft.kind === 'link' ? { link: { url: draft.linkUrl, label: draft.title } } : {}),
      ...(draft.seoDescription ? { seo: { description: draft.seoDescription } } : {}),
    });
    warnings.value = r.warnings;
    notice.value = t('nr.created');
    draft.title = '';
    draft.body = '';
    await loadAll();
  } catch (e) {
    failure.value = toClientError(e);
  }
}
const media = reactive<Record<string, { file: File | null; caption: string; credit: string; rights: string; consentRequired: boolean; consentObtained: boolean }>>({});
const mediaOf = (id: string) => (media[id] ??= { file: null, caption: '', credit: '', rights: 'owned', consentRequired: false, consentObtained: false });
async function attach(postId: string) {
  const m = mediaOf(postId);
  if (!m.file) return;
  await act(async () => {
    // the original stays private to the uploader; the server publishes a metadata-stripped display copy
    const up = await esp03.uploadFile(m.file!, { visibility: 'private', scopeType: 'event', scopeId: eventId.value, retentionClass: 'media_original' });
    await esp06.postMedia(postId, { fileId: up.id, caption: m.caption || null, credit: m.credit, rights: m.rights, consent: { required: m.consentRequired, obtained: m.consentObtained, note: null } });
  }, t('nr.mediaAdded'));
}
const edit = reactive<Record<string, { body: string; reason: string; when: string | null; note: string }>>({});
const editOf = (id: string, body = '') => (edit[id] ??= { body, reason: '', when: null, note: '' });
const asg = reactive({ principalId: '', role: 'reporter', matchId: '', note: '' });
const hand = reactive<Record<string, { to: string; note: string }>>({});
const handOf = (id: string) => (hand[id] ??= { to: '', note: '' });
const sideNames = (m: ProjectedMatch) => m.sides.map((s) => s.displayName).join(' — ');
const live = computed(() => matches.value.filter((m) => m.state === 'live' || m.state === 'provisional'));
const { push } = useToast();
watch(notice, (n) => { if (n) push({ tone: 'success', message: n, duration: 3000 }); });
watch(failure, (f) => { if (f) push({ tone: 'danger', message: f.message }); });
const KINDS = computed(() => ['text', 'image', 'video', 'quote', 'link', 'result', 'notice', 'decision'].map((k) => ({ value: k, label: t(`nr.k.${k}` as never) })));
const FORMATS = computed(() => ['live', 'article', 'report', 'interview', 'gallery'].map((x) => ({ value: x, label: t(`news.fmt.${x}` as never) })));
const RIGHTS = computed(() => ['owned', 'licensed', 'press', 'creative_commons', 'participant_submitted'].map((r) => ({ value: r, label: t(`nr.r.${r}` as never) })));
const ROLES = computed(() => ['reporter', 'photographer', 'editor'].map((r) => ({ value: r, label: t(`nr.role.${r}` as never) })));
const matchOpts = computed(() => [{ value: '', label: '—' }, ...matches.value.map((m) => ({ value: m.id, label: `${m.slot?.key ?? ''} ${sideNames(m)}` }))]);
const matchModel = computed({ get: () => draft.matchId, set: (v: string) => { draft.matchId = v; void loadTemplates(); } });
const pick = (id: string) => { draft.matchId = id; void loadTemplates(); };
const bool = (get: () => boolean, set: (v: boolean) => void) => computed({ get, set: (v: boolean | null) => set(!!v) });
const spoiler = bool(() => draft.spoiler, (v) => { draft.spoiler = v; });
const official = bool(() => draft.official, (v) => { draft.official = v; });
const schedule = (id: string, version: number) => act(() => esp06.schedulePost(id, new Date(editOf(id).when!).toISOString(), version));
</script>

<template>
  <QContainer>
    <div class="k-stack p-nr">
      <QPageHeader compact :title="t('nav.newsroom')" :description="t('nr.lead')">
        <template v-if="eventId" #actions><QButton variant="secondary" size="sm" icon="broadcast" :href="`/events/${eventId}/live?view=latest`">{{ t('nr.openLive') }}</QButton></template>
      </QPageHeader>
      <QCard>
        <form class="p-nr-pick" novalidate @submit.prevent="loadAll">
          <QTextField id="nr-ev" v-model="eventId" :label="t('ref.eventId')" ltr />
          <QButton type="submit" variant="secondary" :disabled="!eventId">{{ t('ref.load') }}</QButton>
        </form>
      </QCard>
      <QEmptyState v-if="!eventId" icon="news" :title="t('nr.pickEvent')" />

      <template v-else>
        <div class="p-nr-layout">
          <QCard as="aside" :aria-label="t('nr.data')">
            <div class="k-stack">
              <h2 class="h4 p-nr-p">{{ t('nr.data') }}</h2>
              <h3 class="p-nr-h3">{{ t('live.now') }}</h3>
              <ul class="p-nr-list"><li v-for="m in live" :key="m.id"><bdi>{{ sideNames(m) }}</bdi> <QStatusBadge :state="m.state" /></li><li v-if="!live.length" class="p-nr-muted">—</li></ul>
              <h3 class="p-nr-h3">{{ t('live.tab.schedule') }}</h3>
              <ul class="p-nr-list">
                <li v-for="m in matches.slice(0, 30)" :key="m.id">
                  <button type="button" class="p-nr-link" :aria-pressed="draft.matchId === m.id" @click="pick(m.id)"><bdi>{{ sideNames(m) }}</bdi></button>
                  <span class="p-nr-muted">{{ formatJalali(m.scheduledAt, 'time') }}</span> <QStatusBadge :state="m.state" />
                </li>
              </ul>
            </div>
          </QCard>

          <QCard>
            <div class="k-stack">
              <h2 class="h4 p-nr-p">{{ t('nr.editor') }}</h2>
              <div class="p-nr-grid">
                <QSelect id="ed-k" v-model="draft.kind" :label="t('nr.kind')" :options="KINDS" />
                <QSelect id="ed-f" v-model="draft.format" :label="t('news.format')" :options="FORMATS" />
                <QSelect id="ed-m" v-model="matchModel" :label="t('case.match')" :options="matchOpts" />
              </div>
              <div v-if="templates.length" class="k-row"><span class="p-nr-muted">{{ t('nr.templates') }}:</span><QButton v-for="tp in templates" :key="tp.key" size="sm" variant="secondary" @click="draft.title = tp.title; draft.body = tp.body">{{ t(`nr.tpl.${tp.key}` as never) }}</QButton></div>
              <QAlert v-if="draft.kind === 'result'" tone="info">{{ t('nr.resultHint') }}</QAlert>
              <QTextField v-else id="ed-t" v-model="draft.title" :label="t('nr.title')" :max-length="200" />
              <QTextField id="ed-b" v-model="draft.body" :label="t('nr.body')" :hint="t('nr.bodyHint')" multiline :rows="6" />
              <div v-if="draft.kind === 'quote'" class="p-nr-grid">
                <QTextField id="ed-qt" v-model="draft.quoteText" :label="t('nr.quote')" />
                <QTextField id="ed-qs" v-model="draft.quoteSpeaker" :label="t('nr.speaker')" />
              </div>
              <QTextField v-if="draft.kind === 'link'" id="ed-l" v-model="draft.linkUrl" :label="t('nr.link')" type="url" ltr />
              <div class="p-nr-grid">
                <QTextField id="ed-c" v-model="draft.category" :label="t('news.category')" />
                <QTextField id="ed-tg" v-model="draft.tags" :label="t('nr.tags')" />
                <QTextField id="ed-sd" v-model="draft.seoDescription" :label="t('nr.seo')" :max-length="170" show-count />
              </div>
              <div class="k-row"><QCheckbox v-model="spoiler" :label="t('nr.spoiler')" /><QCheckbox v-model="official" :label="t('nr.official')" /></div>
              <div><QButton :disabled="draft.kind !== 'result' && draft.title.trim().length < 3" @click="create">{{ t('nr.saveDraft') }}</QButton></div>
              <QAlert v-if="warnings.length" tone="warning"><ul class="p-nr-list"><li v-for="w in warnings" :key="w">{{ t('nr.duplicate') }}: <bdi class="q-ltr">{{ w }}</bdi></li></ul></QAlert>
            </div>
          </QCard>
        </div>

        <section class="k-stack" aria-labelledby="q-h">
          <h2 id="q-h" class="h4 p-nr-p">{{ t('nr.queue') }}</h2>
          <QEmptyState v-if="!queue.length" compact icon="inbox" :title="t('live.none')" />
          <QCard v-for="p in queue" :key="p._id">
            <div class="k-stack">
              <div class="p-nr-head"><strong><bdi>{{ p.title }}</bdi></strong><span class="k-row"><span class="p-nr-muted">{{ t(`live.src.${p.source}` as never) }}</span><QStatusBadge :state="p.state" /></span></div>
              <QAlert v-if="p.reviewNote" tone="warning">{{ t('nr.reviewNote') }}: <bdi>{{ p.reviewNote }}</bdi></QAlert>
              <p class="p-nr-muted">{{ t('nr.visibility') }}: <span v-for="v in p.visibility" :key="v.view">{{ v.label ?? t('live.latest') }} ← {{ formatJalali(v.at, 'time') }}؛ </span></p>
              <div class="k-row">
                <QButton v-if="p.state === 'draft'" size="sm" variant="secondary" @click="act(() => esp06.postStep(p._id, 'submit', p.version))">{{ t('nr.submit') }}</QButton>
                <QButton v-if="['draft', 'in_review', 'scheduled'].includes(p.state)" size="sm" variant="green" @click="act(() => esp06.postStep(p._id, 'publish', p.version))">{{ t('nr.publish') }}</QButton>
                <QButton v-if="p.state === 'in_review'" size="sm" variant="ghost" @click="act(() => esp06.returnPost(p._id, editOf(p._id).note || 'نیاز به اصلاح', p.version))">{{ t('nr.return') }}</QButton>
                <template v-if="['published', 'corrected'].includes(p.state)">
                  <QButton size="sm" variant="secondary" @click="act(() => esp06.flagPost(p._id, { pinned: !p['pinned'] }))">{{ p['pinned'] ? t('nr.unpin') : t('nr.pin') }}</QButton>
                  <QButton size="sm" variant="secondary" icon="star" @click="act(() => esp06.flagPost(p._id, { highlighted: !p['highlighted'] }))">{{ t('nr.highlight') }}</QButton>
                </template>
              </div>
              <div v-if="['draft', 'in_review'].includes(p.state)" class="p-nr-sched">
                <QDateField :id="`w-${p._id}`" v-model="editOf(p._id).when" :label="t('nr.when')" with-time disable-past />
                <QButton size="sm" variant="secondary" icon="clock" :disabled="!editOf(p._id).when" @click="schedule(p._id, p.version)">{{ t('nr.schedule') }}</QButton>
              </div>
              <details class="p-nr-more">
                <summary>{{ t('nr.more') }}</summary>
                <div class="k-stack">
                  <QTextField :id="`eb-${p._id}`" v-model="editOf(p._id, String(p['body'] ?? '')).body" :label="t('nr.body')" multiline :rows="3" />
                  <QTextField :id="`er-${p._id}`" v-model="editOf(p._id).reason" :label="t('nr.reason')" :hint="t('nr.reasonHint')" />
                  <div class="k-row">
                    <QButton size="sm" variant="secondary" @click="act(() => esp06.editPost(p._id, { body: editOf(p._id).body, reason: editOf(p._id).reason, expectedVersion: p.version }))">{{ t('nr.saveEdit') }}</QButton>
                    <QButton v-if="['published', 'corrected', 'scheduled'].includes(p.state)" size="sm" variant="danger" :disabled="editOf(p._id).reason.length < 5" @click="act(() => esp06.withdrawPost(p._id, editOf(p._id).reason, p.version))">{{ t('nr.withdraw') }}</QButton>
                  </div>
                  <template v-if="['draft', 'in_review'].includes(p.state)">
                    <QFileUpload :id="`mf-${p._id}`" :label="t('nr.media')" accept="image/jpeg,image/png,image/webp" :multiple="false" :files="mediaOf(p._id).file ? [{ name: mediaOf(p._id).file!.name, size: mediaOf(p._id).file!.size, scanState: 'pending' }] : []" @files="(fs) => (mediaOf(p._id).file = fs[0] ?? null)" />
                    <div class="p-nr-grid">
                      <QTextField :id="`mc-${p._id}`" v-model="mediaOf(p._id).caption" :label="t('nr.caption')" />
                      <QTextField :id="`mr-${p._id}`" v-model="mediaOf(p._id).credit" :label="t('nr.credit')" />
                      <QSelect :id="`mt-${p._id}`" v-model="mediaOf(p._id).rights" :label="t('nr.rights')" :options="RIGHTS" />
                    </div>
                    <div class="k-row">
                      <QCheckbox :model-value="mediaOf(p._id).consentRequired" :label="t('nr.consentRequired')" @update:model-value="(v) => (mediaOf(p._id).consentRequired = !!v)" />
                      <QCheckbox :model-value="mediaOf(p._id).consentObtained" :label="t('nr.consentObtained')" @update:model-value="(v) => (mediaOf(p._id).consentObtained = !!v)" />
                    </div>
                    <div><QButton size="sm" variant="secondary" icon="upload" :disabled="!mediaOf(p._id).file || mediaOf(p._id).credit.length < 2" @click="attach(p._id)">{{ t('nr.attach') }}</QButton></div>
                  </template>
                  <h4 class="p-nr-h3">{{ t('nr.notes') }}</h4>
                  <ul class="p-nr-list"><li v-for="(n, i) in p.internalNotes" :key="i"><span class="p-nr-muted">{{ formatJalali(n.at, 'time') }}</span> — <bdi>{{ n.text }}</bdi></li></ul>
                  <div class="p-nr-sched">
                    <QTextField :id="`nn-${p._id}`" v-model="editOf(p._id).note" :label="t('nr.note')" />
                    <QButton size="sm" variant="secondary" :disabled="!editOf(p._id).note" @click="act(() => esp06.postNote(p._id, editOf(p._id).note))">{{ t('nr.addNote') }}</QButton>
                  </div>
                </div>
              </details>
            </div>
          </QCard>
        </section>

        <QCard>
          <div class="k-stack">
            <h2 class="h4 p-nr-p">{{ t('nr.assignments') }}</h2>
            <ul class="p-nr-rows">
              <li v-for="a in assignments" :key="a._id">
                <span><code class="q-mono q-ltr">{{ a.principalId }}</code> — {{ t(`nr.role.${a.role}` as never) }} <QStatusBadge :state="a.state" /> <span v-if="a.note" class="p-nr-muted"><bdi>{{ a.note }}</bdi></span></span>
                <span v-if="a.state === 'active'" class="p-nr-sched">
                  <QTextField :id="`ht-${a._id}`" v-model="handOf(a._id).to" :label="t('nr.handTo')" ltr />
                  <QTextField :id="`hn-${a._id}`" v-model="handOf(a._id).note" :label="t('nr.handNote')" />
                  <QButton size="sm" variant="secondary" :disabled="!handOf(a._id).to || handOf(a._id).note.length < 5" @click="act(() => esp06.handover(a._id, handOf(a._id).to, handOf(a._id).note))">{{ t('nr.handover') }}</QButton>
                </span>
              </li>
            </ul>
            <form class="p-nr-grid" novalidate @submit.prevent="act(() => esp06.assign(eventId, { principalId: asg.principalId, role: asg.role, matchId: asg.matchId || null, from: new Date().toISOString(), to: null, note: asg.note || null }))">
              <QTextField id="as-p" v-model="asg.principalId" :label="t('res.principal')" ltr />
              <QSelect id="as-r" v-model="asg.role" :label="t('res.roleLabel')" :options="ROLES" />
              <QTextField id="as-n" v-model="asg.note" :label="t('nr.note')" />
              <div><QButton type="submit" variant="green" icon="plus" :disabled="!asg.principalId">{{ t('res.appoint') }}</QButton></div>
            </form>
            <div><QButton variant="secondary" icon="file" @click="act(() => esp06.finalReport(eventId), t('nr.reportDrafted'))">{{ t('nr.finalReport') }}</QButton></div>
          </div>
        </QCard>

        <QCard v-if="reports.length">
          <div class="k-stack">
            <h2 class="h4 p-nr-p">{{ t('nr.moderation') }}</h2>
            <ul class="p-nr-rows">
              <li v-for="r in reports" :key="r._id">
                <span>«<bdi>{{ r.content }}</bdi>» — <span class="p-nr-muted"><bdi>{{ r.reason }}</bdi></span></span>
                <span class="k-row">
                  <QButton size="sm" variant="danger" @click="act(() => esp06.moderate(r._id, 'hide', 'قوانین جامعه'))">{{ t('nr.hide') }}</QButton>
                  <QButton size="sm" variant="ghost" @click="act(() => esp06.moderate(r._id, 'dismiss', ''))">{{ t('nr.dismiss') }}</QButton>
                </span>
              </li>
            </ul>
          </div>
        </QCard>
      </template>
    </div>
  </QContainer>
</template>

<style scoped>
.p-nr-pick { display: flex; flex-wrap: wrap; gap: var(--space-3); align-items: end; }
.p-nr-pick > :first-child { flex: 1 1 240px; }
.p-nr-layout { display: grid; grid-template-columns: minmax(240px, 1fr) 2fr; gap: var(--space-4); align-items: start; }
@media (max-width: 900px) { .p-nr-layout { grid-template-columns: 1fr; } }
.p-nr-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 180px), 1fr)); gap: var(--space-3); align-items: end; }
.p-nr-sched { display: flex; flex-wrap: wrap; gap: var(--space-3); align-items: end; }
.p-nr-head { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: var(--space-3); }
.p-nr-list { margin: 0; padding-inline-start: var(--space-5); display: grid; gap: var(--space-1); font-size: 13px; }
.p-nr-rows { margin: 0; padding: 0; list-style: none; }
.p-nr-rows > li { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: end; gap: var(--space-3); padding-block: var(--space-3); border-block-end: 1px solid var(--line); }
.p-nr-p { margin: 0; }
.p-nr-h3 { margin: 0; font-size: 14px; font-weight: 800; }
.p-nr-muted { margin: 0; color: var(--ink-muted); font-size: 13px; }
.p-nr-link { background: none; border: 0; padding: 0; color: var(--ink); text-decoration: underline; cursor: pointer; font: inherit; }
.p-nr-link[aria-pressed='true'] { color: var(--green-text); font-weight: 800; }
.p-nr-more > summary { cursor: pointer; font-weight: 700; font-size: 13px; color: var(--ink-muted); }
.p-nr-more[open] > summary { margin-block-end: var(--space-3); }
</style>
