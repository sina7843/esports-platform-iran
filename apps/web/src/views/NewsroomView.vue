<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { zonedWallTimeToUtc } from '@esp/contracts';
import type { ApiClientError } from '../api/client';
import { esp03 } from '../api/esp03';
import { esp06 as esp06Api, type ProjectedMatch } from '../api/esp06';
import ErrorNote from '../components/ErrorNote.vue';
import FormField from '../components/FormField.vue';
import JalaliDate from '../components/JalaliDate.vue';
import PageHeader from '../components/PageHeader.vue';
import StatusBadge from '../components/StatusBadge.vue';
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
const edit = reactive<Record<string, { body: string; reason: string; when: string; note: string }>>({});
const editOf = (id: string, body = '') => (edit[id] ??= { body, reason: '', when: '', note: '' });
const asg = reactive({ principalId: '', role: 'reporter', matchId: '', note: '' });
const hand = reactive<Record<string, { to: string; note: string }>>({});
const handOf = (id: string) => (hand[id] ??= { to: '', note: '' });
const sideNames = (m: ProjectedMatch) => m.sides.map((s) => s.displayName).join(' — ');
const live = computed(() => matches.value.filter((m) => m.state === 'live' || m.state === 'provisional'));
</script>

<template>
  <PageHeader :title="t('nav.newsroom')" :lead="t('nr.lead')" />
  <form class="row" @submit.prevent="loadAll">
    <label for="nr-ev">{{ t('ref.eventId') }}</label>
    <input id="nr-ev" v-model="eventId" class="input ltr" />
    <button type="submit" class="btn btn-sm" :disabled="!eventId">{{ t('ref.load') }}</button>
    <RouterLink v-if="eventId" class="btn btn-sm" :to="`/events/${eventId}/live?view=latest`">{{ t('nr.openLive') }}</RouterLink>
  </form>
  <ErrorNote :error="failure" />
  <p v-if="notice" role="status" class="ok">{{ notice }}</p>

  <div v-if="eventId" class="layout">
    <!-- data next to the editor (EDIT-002) -->
    <aside class="card stack" :aria-label="t('nr.data')">
      <h2>{{ t('nr.data') }}</h2>
      <h3>{{ t('live.now') }}</h3>
      <ul class="list small"><li v-for="m in live" :key="m.id"><bdi>{{ sideNames(m) }}</bdi> <StatusBadge :state="m.state" /></li></ul>
      <h3>{{ t('live.tab.schedule') }}</h3>
      <ul class="list small"><li v-for="m in matches.slice(0, 30)" :key="m.id"><button type="button" class="link" @click="draft.matchId = m.id; loadTemplates()"><bdi>{{ sideNames(m) }}</bdi></button> <JalaliDate :iso="m.scheduledAt" format="time" /> <StatusBadge :state="m.state" /></li></ul>
    </aside>

    <section class="card stack" aria-labelledby="ed-h">
      <h2 id="ed-h">{{ t('nr.editor') }}</h2>
      <div class="grid">
        <FormField id="ed-k" :label="t('nr.kind')"><template #default="{ id: fid }"><select :id="fid" v-model="draft.kind" class="input"><option v-for="k in ['text', 'image', 'video', 'quote', 'link', 'result', 'notice', 'decision']" :key="k" :value="k">{{ t(`nr.k.${k}` as never) }}</option></select></template></FormField>
        <FormField id="ed-f" :label="t('news.format')"><template #default="{ id: fid }"><select :id="fid" v-model="draft.format" class="input"><option v-for="x in ['live', 'article', 'report', 'interview', 'gallery']" :key="x" :value="x">{{ t(`news.fmt.${x}` as never) }}</option></select></template></FormField>
        <FormField id="ed-m" :label="t('case.match')"><template #default="{ id: fid }"><select :id="fid" v-model="draft.matchId" class="input" @change="loadTemplates"><option value="">—</option><option v-for="m in matches" :key="m.id" :value="m.id">{{ m.slot?.key }} {{ sideNames(m) }}</option></select></template></FormField>
      </div>
      <div v-if="templates.length" class="row"><span class="small">{{ t('nr.templates') }}:</span><button v-for="tp in templates" :key="tp.key" type="button" class="btn btn-sm" @click="draft.title = tp.title; draft.body = tp.body">{{ t(`nr.tpl.${tp.key}` as never) }}</button></div>
      <p v-if="draft.kind === 'result'" class="muted small">{{ t('nr.resultHint') }}</p>
      <FormField v-if="draft.kind !== 'result'" id="ed-t" :label="t('nr.title')"><template #default="{ id: fid }"><input :id="fid" v-model="draft.title" class="input" dir="auto" maxlength="200" /></template></FormField>
      <FormField id="ed-b" :label="t('nr.body')" :hint="t('nr.bodyHint')"><template #default="{ id: fid, describedBy }"><textarea :id="fid" v-model="draft.body" class="input" rows="6" dir="auto" :aria-describedby="describedBy" /></template></FormField>
      <div v-if="draft.kind === 'quote'" class="grid">
        <FormField id="ed-qt" :label="t('nr.quote')"><template #default="{ id: fid }"><input :id="fid" v-model="draft.quoteText" class="input" dir="auto" /></template></FormField>
        <FormField id="ed-qs" :label="t('nr.speaker')"><template #default="{ id: fid }"><input :id="fid" v-model="draft.quoteSpeaker" class="input" dir="auto" /></template></FormField>
      </div>
      <FormField v-if="draft.kind === 'link'" id="ed-l" :label="t('nr.link')"><template #default="{ id: fid }"><input :id="fid" v-model="draft.linkUrl" type="url" class="input ltr" /></template></FormField>
      <div class="grid">
        <FormField id="ed-c" :label="t('news.category')"><template #default="{ id: fid }"><input :id="fid" v-model="draft.category" class="input" dir="auto" /></template></FormField>
        <FormField id="ed-tg" :label="t('nr.tags')"><template #default="{ id: fid }"><input :id="fid" v-model="draft.tags" class="input" dir="auto" /></template></FormField>
        <FormField id="ed-sd" :label="t('nr.seo')"><template #default="{ id: fid }"><input :id="fid" v-model="draft.seoDescription" class="input" dir="auto" maxlength="170" /></template></FormField>
      </div>
      <div class="row">
        <label><input v-model="draft.spoiler" type="checkbox" /> {{ t('nr.spoiler') }}</label>
        <label><input v-model="draft.official" type="checkbox" /> {{ t('nr.official') }}</label>
      </div>
      <button type="button" class="btn btn-primary" :disabled="draft.kind !== 'result' && draft.title.trim().length < 3" @click="create">{{ t('nr.saveDraft') }}</button>
      <ul v-if="warnings.length" class="warn small"><li v-for="w in warnings" :key="w">{{ t('nr.duplicate') }}: <span class="ltr">{{ w }}</span></li></ul>
    </section>
  </div>

  <section v-if="eventId" class="card stack block" aria-labelledby="q-h">
    <h2 id="q-h">{{ t('nr.queue') }}</h2>
    <p v-if="!queue.length" class="muted">{{ t('live.none') }}</p>
    <article v-for="p in queue" :key="p._id" class="item stack">
      <div class="row between"><strong dir="auto">{{ p.title }}</strong><span class="row"><span class="small">{{ t(`live.src.${p.source}` as never) }}</span><StatusBadge :state="p.state" /></span></div>
      <p v-if="p.reviewNote" class="warn small" dir="auto">{{ t('nr.reviewNote') }}: {{ p.reviewNote }}</p>
      <p class="small muted">{{ t('nr.visibility') }}: <span v-for="v in p.visibility" :key="v.view">{{ v.label ?? t('live.latest') }} → <JalaliDate :iso="v.at" format="time" />; </span></p>
      <div class="row">
        <button v-if="p.state === 'draft'" type="button" class="btn btn-sm" @click="act(() => esp06.postStep(p._id, 'submit', p.version))">{{ t('nr.submit') }}</button>
        <button v-if="['draft', 'in_review', 'scheduled'].includes(p.state)" type="button" class="btn btn-sm btn-primary" @click="act(() => esp06.postStep(p._id, 'publish', p.version))">{{ t('nr.publish') }}</button>
        <template v-if="['draft', 'in_review'].includes(p.state)">
          <label class="sr-only" :for="`w-${p._id}`">{{ t('nr.when') }}</label>
          <input :id="`w-${p._id}`" v-model="editOf(p._id).when" type="datetime-local" class="input" />
          <button type="button" class="btn btn-sm" :disabled="!editOf(p._id).when" @click="act(() => esp06.schedulePost(p._id, zonedWallTimeToUtc(editOf(p._id).when), p.version))">{{ t('nr.schedule') }}</button>
        </template>
        <button v-if="p.state === 'in_review'" type="button" class="btn btn-sm" @click="act(() => esp06.returnPost(p._id, editOf(p._id).note || 'نیاز به اصلاح', p.version))">{{ t('nr.return') }}</button>
        <template v-if="['published', 'corrected'].includes(p.state)">
          <button type="button" class="btn btn-sm" @click="act(() => esp06.flagPost(p._id, { pinned: !p['pinned'] }))">{{ p['pinned'] ? t('nr.unpin') : t('nr.pin') }}</button>
          <button type="button" class="btn btn-sm" @click="act(() => esp06.flagPost(p._id, { highlighted: !p['highlighted'] }))">{{ t('nr.highlight') }}</button>
        </template>
      </div>
      <details>
        <summary class="small">{{ t('nr.more') }}</summary>
        <div class="stack">
          <FormField :id="`eb-${p._id}`" :label="t('nr.body')"><template #default="{ id: fid }"><textarea :id="fid" v-model="editOf(p._id, String(p['body'] ?? '')).body" class="input" rows="3" dir="auto" /></template></FormField>
          <FormField :id="`er-${p._id}`" :label="t('nr.reason')" :hint="t('nr.reasonHint')"><template #default="{ id: fid, describedBy }"><input :id="fid" v-model="editOf(p._id).reason" class="input" dir="auto" :aria-describedby="describedBy" /></template></FormField>
          <div class="row">
            <button type="button" class="btn btn-sm" @click="act(() => esp06.editPost(p._id, { body: editOf(p._id).body, reason: editOf(p._id).reason, expectedVersion: p.version }))">{{ t('nr.saveEdit') }}</button>
            <button v-if="['published', 'corrected', 'scheduled'].includes(p.state)" type="button" class="btn btn-sm" :disabled="editOf(p._id).reason.length < 5" @click="act(() => esp06.withdrawPost(p._id, editOf(p._id).reason, p.version))">{{ t('nr.withdraw') }}</button>
          </div>
          <template v-if="['draft', 'in_review'].includes(p.state)">
            <h4>{{ t('nr.media') }}</h4>
            <input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" class="input" :aria-label="t('nr.media')" @change="mediaOf(p._id).file = ($event.target as HTMLInputElement).files?.[0] ?? null" />
            <div class="grid">
              <input v-model="mediaOf(p._id).caption" class="input" dir="auto" :placeholder="t('nr.caption')" :aria-label="t('nr.caption')" />
              <input v-model="mediaOf(p._id).credit" class="input" dir="auto" :placeholder="t('nr.credit')" :aria-label="t('nr.credit')" />
              <select v-model="mediaOf(p._id).rights" class="input" :aria-label="t('nr.rights')"><option v-for="r in ['owned', 'licensed', 'press', 'creative_commons', 'participant_submitted']" :key="r" :value="r">{{ t(`nr.r.${r}` as never) }}</option></select>
            </div>
            <label><input v-model="mediaOf(p._id).consentRequired" type="checkbox" /> {{ t('nr.consentRequired') }}</label>
            <label><input v-model="mediaOf(p._id).consentObtained" type="checkbox" /> {{ t('nr.consentObtained') }}</label>
            <button type="button" class="btn btn-sm" :disabled="!mediaOf(p._id).file || mediaOf(p._id).credit.length < 2" @click="attach(p._id)">{{ t('nr.attach') }}</button>
          </template>
          <h4>{{ t('nr.notes') }}</h4>
          <ul class="list small"><li v-for="(n, i) in p.internalNotes" :key="i" dir="auto"><JalaliDate :iso="n.at" format="time" /> — {{ n.text }}</li></ul>
          <div class="row">
            <input v-model="editOf(p._id).note" class="input grow" dir="auto" :placeholder="t('nr.note')" :aria-label="t('nr.note')" />
            <button type="button" class="btn btn-sm" :disabled="!editOf(p._id).note" @click="act(() => esp06.postNote(p._id, editOf(p._id).note))">{{ t('nr.addNote') }}</button>
          </div>
        </div>
      </details>
    </article>
  </section>

  <section v-if="eventId" class="card stack block" aria-labelledby="as-h">
    <h2 id="as-h">{{ t('nr.assignments') }}</h2>
    <ul class="list"><li v-for="a in assignments" :key="a._id"><bdi class="ltr">{{ a.principalId }}</bdi> — {{ t(`nr.role.${a.role}` as never) }} <StatusBadge :state="a.state" /> <span v-if="a.note" class="small" dir="auto">{{ a.note }}</span>
      <template v-if="a.state === 'active'">
        <input v-model="handOf(a._id).to" class="input ltr narrow" :placeholder="t('nr.handTo')" :aria-label="t('nr.handTo')" />
        <input v-model="handOf(a._id).note" class="input" dir="auto" :placeholder="t('nr.handNote')" :aria-label="t('nr.handNote')" />
        <button type="button" class="btn btn-sm" :disabled="!handOf(a._id).to || handOf(a._id).note.length < 5" @click="act(() => esp06.handover(a._id, handOf(a._id).to, handOf(a._id).note))">{{ t('nr.handover') }}</button>
      </template></li></ul>
    <form class="row" @submit.prevent="act(() => esp06.assign(eventId, { principalId: asg.principalId, role: asg.role, matchId: asg.matchId || null, from: new Date().toISOString(), to: null, note: asg.note || null }))">
      <input v-model="asg.principalId" class="input ltr" :placeholder="t('res.principal')" :aria-label="t('res.principal')" />
      <select v-model="asg.role" class="input" :aria-label="t('res.roleLabel')"><option v-for="r in ['reporter', 'photographer', 'editor']" :key="r" :value="r">{{ t(`nr.role.${r}` as never) }}</option></select>
      <input v-model="asg.note" class="input" dir="auto" :placeholder="t('nr.note')" :aria-label="t('nr.note')" />
      <button type="submit" class="btn btn-sm" :disabled="!asg.principalId">{{ t('res.appoint') }}</button>
    </form>
    <button type="button" class="btn" @click="act(() => esp06.finalReport(eventId), t('nr.reportDrafted'))">{{ t('nr.finalReport') }}</button>
  </section>

  <section v-if="eventId && reports.length" class="card stack block" aria-labelledby="md-h">
    <h2 id="md-h">{{ t('nr.moderation') }}</h2>
    <ul class="list"><li v-for="r in reports" :key="r._id"><span dir="auto">«{{ r.content }}»</span> — <span dir="auto">{{ r.reason }}</span>
      <button type="button" class="btn btn-sm" @click="act(() => esp06.moderate(r._id, 'hide', 'قوانین جامعه'))">{{ t('nr.hide') }}</button>
      <button type="button" class="btn btn-sm" @click="act(() => esp06.moderate(r._id, 'dismiss', ''))">{{ t('nr.dismiss') }}</button></li></ul>
  </section>
</template>

<style scoped>
.row { display: flex; flex-wrap: wrap; gap: var(--sp-2); align-items: center; }
.between { justify-content: space-between; }
.layout { display: grid; grid-template-columns: minmax(14rem, 1fr) 2fr; gap: var(--sp-3); margin-block-start: var(--sp-3); }
@media (max-width: 52rem) { .layout { grid-template-columns: 1fr; } }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr)); gap: var(--sp-2); }
.list { margin: 0; padding-inline-start: var(--sp-5); }
.item { border-block-end: 1px solid var(--border); padding-block: var(--sp-2); }
.block { margin-block-start: var(--sp-4); }
.link { background: none; border: 0; padding: 0; color: inherit; text-decoration: underline; cursor: pointer; }
.narrow { inline-size: 9rem; }
.grow { flex: 1 1 12rem; }
.small { font-size: var(--fs-xs); }
.warn { color: var(--warn); }
.ok { color: var(--ok); }
h2, h3, h4, p { margin: 0; }
</style>
