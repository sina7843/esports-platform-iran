<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import qrcode from 'qrcode-generator';
import { QAlert, QBadge, QButton, QCard, QCheckbox, QContainer, QDataState, QFacts, QIcon, QPageHeader, QSelect, QTextField, QTicketPass, fa, useToast } from '@esp/ui';
import { api, type ApiClientError } from '../api/client';
import { esp04 } from '../api/esp04';
import { toClientError } from '../errors';
import { t, type MessageKey } from '../i18n';
import { session } from '../session';

/**
 * Spec docs/redesign/03-specs/my-qr.md — LAN-002/004/006: my entry card. The code rotates every minute (a screenshot
 * expires once a newer code is shown); venue text works without a map; personal equipment is declared for inspection.
 */
const route = useRoute();
const { push } = useToast();
const eventId = computed(() => String(route.params.id));
const ROTATE = 60;
type Card = { credentialId: string; role: string; areas: string[]; qr: string; svg: string };
const cards = ref<Card[]>([]);
const venue = ref<Record<string, unknown> | null>(null);
const eventName = ref('');
const equipment = ref<Array<{ _id: string; item: string; state: string }>>([]);
const loading = ref(false);
const error = ref<ApiClientError | null>(null);
const left = ref(ROTATE);

function svgFor(text: string): string {
  const q = qrcode(0, 'M');
  q.addData(text);
  q.make();
  return q.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
}
async function loadEquipment() {
  try {
    const me = session.me?.principal.id;
    equipment.value = (await esp04.personalEquipment(eventId.value)).items.filter((x) => x.principalId === me);
  } catch {
    /* the list is optional; declaring still works */
  }
}
async function load() {
  loading.value = true;
  error.value = null;
  try {
    const [mine, vs] = await Promise.all([esp04.myQr(eventId.value), esp04.venues(eventId.value)]);
    cards.value = mine.items.map((c) => ({ ...c, svg: svgFor(c.qr) }));
    venue.value = vs.items[0] ?? null;
    left.value = ROTATE;
  } catch (e) {
    error.value = toClientError(e);
  } finally {
    loading.value = false;
  }
}
let timer: ReturnType<typeof setInterval> | undefined;
onMounted(async () => {
  void load();
  void loadEquipment();
  try { eventName.value = (await api.event(eventId.value)).event.name; } catch { /* breadcrumb falls back */ }
  timer = setInterval(() => {
    left.value -= 1;
    if (left.value <= 0) void load(); // rotate every minute while shown
  }, 1000);
});
onBeforeUnmount(() => clearInterval(timer));

const card = computed(() => cards.value[0] ?? null);
const str = (k: string) => (typeof venue.value?.[k] === 'string' ? (venue.value[k] as string) : '');
const venueFacts = computed(() => [
  { label: t('mq.address'), value: str('addressText') },
  { label: t('mq.route'), value: str('directions') },
  { label: t('mq.parking'), value: str('parking') },
  { label: t('mq.guide'), value: str('attendanceGuide') },
].filter((f) => f.value));

const KINDS = ['mouse', 'keyboard', 'headset', 'pad', 'controller', 'other'] as const;
const kind = ref('');
const model = ref('');
const wireless = ref<boolean | null>(false);
const touched = ref(false);
const kindErr = computed(() => (touched.value && !kind.value ? t('mq.errKind') : undefined));
const modelErr = computed(() => (touched.value && (model.value.trim().length < 2 || model.value.trim().length > 80) ? t('mq.errModel') : undefined));
async function declare() {
  touched.value = true;
  if (kindErr.value || modelErr.value) return;
  try {
    const item = `${t(`mq.${kind.value}` as MessageKey)}: ${model.value.trim()}${wireless.value ? ` (${t('mq.wirelessTag')})` : ''}`;
    await esp04.requestPersonal(eventId.value, item);
    push({ tone: 'success', message: t('qr.declared'), duration: 4000 });
    kind.value = '';
    model.value = '';
    wireless.value = false;
    touched.value = false;
    await loadEquipment();
  } catch (e) {
    push({ tone: 'danger', message: toClientError(e).message });
  }
}
const stateBadge = (s: string) => (s === 'approved' ? { tone: 'success' as const, label: t('mq.approved') } : s === 'rejected' ? { tone: 'danger' as const, label: t('mq.rejected') } : { tone: 'warning' as const, label: t('mq.pending') });
</script>

<template>
  <QContainer>
    <div class="k-stack p-my-qr">
      <QPageHeader
        compact :title="t('mq.title')" :description="t('qr.lead')"
        :breadcrumb="[{ label: t('mq.myRegs'), href: '/account/registrations' }, ...(eventName ? [{ label: eventName, href: `/events/${eventId}` }] : []), { label: t('mq.title') }]"
      >
        <template v-if="card" #status><QBadge tone="success" icon="check">{{ t('mq.valid') }}</QBadge></template>
      </QPageHeader>
      <QDataState
        v-if="error || (loading && !cards.length) || !card"
        :state="error ? (error.code === 'NETWORK' ? 'offline' : error.code === 'FORBIDDEN' ? 'forbidden' : 'error') : loading ? 'loading' : 'empty'"
        :request-id="error?.requestId ?? undefined" icon="qr" :empty-title="t('qr.none')" @retry="load"
      />
      <div v-else class="p-my-qr-split">
        <div class="p-my-qr-col">
          <div class="p-my-qr-rotate" role="timer">
            <span class="p-my-qr-rotate__text"><QIcon name="refresh" :size="18" />{{ t('mq.rotate1') }}<span class="p-my-qr-rotate__sec">{{ fa(Math.max(0, left)) }}</span>{{ t('mq.rotate2') }}</span>
            <QButton variant="secondary" size="sm" icon="refresh" :loading="loading" @click="load">{{ t('mq.fresh') }}</QButton>
          </div>
          <QTicketPass
            :event="eventName || t('mq.title')" :attendee="{ name: session.me?.principal.displayName ?? t('mq.attendee'), role: card.role }" :code="card.credentialId"
            :sample="false" :rotate-note="t('mq.rotateNote')" :qr-label="t('qr.alt')" :venue="venue ? { name: str('name'), address: str('addressText'), parking: str('parking') } : undefined"
            :equipment="equipment.map((x) => ({ item: x.item, state: x.state === 'approved' ? 'approved' : x.state === 'rejected' ? 'rejected' : 'declared' }))"
          >
            <!-- eslint-disable-next-line vue/no-v-html -- SVG built locally by qrcode-generator from the server code -->
            <template #qr><span class="p-my-qr-code" v-html="card.svg" /></template>
          </QTicketPass>
          <div v-if="card.areas.length">
            <span class="p-my-qr-label">{{ t('qr.areas') }}</span>
            <ul class="p-my-qr-areas"><li v-for="a in card.areas" :key="a"><QIcon name="check" :size="14" /><bdi>{{ a }}</bdi></li></ul>
          </div>
          <QCard>
            <div class="k-stack">
              <h2 class="h4 p-my-qr-h">{{ t('mq.equip') }}</h2>
              <QAlert tone="info">{{ t('mq.equipNote') }}</QAlert>
              <ul v-if="equipment.length" class="p-my-qr-equip">
                <li v-for="x in equipment" :key="x._id"><bdi>{{ x.item }}</bdi><QBadge :tone="stateBadge(x.state).tone">{{ stateBadge(x.state).label }}</QBadge></li>
              </ul>
              <form class="p-my-qr-form" novalidate @submit.prevent="declare">
                <QSelect v-model="kind" :label="t('mq.kind')" required :error="kindErr" :options="KINDS.map((k) => ({ value: k, label: t(`mq.${k}` as MessageKey) }))" />
                <QTextField v-model="model" :label="t('mq.model')" required :max-length="80" :error="modelErr" />
                <div class="p-my-qr-span"><QCheckbox v-model="wireless" :label="t('mq.wireless')" /></div>
                <div class="p-my-qr-span"><QButton variant="green" type="submit" icon="send">{{ t('mq.submit') }}</QButton></div>
              </form>
            </div>
          </QCard>
        </div>
        <aside class="p-my-qr-col">
          <QCard>
            <div class="k-stack">
              <h2 class="h4 p-my-qr-h">{{ t('mq.gate') }}</h2>
              <ul class="p-my-qr-tips"><li>{{ t('mq.gate1') }}</li><li>{{ t('mq.gate2') }}</li><li>{{ t('mq.gate3') }}</li></ul>
            </div>
          </QCard>
          <QCard v-if="venueFacts.length">
            <div class="k-stack">
              <h2 class="h4 p-my-qr-h">{{ t('mq.there') }}</h2>
              <QFacts variant="list" :items="venueFacts" />
              <p class="p-my-qr-label">{{ t('mq.noMap') }}</p>
            </div>
          </QCard>
        </aside>
      </div>
    </div>
  </QContainer>
</template>

<style scoped>
.p-my-qr { gap: var(--space-6); }
.p-my-qr-h { margin: 0; }
.p-my-qr-code { display: block; inline-size: 100%; block-size: 100%; }
.p-my-qr-code :deep(svg) { display: block; inline-size: 100%; block-size: 100%; }
.p-my-qr-split { display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr); gap: var(--space-6); align-items: start; }
.p-my-qr-col { display: flex; flex-direction: column; gap: var(--space-5); min-width: 0; }
.p-my-qr-rotate { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); flex-wrap: wrap; padding: var(--space-3) var(--space-4); border: 1px solid var(--green-line); background: var(--green-soft); border-radius: var(--radius-md); }
.p-my-qr-rotate__text { display: inline-flex; align-items: center; gap: var(--space-2); font-size: 14px; color: var(--ink); }
.p-my-qr-rotate__sec { display: inline-block; min-width: 2.4em; text-align: center; font-weight: 900; color: var(--green-text); font-size: 18px; }
.p-my-qr-areas { display: flex; flex-wrap: wrap; gap: var(--space-2); align-items: center; margin: var(--space-2) 0 0; padding: 0; list-style: none; }
.p-my-qr-areas li { display: inline-flex; align-items: center; gap: var(--space-1); min-height: 32px; padding: 0 var(--space-3); font-size: 13px; font-weight: 700; border: 1px solid var(--line-strong); border-radius: var(--radius-sm); background: var(--surface); }
.p-my-qr-label { font-size: 13px; color: var(--ink-subtle); font-weight: 700; margin: 0; }
.p-my-qr-tips { margin: 0; padding-inline-start: var(--space-5); display: flex; flex-direction: column; gap: var(--space-1); font-size: 14px; line-height: 24px; color: var(--ink-muted); }
.p-my-qr-form { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: var(--space-4); align-items: start; }
.p-my-qr-span { grid-column: 1 / -1; }
.p-my-qr-equip { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; }
.p-my-qr-equip li { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); padding-block: var(--space-3); border-block-start: 1px solid var(--line); font-size: 14px; }
.p-my-qr-equip li:first-child { border-block-start: 0; }
@media (max-width: 1100px) { .p-my-qr-split { grid-template-columns: minmax(0, 1fr); } }
@media (max-width: 560px) { .p-my-qr-form { grid-template-columns: minmax(0, 1fr); } .p-my-qr-rotate > .q-btn { flex: 1 1 100%; } }
</style>
