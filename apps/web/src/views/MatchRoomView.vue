<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { QAlert, QButton, QCard, QCheckbox, QCode, QContainer, QDataState, QFacts, QFileUpload, QPageHeader, QScoreboard, QSelect, QStatusBadge, QTextField, QTimeline, fa, formatJalali, useToast } from '@esp/ui';
import type { ApiClientError } from '../api/client';
import { esp03 } from '../api/esp03';
import { esp04 as esp04Api, type RoomView, type SelectionView } from '../api/esp04';
import { esp05 as esp05Api } from '../api/esp05';
import { toClientError } from '../errors';
import { t } from '../i18n';
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
const result = reactive({ winnerSide: '0', a: '0', b: '0' });
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
  await esp04.submitResult(id.value, { kind: 'win', winnerSide: Number(result.winnerSide), maps: [Number(result.a), Number(result.b)] }, ids);
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
const { push } = useToast();
watch(notice, (n) => { if (n) push({ tone: 'success', message: n === '✓' ? t('rv.done') : n, duration: 4000 }); });
watch(failure, (f) => { if (f) push({ tone: 'danger', message: f.message }); });
const title = computed(() => pub.value?.sides.map((s) => s.displayName).join(' — ') || t('match.title'));
const winnerName = (o: unknown) => {
  const x = o as { kind: string; winnerSide?: number };
  return x.kind === 'win' ? t('room.winner', { side: pub.value?.sides[x.winnerSide ?? -1]?.displayName ?? '' }) : x.kind;
};
const facts = computed(() => {
  const p = pub.value;
  if (!p) return [];
  const f: Array<{ label: string; value: string }> = [];
  if (p.slot) f.push({ label: t('room.round'), value: t('br.round', { n: fa(p.slot.round) }) + (p.slot.group ? ` · ${t('br.group', { g: p.slot.group })}` : '') });
  f.push({ label: t('match.scheduledAt'), value: (p.scheduledAt ? formatJalali(p.scheduledAt) : '—') + (p.estimated && p.scheduledAt ? ` (${t('br.estimated')})` : '') });
  if (p.config) f.push({ label: t('room.format'), value: `BO${fa(p.config.bestOf)} · ${p.config.mode} ${p.config.gameVersion}${p.config.override ? ` · ${p.config.override}` : ''}` });
  if (p.stationLabel) f.push({ label: t('room.station'), value: p.stationLabel });
  if (p.outcome) f.push({ label: t('room.result'), value: winnerName(p.outcome) });
  if (p.provisional) f.push({ label: t('room.result'), value: t('room.provisional') });
  return f;
});
const timeline = computed(() => (pub.value?.timeline ?? []).map((e, i) => ({ id: i, at: e.at, action: e.text })));
const stepAction = (i: number) => sel.value?.actions.find((a) => a.step === i);
const chatChannel = computed({ get: () => chat.channel as string, set: (v: string) => { chat.channel = v === 'officials' ? 'officials' : 'private'; } });
const pauseKind = computed({ get: () => runForm.pauseKind as string, set: (v: string) => { runForm.pauseKind = v === 'tactical' ? 'tactical' : 'technical'; } });
const sideOpts = computed(() => (pub.value?.sides ?? []).map((s, i) => ({ value: String(i), label: s.displayName })));
const DECISIONS = computed(() => ['continue', 'replay', 'restore', 'forfeit_match'].map((d) => ({ value: d, label: t(`room.dec.${d}` as never) })));
const toggleLineup = (si: number, pid: string, on: boolean | null) => {
  const cur = lineupOf(si);
  lineupSel[si] = on ? [...new Set([...cur, pid])] : cur.filter((x) => x !== pid);
};
</script>

<template>
  <QContainer>
    <QDataState v-if="!pub" :state="error ? 'error' : 'loading'" :error="error" skeleton="cards" @retry="load" />
    <div v-else class="k-stack p-room">
      <QPageHeader compact :eyebrow="t('room.eyebrow')" :breadcrumb="[{ label: t('shell.events'), href: '/events' }, ...(pub.stage ? [{ label: pub.stage.name, href: `/stages/${pub.stageId}` }] : []), { label: title }]">
        <template #title><bdi>{{ title }}</bdi></template>
        <template #badge><QStatusBadge :state="pub.state" /></template>
      </QPageHeader>
      <QAlert v-if="pub.publicNotice" tone="warning" icon="alert"><bdi>{{ pub.publicNotice }}</bdi></QAlert>

      <QScoreboard
        :home="{ name: pub.sides[0]?.displayName ?? t('room.tbd') }" :away="{ name: pub.sides[1]?.displayName ?? t('room.tbd') }"
        :state="pub.state as never" :time="pub.scheduledAt ? formatJalali(pub.scheduledAt, 'time') : undefined" :context="pub.stage?.name"
      />

      <div class="p-room-cols">
        <div class="k-stack">
          <!-- pre-game selection (public progress, private actions) -->
          <QCard v-if="sel" aria-live="polite">
            <div class="k-stack">
              <h2 class="h4 p-room-p">{{ t('room.selection') }}</h2>
              <ol class="p-room-steps">
                <li v-for="(tok, i) in sel.sequence" :key="i" :class="{ 'is-current': i === sel.step && sel.state !== 'complete' }">
                  <span class="p-room-muted">{{ t(`room.tok.${tok.split(':')[0]}` as never) }}{{ tok.includes(':') ? ` · ${pub.sides[Number(tok.split(':')[1])]?.displayName ?? ''}` : '' }}</span>
                  <strong v-if="stepAction(i)" class="q-ltr">{{ stepAction(i)!.value }}</strong>
                  <span v-if="stepAction(i)?.via === 'timeout'" class="p-room-muted"> ({{ t('room.byRule') }})</span>
                  <span v-if="stepAction(i)?.via === 'referee'" class="p-room-muted"> ({{ t('room.byReferee') }})</span>
                </li>
              </ol>
              <QAlert v-if="sel.state === 'waiting_referee'" tone="warning">{{ t('room.waitingReferee') }}</QAlert>
              <p v-else-if="turn && turnLeft !== null" role="timer" :aria-label="t('room.turnTimer')" class="p-room-timer">{{ t('room.turnLeft', { s: fa(turnLeft) }) }}</p>
              <div v-if="myTurn" class="k-row">
                <QButton v-for="o in sel.options" :key="o" variant="secondary" @click="act(() => esp04.act(id, sel!.step, o))">{{ o }}</QButton>
              </div>
            </div>
          </QCard>

          <!-- private area -->
          <QCard v-if="priv">
            <div class="k-stack">
              <h2 class="h4 p-room-p">{{ t('room.private') }}</h2>
              <QAlert v-if="priv.config.undecided.length" tone="warning">{{ t('room.undecided') }}: <bdi class="q-ltr">{{ priv.config.undecided.join(', ') }}</bdi></QAlert>
              <p v-if="countdown !== null" role="timer" class="p-room-timer">{{ t('room.countdown', { s: fa(countdown) }) }}</p>
              <div class="k-row">
                <QButton v-if="isSide && pub.state === 'awaiting_readiness' && !readySides.has(priv.side)" icon="check" @click="act(() => esp04.ready(id))">{{ t('room.declareReady') }}</QButton>
              </div>

              <section v-if="priv.lineup && ['awaiting_readiness', 'ready', 'pre_game_selection', 'live', 'paused'].includes(pub.state)" class="k-stack p-room-block" aria-labelledby="lu-h">
                <h3 id="lu-h" class="p-room-h3">{{ t('room.lineup') }}</h3>
                <template v-for="(roster, si) in priv.lineup" :key="si">
                  <form v-if="roster" class="k-stack" novalidate @submit.prevent="act(() => esp05.lineup(id, si, lineupOf(si)), t('room.lineupSaved'))">
                    <fieldset class="p-room-set"><legend><bdi>{{ pub.sides[si]?.displayName }}</bdi></legend>
                      <QCheckbox v-for="r in roster" :key="r.principalId" :model-value="lineupOf(si).includes(r.principalId)" :label="r.displayName" @update:model-value="(v) => toggleLineup(si, r.principalId, v)" />
                    </fieldset>
                    <div><QButton type="submit" size="sm" variant="secondary">{{ t('room.saveLineup') }}</QButton></div>
                  </form>
                </template>
                <p class="p-room-muted">{{ t('room.lineupHint') }}</p>
              </section>

              <section v-if="priv.result && ['provisional', 'disputed'].includes(pub.state)" class="k-stack p-room-block" aria-labelledby="rc-h">
                <h3 id="rc-h" class="p-room-h3">{{ t('room.confirmTitle') }}</h3>
                <ul class="p-room-list"><li v-for="(x, i) in priv.result.submissions" :key="i">{{ x.side === null ? t('room.bySource', { s: x.source }) : pub.sides[x.side]?.displayName }} — {{ winnerName(x.outcome) }} · {{ formatJalali(x.at, 'time') }}</li></ul>
                <p v-if="priv.result.deadline" class="p-room-muted">{{ t('room.confirmBy') }} {{ formatJalali(priv.result.deadline) }} · {{ priv.result.policy === 'on_deadline' ? t('room.autoConfirm') : t('room.officialConfirms') }}</p>
                <QAlert v-if="priv.result.review" tone="warning">{{ t('room.integrationMismatch') }}</QAlert>
                <QAlert v-if="priv.openCaseId" tone="warning"><RouterLink :to="`/cases/${priv.openCaseId}`">{{ t('room.openCase') }}</RouterLink></QAlert>
                <div v-else-if="isSide && pub.state === 'provisional'" class="k-stack">
                  <div v-if="otherSubmitted"><QButton variant="green" @click="act(() => esp05.confirm(id), t('room.confirmed'))">{{ t('room.confirm') }}</QButton></div>
                  <form class="p-room-inline" novalidate @submit.prevent="act(async () => { const c = await esp05.contest(id, contestClaim); contestClaim = ''; return c; }, t('room.contested'))">
                    <QTextField id="rc-claim" v-model="contestClaim" :label="t('room.contestClaim')" multiline :rows="2" />
                    <QButton type="submit" variant="danger" icon="gavel" :disabled="contestClaim.trim().length < 10">{{ t('room.contest') }}</QButton>
                  </form>
                </div>
              </section>

              <form v-if="(isSide || official) && (['live', 'paused'].includes(pub.state) || (isSide && pub.state === 'provisional' && !mySubmitted && !priv.openCaseId)) && pub.kind === 'head_to_head'" class="k-stack p-room-block" novalidate @submit.prevent="submit">
                <h3 class="p-room-h3">{{ t('room.submitResult') }}</h3>
                <div class="p-room-grid">
                  <QSelect id="res-w" v-model="result.winnerSide" :label="t('room.winnerSide')" :options="sideOpts" />
                  <QTextField id="res-a" v-model="result.a" :label="pub.sides[0]?.displayName ?? 'A'" type="number" ltr />
                  <QTextField id="res-b" v-model="result.b" :label="pub.sides[1]?.displayName ?? 'B'" type="number" ltr />
                </div>
                <QFileUpload id="res-ev" :label="t('room.evidence')" :hint="t('reg.docPrivate')" accept="image/png,image/jpeg,application/pdf,video/mp4" :multiple="false" :files="evidence ? [{ name: evidence.name, size: evidence.size, scanState: 'pending' }] : []" @files="(fs) => (evidence = fs[0] ?? null)" />
                <div><QButton type="submit">{{ t('room.submit') }}</QButton></div>
                <p class="p-room-muted">{{ t('room.resultHint') }}</p>
              </form>
              <div v-if="isSide && ['live', 'paused'].includes(pub.state)" class="k-row">
                <QButton size="sm" variant="secondary" icon="pause" @click="act(() => esp04.pause(id, { kind: 'tactical', side: null, reason: 'tactical' }))">{{ t('room.tactical') }}</QButton>
                <QButton size="sm" variant="secondary" icon="wifi-off" @click="act(() => esp04.disconnect(id, priv!.side))">{{ t('room.reportDisconnect') }}</QButton>
              </div>
            </div>
          </QCard>

          <!-- officials -->
          <QCard v-if="official">
            <div class="k-stack">
              <div class="p-room-head"><h2 class="h4 p-room-p">{{ t('room.officials') }}</h2><QStatusBadge :state="pub.state" /></div>
              <div class="k-row">
                <QButton v-if="pub.state === 'scheduled'" variant="secondary" @click="act(() => esp04.openReadiness(id))">{{ t('room.openReadiness') }}</QButton>
                <QButton v-if="pub.state === 'ready' && priv!.config.vetoSequence.length && !sel" variant="secondary" @click="act(() => esp04.startSelection(id))">{{ t('room.startSelection') }}</QButton>
                <QButton v-if="['ready', 'pre_game_selection'].includes(pub.state)" icon="play" @click="act(() => esp04.run(id, 'start'))">{{ t('room.start') }}</QButton>
                <QButton v-if="pub.state === 'paused'" icon="play" @click="act(() => esp04.run(id, 'resume'))">{{ t('room.resume') }}</QButton>
                <QButton v-if="pub.state === 'provisional'" variant="green" @click="act(() => esp04.finalize(id))">{{ t('room.finalize') }}</QButton>
              </div>
              <form v-if="pub.state === 'live'" class="p-room-grid p-room-block" novalidate @submit.prevent="act(() => esp04.pause(id, { kind: runForm.pauseKind, side: null, reason: runForm.reason || 'official' }))">
                <QSelect id="rf-pk" v-model="pauseKind" :label="t('room.pauseKind')" :options="[{ value: 'technical', label: t('room.technical') }, { value: 'tactical', label: t('room.tactical') }]" />
                <QTextField id="rf-pr" v-model="runForm.reason" :label="t('evm.reason')" />
                <div><QButton type="submit" size="sm" variant="secondary" icon="pause">{{ t('room.pause') }}</QButton></div>
              </form>
              <form v-if="['live', 'paused'].includes(pub.state)" class="p-room-grid p-room-block" novalidate @submit.prevent="act(() => esp04.decide(id, runForm.decision, runForm.reason))">
                <QSelect id="rf-d" v-model="runForm.decision" :label="t('room.decision')" :options="DECISIONS" />
                <QTextField id="rf-dr" v-model="runForm.reason" :label="t('evm.reason')" />
                <div><QButton type="submit" size="sm" variant="secondary" :disabled="runForm.reason.length < 5">{{ t('room.record') }}</QButton></div>
              </form>
              <form class="p-room-grid p-room-block" novalidate @submit.prevent="act(() => esp04.setLobby(id, runForm.lobbyHost, runForm.lobbyPassword))">
                <QTextField id="rf-lh" v-model="runForm.lobbyHost" :label="t('match.lobbyHost')" ltr />
                <QTextField id="rf-lp" v-model="runForm.lobbyPassword" :label="t('match.lobbyPassword')" ltr />
                <div><QButton type="submit" size="sm" variant="secondary" :disabled="!runForm.lobbyHost || runForm.lobbyPassword.length < 4">{{ t('room.setLobby') }}</QButton></div>
              </form>
            </div>
          </QCard>

          <QCard>
            <div class="k-stack">
              <h2 class="h4 p-room-p">{{ t('room.rosters') }}</h2>
              <div class="p-room-lineup">
                <div v-for="(s, i) in pub.sides" :key="i" class="k-stack">
                  <strong><bdi>{{ s.displayName }}</bdi> <QStatusBadge v-if="readySides.has(i)" state="ready" /></strong>
                  <ul class="p-room-list"><li v-for="r in s.roster" :key="r.displayName"><bdi>{{ r.displayName }}</bdi> <span class="p-room-muted">{{ r.role }}</span></li></ul>
                </div>
              </div>
            </div>
          </QCard>

          <QCard>
            <div class="k-stack">
              <h2 class="h4 p-room-p">{{ t('room.timeline') }}</h2>
              <QTimeline compact :items="timeline" time-format="time" empty-text="—" />
            </div>
          </QCard>
        </div>

        <aside class="k-stack">
          <QCard>
            <div class="k-stack">
              <h2 class="h4 p-room-p">{{ t('room.about') }}</h2>
              <QFacts variant="list" dense :items="facts" />
            </div>
          </QCard>
          <template v-if="priv">
            <QCard>
              <div class="k-stack">
                <h2 class="h4 p-room-p">{{ t('room.lobbyTitle') }}</h2>
                <div v-if="lobby" class="k-stack" role="status">
                  <span class="p-room-muted">{{ t('match.lobbyHost') }}</span><QCode copy>{{ lobby.host }}</QCode>
                  <span class="p-room-muted">{{ t('match.lobbyPassword') }}</span><QCode copy>{{ lobby.password }}</QCode>
                </div>
                <div v-else-if="priv.lobbyAvailable"><QButton variant="secondary" icon="eye" @click="loadLobby">{{ t('match.lobbyLoad') }}</QButton></div>
                <p class="p-room-muted">{{ t('match.lobbyHint') }}</p>
              </div>
            </QCard>
            <QCard>
              <div class="k-stack">
                <h2 class="h4 p-room-p">{{ t('room.callReferee') }}</h2>
                <form v-if="isSide" class="k-stack" novalidate @submit.prevent="act(async () => { await esp04.callReferee(id, callReason); callReason = ''; }, t('room.called'))">
                  <QTextField id="call-r" v-model="callReason" :label="t('evm.reason')" />
                  <div><QButton type="submit" size="sm" variant="secondary" icon="bell" :disabled="callReason.trim().length < 3">{{ t('room.call') }}</QButton></div>
                </form>
                <ul v-if="priv.calls.length" class="p-room-list">
                  <li v-for="c in priv.calls" :key="c._id"><bdi>{{ c.reason }}</bdi> <QStatusBadge :state="c.state" />
                    <QButton v-if="official && c.state !== 'closed'" size="sm" variant="ghost" @click="act(() => esp04.updateCall(c._id, 'closed'))">{{ t('room.closeCall') }}</QButton></li>
                </ul>
              </div>
            </QCard>
            <QCard>
              <div class="k-stack">
                <h2 class="h4 p-room-p">{{ t('room.chat') }} ({{ fa(messages.length) }})</h2>
                <ul class="p-room-chat" aria-live="polite"><li v-for="m in messages" :key="m._id"><span class="p-room-muted">{{ formatJalali(m.at, 'time') }}</span> <bdi>{{ m.text }}</bdi></li></ul>
                <form class="k-stack" novalidate @submit.prevent="act(async () => { await esp04.send(id, chat.text, chat.channel); chat.text = ''; }, '')">
                  <QTextField id="chat-text" v-model="chat.text" :label="t('room.message')" hide-label :placeholder="t('room.message')" :max-length="1000" />
                  <div class="p-room-inline">
                    <QSelect id="chat-ch" v-model="chatChannel" :label="t('room.channel')" hide-label :options="[{ value: 'private', label: t('room.toAll') }, { value: 'officials', label: t('room.toOfficials') }]" />
                    <QButton type="submit" size="sm" icon="send" :disabled="!chat.text.trim()">{{ t('room.send') }}</QButton>
                  </div>
                </form>
              </div>
            </QCard>
          </template>
          <QCard v-else>
            <div class="k-stack">
              <h2 class="h4 p-room-p">{{ t('room.privateGuest') }}</h2>
              <p class="p-room-muted">{{ t('room.privateGuestBody') }}</p>
            </div>
          </QCard>
        </aside>
      </div>
    </div>
  </QContainer>
</template>

<style scoped>
.p-room-cols { display: grid; grid-template-columns: 1.65fr 1fr; gap: var(--space-6); align-items: start; }
@media (max-width: 1000px) { .p-room-cols { grid-template-columns: 1fr; } }
.p-room-p { margin: 0; }
.p-room-h3 { margin: 0; font-size: 15px; font-weight: 800; }
.p-room-head { display: flex; justify-content: space-between; align-items: center; gap: var(--space-3); }
.p-room-block { padding-block-start: var(--space-4); border-block-start: 1px solid var(--line); }
.p-room-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 170px), 1fr)); gap: var(--space-3); align-items: end; }
.p-room-inline { display: flex; flex-wrap: wrap; gap: var(--space-3); align-items: end; }
.p-room-inline > :first-child { flex: 1 1 200px; }
.p-room-list { margin: 0; padding-inline-start: var(--space-5); display: grid; gap: var(--space-1); }
.p-room-steps { margin: 0; padding-inline-start: var(--space-5); display: grid; gap: var(--space-1); }
.p-room-steps .is-current { font-weight: 800; color: var(--green-600); }
.p-room-timer { margin: 0; font-weight: 800; font-size: 18px; }
.p-room-muted { margin: 0; color: var(--ink-muted); font-size: 13px; }
.p-room-set { margin: 0; padding: var(--space-3) var(--space-4); border: 1px solid var(--line); border-radius: var(--radius-md); display: flex; flex-wrap: wrap; gap: var(--space-2) var(--space-5); }
.p-room-set legend { padding-inline: var(--space-2); font-weight: 800; }
.p-room-lineup { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 240px), 1fr)); gap: var(--space-4); }
.p-room-chat { list-style: none; padding: 0; margin: 0; max-block-size: 16rem; overflow-y: auto; display: grid; gap: var(--space-1); }
</style>
