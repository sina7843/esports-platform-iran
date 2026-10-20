<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import type { ApiClientError } from '../api/client';
import { esp03 } from '../api/esp03';
import { esp04 as esp04Api, type RoomView, type SelectionView } from '../api/esp04';
import { esp05 as esp05Api } from '../api/esp05';
import DataState from '../components/DataState.vue';
import ErrorNote from '../components/ErrorNote.vue';
import FormField from '../components/FormField.vue';
import JalaliDate from '../components/JalaliDate.vue';
import PageHeader from '../components/PageHeader.vue';
import StatusBadge from '../components/StatusBadge.vue';
import { toClientError } from '../errors';
import { num, t } from '../i18n';
import { secondsLeft, watchChannels } from '../live';

/**
 * ROOM-001..004, CFG-003/004, RUN-001..006: the match room. Spectators see the public part only (state, sides,
 * schedule, selection progress, safe timeline). The two sides and officials additionally get readiness, the server-timed
 * selection, chat, referee calls, lobby data on request (audited) and result entry; officials get the run controls.
 */
/** template alias (vue-tsc mis-types direct use of this import inside template arrow functions) */
const esp04: typeof esp04Api = esp04Api;
const route = useRoute();
const id = computed(() => String(route.params.id));
const token = computed(() => (typeof route.query['t'] === 'string' ? route.query['t'] : undefined));
const room = ref<RoomView | null>(null);
const sel = ref<SelectionView | null>(null);
const receivedAt = ref(Date.now());
const now = ref(Date.now());
const loading = ref(false);
const error = ref<ApiClientError | null>(null);
const failure = ref<ApiClientError | null>(null);
const notice = ref('');
const messages = ref<Array<{ _id: string; text: string; at: string; by: string }>>([]);
const lobby = ref<{ host: string; password: string } | null>(null);

async function load() {
  loading.value = !room.value;
  error.value = null;
  try {
    room.value = await esp04.room(id.value, token.value);
    receivedAt.value = Date.now();
    sel.value = await esp04.selection(id.value, token.value).catch(() => null);
    if (room.value.private) messages.value = (await esp04.messages(id.value)).items;
  } catch (e) {
    error.value = toClientError(e);
  } finally {
    loading.value = false;
  }
}
let stopWatch: (() => void) | null = null;
let clock: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  void load();
  stopWatch = watchChannels([`match:${id.value}`, `match:${id.value}:room`], () => void load());
  clock = setInterval(() => (now.value = Date.now()), 1000);
});
onBeforeUnmount(() => {
  stopWatch?.();
  clearInterval(clock);
});
watch(id, () => {
  stopWatch?.();
  lobby.value = null;
  void load();
  stopWatch = watchChannels([`match:${id.value}`, `match:${id.value}:room`], () => void load());
});

async function act(fn: () => Promise<unknown>, msg = '✓') {
  failure.value = null;
  notice.value = '';
  try {
    await fn();
    notice.value = msg;
    await load();
  } catch (e) {
    failure.value = toClientError(e);
  }
}
const pub = computed(() => room.value?.public);
const priv = computed(() => room.value?.private ?? null);
const isSide = computed(() => (priv.value?.side ?? -1) >= 0);
const official = computed(() => !!priv.value?.official);
const countdown = computed(() => (pub.value && priv.value?.countdownTo ? secondsLeft(priv.value.countdownTo, pub.value.serverTime, receivedAt.value, now.value) : null));
const turnLeft = computed(() => (sel.value ? secondsLeft(sel.value.turnDeadline, sel.value.serverTime, receivedAt.value, now.value) : null));
const turn = computed(() => {
  if (!sel.value || sel.value.state === 'complete') return null;
  const [kind, side] = (sel.value.sequence[sel.value.step] ?? '').split(':');
  return { kind: kind!, side: side === undefined ? null : Number(side) };
});
const myTurn = computed(() => !!turn.value && (turn.value.side === priv.value?.side || (official.value && sel.value?.state === 'waiting_referee')));
const readySides = computed(() => new Set((priv.value?.ready ?? []).map((r) => r.side)));

const chat = reactive({ text: '', channel: 'private' as 'private' | 'officials' });
const callReason = ref('');
const result = reactive({ winnerSide: 0, a: 0, b: 0 });
const runForm = reactive({ pauseKind: 'technical' as 'tactical' | 'technical', reason: '', decision: 'continue', side: 0, lobbyHost: '', lobbyPassword: '' });
async function loadLobby() {
  failure.value = null;
  try {
    lobby.value = await esp04.lobby(id.value);
  } catch (e) {
    failure.value = toClientError(e);
  }
}
// ROOM-003: evidence is uploaded private to this match, then referenced by the submission
const evidence = ref<File | null>(null);
const submit = () => act(async () => {
  const ids = evidence.value ? [(await esp03.uploadFile(evidence.value, { visibility: 'private', scopeType: 'match', scopeId: id.value, retentionClass: 'dispute_evidence' })).id] : [];
  await esp04.submitResult(id.value, { kind: 'win', winnerSide: result.winnerSide, maps: [result.a, result.b] }, ids);
  evidence.value = null;
}, t('room.submitted'));
// RES-002 confirmation / contest and AWD-002 lineup presence
const esp05: typeof esp05Api = esp05Api;
const contestClaim = ref('');
const lineupSel = reactive<Record<number, string[]>>({});
const mySubmitted = computed(() => !!priv.value?.result?.submissions.some((x) => x.side === priv.value?.side && x.source !== 'integration'));
const otherSubmitted = computed(() => !!priv.value?.result?.submissions.some((x) => x.side !== priv.value?.side && x.source !== 'integration'));
function lineupOf(side: number): string[] {
  return (lineupSel[side] ??= (priv.value?.lineup?.[side] ?? []).filter((r) => r.present).map((r) => r.principalId));
}
</script>

<template>
  <DataState :loading="loading" :error="error" @retry="load">
    <template v-if="pub">
      <PageHeader :title="pub.sides.map((s) => s.displayName).join(' — ') || t('match.title')">
        <template #title><bdi>{{ pub.sides.map((s) => s.displayName).join(' — ') || t('match.title') }}</bdi></template>
        <template #actions><StatusBadge :state="pub.state" /></template>
      </PageHeader>
      <p v-if="pub.publicNotice" class="notice-public" role="status" dir="auto">{{ pub.publicNotice }}</p>
      <dl class="meta">
        <div v-if="pub.stage"><dt>{{ t('room.stage') }}</dt><dd><RouterLink :to="`/stages/${pub.stageId}`"><bdi>{{ pub.stage.name }}</bdi></RouterLink></dd></div>
        <div v-if="pub.slot"><dt>{{ t('room.round') }}</dt><dd>{{ t('br.round', { n: num(pub.slot.round) }) }}<template v-if="pub.slot.group"> · {{ t('br.group', { g: pub.slot.group }) }}</template></dd></div>
        <div><dt>{{ t('match.scheduledAt') }}</dt><dd><JalaliDate :iso="pub.scheduledAt" /><span v-if="pub.estimated && pub.scheduledAt" class="muted"> ({{ t('br.estimated') }})</span></dd></div>
        <div v-if="pub.config"><dt>{{ t('room.format') }}</dt><dd>BO{{ num(pub.config.bestOf) }} · <bdi class="ltr">{{ pub.config.mode }} {{ pub.config.gameVersion }}</bdi><template v-if="pub.config.override"> · {{ pub.config.override }}</template></dd></div>
        <div v-if="pub.stationLabel"><dt>{{ t('room.station') }}</dt><dd>{{ pub.stationLabel }}</dd></div>
        <div v-if="pub.outcome"><dt>{{ t('room.result') }}</dt><dd>{{ (pub.outcome as { kind: string }).kind === 'win' ? t('room.winner', { side: pub.sides[(pub.outcome as { winnerSide: number }).winnerSide]?.displayName ?? '' }) : (pub.outcome as { kind: string }).kind }}</dd></div>
        <div v-if="pub.provisional"><dt>{{ t('room.result') }}</dt><dd class="warn">{{ t('room.provisional') }}</dd></div>
      </dl>

      <section class="grid2">
        <article v-for="(s, i) in pub.sides" :key="i" class="card stack">
          <h2><bdi>{{ s.displayName }}</bdi> <span v-if="readySides.has(i)" class="ok">✓ {{ t('room.ready') }}</span></h2>
          <ul class="list"><li v-for="r in s.roster" :key="r.displayName"><bdi>{{ r.displayName }}</bdi> <span class="muted">{{ r.role }}</span></li></ul>
        </article>
      </section>

      <!-- pre-game selection (public progress, private actions) -->
      <section v-if="sel" class="card stack block" aria-live="polite">
        <h2>{{ t('room.selection') }}</h2>
        <ol class="steps">
          <li v-for="(tok, i) in sel.sequence" :key="i" :class="{ current: i === sel.step && sel.state !== 'complete' }">
            <span class="muted">{{ t(`room.tok.${tok.split(':')[0]}` as never) }}{{ tok.includes(':') ? ` · ${pub.sides[Number(tok.split(':')[1])]?.displayName ?? ''}` : '' }}</span>
            <strong v-if="sel.actions.find((a) => a.step === i)">{{ sel.actions.find((a) => a.step === i)!.value }}</strong>
            <span v-if="sel.actions.find((a) => a.step === i)?.via === 'timeout'" class="muted small"> ({{ t('room.byRule') }})</span>
            <span v-if="sel.actions.find((a) => a.step === i)?.via === 'referee'" class="muted small"> ({{ t('room.byReferee') }})</span>
          </li>
        </ol>
        <p v-if="sel.state === 'waiting_referee'" class="warn" role="status">{{ t('room.waitingReferee') }}</p>
        <p v-else-if="turn && turnLeft !== null" role="timer" :aria-label="t('room.turnTimer')">{{ t('room.turnLeft', { s: num(turnLeft) }) }}</p>
        <div v-if="myTurn" class="row options">
          <button v-for="o in sel.options" :key="o" type="button" class="btn" @click="act(() => esp04.act(id, sel!.step, o))">{{ o }}</button>
        </div>
      </section>

      <!-- private area -->
      <section v-if="priv" class="card stack block">
        <h2>{{ t('room.private') }}</h2>
        <ErrorNote :error="failure" />
        <p v-if="notice" role="status" class="ok">{{ notice }}</p>
        <p v-if="priv.config.undecided.length" class="warn" role="note">{{ t('room.undecided') }}: <bdi class="ltr">{{ priv.config.undecided.join(', ') }}</bdi></p>
        <p v-if="countdown !== null" role="timer">{{ t('room.countdown', { s: num(countdown) }) }}</p>
        <div class="row">
          <button v-if="isSide && pub.state === 'awaiting_readiness' && !readySides.has(priv.side)" type="button" class="btn btn-primary" @click="act(() => esp04.ready(id))">{{ t('room.declareReady') }}</button>
          <button v-if="priv.lobbyAvailable && !lobby" type="button" class="btn" @click="loadLobby">{{ t('match.lobbyLoad') }}</button>
        </div>
        <p v-if="lobby" class="lobby" role="status">{{ t('match.lobbyHost') }}: <bdi class="ltr">{{ lobby.host }}</bdi> · {{ t('match.lobbyPassword') }}: <bdi class="ltr code">{{ lobby.password }}</bdi></p>
        <p class="muted small">{{ t('match.lobbyHint') }}</p>

        <details>
          <summary>{{ t('room.chat') }} ({{ num(messages.length) }})</summary>
          <ul class="chat" aria-live="polite"><li v-for="m in messages" :key="m._id"><span class="muted small"><JalaliDate :iso="m.at" format="time" /></span> <bdi dir="auto">{{ m.text }}</bdi></li></ul>
          <form class="row" novalidate @submit.prevent="act(async () => { await esp04.send(id, chat.text, chat.channel); chat.text = ''; }, '')">
            <label class="sr-only" for="chat-text">{{ t('room.message') }}</label>
            <input id="chat-text" v-model="chat.text" class="input grow" maxlength="1000" dir="auto" :placeholder="t('room.message')" />
            <select v-model="chat.channel" class="input" :aria-label="t('room.channel')"><option value="private">{{ t('room.toAll') }}</option><option value="officials">{{ t('room.toOfficials') }}</option></select>
            <button type="submit" class="btn btn-sm" :disabled="!chat.text.trim()">{{ t('room.send') }}</button>
          </form>
        </details>
        <form v-if="isSide" class="row" novalidate @submit.prevent="act(async () => { await esp04.callReferee(id, callReason); callReason = ''; }, t('room.called'))">
          <FormField id="call-r" :label="t('room.callReferee')"><template #default="{ id: fid }"><input :id="fid" v-model="callReason" class="input" dir="auto" /></template></FormField>
          <button type="submit" class="btn btn-sm" :disabled="callReason.trim().length < 3">{{ t('room.call') }}</button>
        </form>
        <ul v-if="priv.calls.length" class="list"><li v-for="c in priv.calls" :key="c._id" dir="auto">{{ c.reason }} — <StatusBadge :state="c.state" /> <button v-if="official && c.state !== 'closed'" type="button" class="btn btn-sm" @click="act(() => esp04.updateCall(c._id, 'closed'))">{{ t('room.closeCall') }}</button></li></ul>

        <section v-if="priv.lineup && ['awaiting_readiness', 'ready', 'pre_game_selection', 'live', 'paused'].includes(pub.state)" class="stack" aria-labelledby="lu-h">
          <h3 id="lu-h">{{ t('room.lineup') }}</h3>
          <template v-for="(roster, si) in priv.lineup" :key="si">
            <form v-if="roster" class="row" novalidate @submit.prevent="act(() => esp05.lineup(id, si, lineupOf(si)), t('room.lineupSaved'))">
              <fieldset class="row"><legend>{{ pub.sides[si]?.displayName }}</legend>
                <label v-for="r in roster" :key="r.principalId"><input v-model="lineupSel[si]" type="checkbox" :value="r.principalId" @focus="lineupOf(si)" /> <bdi>{{ r.displayName }}</bdi></label>
              </fieldset>
              <button type="submit" class="btn btn-sm">{{ t('room.saveLineup') }}</button>
            </form>
          </template>
          <p class="muted small">{{ t('room.lineupHint') }}</p>
        </section>
        <section v-if="priv.result && ['provisional', 'disputed'].includes(pub.state)" class="stack" aria-labelledby="rc-h">
          <h3 id="rc-h">{{ t('room.confirmTitle') }}</h3>
          <ul class="list"><li v-for="(x, i) in priv.result.submissions" :key="i">{{ x.side === null ? t('room.bySource', { s: x.source }) : pub.sides[x.side]?.displayName }} — {{ (x.outcome as { kind: string; winnerSide?: number }).kind === 'win' ? t('room.winner', { side: pub.sides[(x.outcome as { winnerSide: number }).winnerSide]?.displayName ?? '' }) : (x.outcome as { kind: string }).kind }} · <JalaliDate :iso="x.at" format="time" /></li></ul>
          <p v-if="priv.result.deadline" class="muted small">{{ t('room.confirmBy') }} <JalaliDate :iso="priv.result.deadline" /> · {{ priv.result.policy === 'on_deadline' ? t('room.autoConfirm') : t('room.officialConfirms') }}</p>
          <p v-if="priv.result.review" class="warn small">{{ t('room.integrationMismatch') }}</p>
          <p v-if="priv.openCaseId" class="warn"><RouterLink :to="`/cases/${priv.openCaseId}`">{{ t('room.openCase') }}</RouterLink></p>
          <div v-else-if="isSide && pub.state === 'provisional'" class="stack">
            <button v-if="otherSubmitted" type="button" class="btn btn-primary" @click="act(() => esp05.confirm(id), t('room.confirmed'))">{{ t('room.confirm') }}</button>
            <form class="row" novalidate @submit.prevent="act(async () => { const c = await esp05.contest(id, contestClaim); contestClaim = ''; return c; }, t('room.contested'))">
              <label class="sr-only" for="rc-claim">{{ t('room.contestClaim') }}</label>
              <input id="rc-claim" v-model="contestClaim" class="input grow" dir="auto" :placeholder="t('room.contestClaim')" />
              <button type="submit" class="btn" :disabled="contestClaim.trim().length < 10">{{ t('room.contest') }}</button>
            </form>
          </div>
        </section>
        <form v-if="(isSide || official) && (['live', 'paused'].includes(pub.state) || (isSide && pub.state === 'provisional' && !mySubmitted && !priv.openCaseId)) && pub.kind === 'head_to_head'" class="stack result" novalidate @submit.prevent="submit">
          <h3>{{ t('room.submitResult') }}</h3>
          <div class="row">
            <FormField id="res-w" :label="t('room.winnerSide')"><template #default="{ id: fid }"><select :id="fid" v-model.number="result.winnerSide" class="input"><option v-for="(s, i) in pub.sides" :key="i" :value="i">{{ s.displayName }}</option></select></template></FormField>
            <FormField id="res-a" :label="pub.sides[0]?.displayName ?? 'A'"><template #default="{ id: fid }"><input :id="fid" v-model.number="result.a" type="number" min="0" class="input ltr" /></template></FormField>
            <FormField id="res-b" :label="pub.sides[1]?.displayName ?? 'B'"><template #default="{ id: fid }"><input :id="fid" v-model.number="result.b" type="number" min="0" class="input ltr" /></template></FormField>
          </div>
          <FormField id="res-ev" :label="t('room.evidence')" :hint="t('reg.docPrivate')"><template #default="{ id: fid, describedBy }"><input :id="fid" type="file" accept="image/png,image/jpeg,application/pdf,video/mp4" class="input" :aria-describedby="describedBy" @change="evidence = ($event.target as HTMLInputElement).files?.[0] ?? null" /></template></FormField>
          <button type="submit" class="btn btn-primary">{{ t('room.submit') }}</button>
          <p class="muted small">{{ t('room.resultHint') }}</p>
        </form>
        <div v-if="isSide && ['live', 'paused'].includes(pub.state)" class="row">
          <button type="button" class="btn btn-sm" @click="act(() => esp04.pause(id, { kind: 'tactical', side: null, reason: 'tactical' }))">{{ t('room.tactical') }}</button>
          <button type="button" class="btn btn-sm" @click="act(() => esp04.disconnect(id, priv!.side))">{{ t('room.reportDisconnect') }}</button>
        </div>
      </section>

      <!-- officials -->
      <section v-if="official" class="card stack block">
        <h2>{{ t('room.officials') }}</h2>
        <div class="row">
          <button v-if="pub.state === 'scheduled'" type="button" class="btn" @click="act(() => esp04.openReadiness(id))">{{ t('room.openReadiness') }}</button>
          <button v-if="pub.state === 'ready' && priv!.config.vetoSequence.length && !sel" type="button" class="btn" @click="act(() => esp04.startSelection(id))">{{ t('room.startSelection') }}</button>
          <button v-if="['ready', 'pre_game_selection'].includes(pub.state)" type="button" class="btn btn-primary" @click="act(() => esp04.run(id, 'start'))">{{ t('room.start') }}</button>
          <button v-if="pub.state === 'paused'" type="button" class="btn" @click="act(() => esp04.run(id, 'resume'))">{{ t('room.resume') }}</button>
          <button v-if="pub.state === 'provisional'" type="button" class="btn btn-primary" @click="act(() => esp04.finalize(id))">{{ t('room.finalize') }}</button>
        </div>
        <form v-if="pub.state === 'live'" class="row" novalidate @submit.prevent="act(() => esp04.pause(id, { kind: runForm.pauseKind, side: null, reason: runForm.reason || 'official' }))">
          <select v-model="runForm.pauseKind" class="input" :aria-label="t('room.pauseKind')"><option value="technical">{{ t('room.technical') }}</option><option value="tactical">{{ t('room.tactical') }}</option></select>
          <input v-model="runForm.reason" class="input" dir="auto" :placeholder="t('evm.reason')" :aria-label="t('evm.reason')" />
          <button type="submit" class="btn btn-sm">{{ t('room.pause') }}</button>
        </form>
        <form v-if="['live', 'paused'].includes(pub.state)" class="row" novalidate @submit.prevent="act(() => esp04.decide(id, runForm.decision, runForm.reason))">
          <select v-model="runForm.decision" class="input" :aria-label="t('room.decision')"><option v-for="d in ['continue', 'replay', 'restore', 'forfeit_match']" :key="d" :value="d">{{ t(`room.dec.${d}` as never) }}</option></select>
          <input v-model="runForm.reason" class="input" dir="auto" :placeholder="t('evm.reason')" :aria-label="t('evm.reason')" />
          <button type="submit" class="btn btn-sm" :disabled="runForm.reason.length < 5">{{ t('room.record') }}</button>
        </form>
        <form class="row" novalidate @submit.prevent="act(() => esp04.setLobby(id, runForm.lobbyHost, runForm.lobbyPassword))">
          <input v-model="runForm.lobbyHost" class="input ltr" :placeholder="t('match.lobbyHost')" :aria-label="t('match.lobbyHost')" />
          <input v-model="runForm.lobbyPassword" class="input ltr" :placeholder="t('match.lobbyPassword')" :aria-label="t('match.lobbyPassword')" />
          <button type="submit" class="btn btn-sm" :disabled="!runForm.lobbyHost || runForm.lobbyPassword.length < 4">{{ t('room.setLobby') }}</button>
        </form>
      </section>

      <section class="card stack block">
        <h2>{{ t('room.timeline') }}</h2>
        <ol class="list"><li v-for="e in pub.timeline" :key="e.at + e.type"><JalaliDate :iso="e.at" format="time" /> — <span dir="auto">{{ e.text }}</span></li></ol>
        <p v-if="!pub.timeline.length" class="muted">—</p>
      </section>
    </template>
  </DataState>
</template>

<style scoped>
.meta { display: grid; grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr)); gap: var(--sp-3); margin: 0 0 var(--sp-4); }
dt { color: var(--text-muted); font-size: var(--fs-sm); }
dd { margin: 0; font-weight: 600; }
.grid2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 16rem), 1fr)); gap: var(--sp-3); }
.block { margin-block-start: var(--sp-4); }
.list { margin: 0; padding-inline-start: var(--sp-5); }
.steps { display: grid; gap: var(--sp-1); margin: 0; padding-inline-start: var(--sp-5); }
.steps .current { font-weight: 700; color: var(--accent-strong); }
.options { flex-wrap: wrap; gap: var(--sp-2); }
.row { flex-wrap: wrap; gap: var(--sp-2); align-items: flex-end; }
.grow { flex: 1 1 12rem; }
.chat { list-style: none; padding: 0; margin: 0; max-block-size: 16rem; overflow-y: auto; display: grid; gap: var(--sp-1); }
.lobby { background: var(--surface-2); padding: var(--sp-2); border-radius: var(--radius-sm); }
.code { font-family: monospace; }
.ok { color: var(--ok); }
.warn { color: var(--warn); }
.small { font-size: var(--fs-xs); }
.notice-public { background: var(--warn-soft); color: var(--warn); padding: var(--sp-2) var(--sp-3); border-radius: var(--radius-sm); }
h2, h3, p { margin: 0; }
</style>
