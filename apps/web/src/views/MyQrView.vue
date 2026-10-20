<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import qrcode from 'qrcode-generator';
import type { ApiClientError } from '../api/client';
import { esp04 } from '../api/esp04';
import DataState from '../components/DataState.vue';
import ErrorNote from '../components/ErrorNote.vue';
import PageHeader from '../components/PageHeader.vue';
import { toClientError } from '../errors';
import { t } from '../i18n';

/**
 * LAN-002/004/006: my entry card. Each refresh rotates the code (a screenshot expires once a newer code is shown and a
 * scanned code admits once). Venue address, directions, parking and the attendance guide are shown as text (works
 * without any map). Personal equipment can be declared for inspection.
 */
const route = useRoute();
const eventId = computed(() => String(route.params.id));
const cards = ref<Array<{ credentialId: string; role: string; areas: string[]; qr: string; svg: string }>>([]);
const venues = ref<Array<Record<string, unknown>>>([]);
const loading = ref(false);
const error = ref<ApiClientError | null>(null);
const failure = ref<ApiClientError | null>(null);
const item = ref('');
const notice = ref('');
function svgFor(text: string): string {
  const q = qrcode(0, 'M');
  q.addData(text);
  q.make();
  return q.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
}
async function load() {
  loading.value = true;
  error.value = null;
  try {
    const [mine, vs] = await Promise.all([esp04.myQr(eventId.value), esp04.venues(eventId.value)]);
    cards.value = mine.items.map((c) => ({ ...c, svg: svgFor(c.qr) }));
    venues.value = vs.items;
  } catch (e) {
    error.value = toClientError(e);
  } finally {
    loading.value = false;
  }
}
let timer: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  void load();
  timer = setInterval(() => void load(), 60_000); // rotate every minute while shown
});
onBeforeUnmount(() => clearInterval(timer));
async function declare() {
  failure.value = null;
  try {
    await esp04.requestPersonal(eventId.value, item.value);
    notice.value = t('qr.declared');
    item.value = '';
  } catch (e) {
    failure.value = toClientError(e);
  }
}
</script>

<template>
  <PageHeader :title="t('qr.title')" :lead="t('qr.lead')" />
  <DataState :loading="loading && !cards.length" :error="error" :empty="!loading && !cards.length" @retry="load">
    <template #empty><p class="msg">{{ t('qr.none') }}</p></template>
    <ul class="cards">
      <li v-for="c in cards" :key="c.credentialId" class="card stack qr-card">
        <strong>{{ t(`lan.role.${c.role}` as never) }}</strong>
        <!-- generated locally from our own token; no external image or script -->
        <!-- eslint-disable-next-line vue/no-v-html -- SVG generated locally by qrcode-generator from our own base64url token -->
        <div class="qr" role="img" :aria-label="t('qr.alt')" v-html="c.svg" />
        <span class="muted small">{{ t('qr.areas') }}: {{ c.areas.join('، ') }}</span>
        <button type="button" class="btn btn-sm" @click="load">{{ t('qr.refresh') }}</button>
      </li>
    </ul>
  </DataState>
  <section v-for="v in venues" :key="String(v._id)" class="card stack block">
    <h2><bdi>{{ v.name }}</bdi></h2>
    <address dir="auto">{{ v.addressText }}</address>
    <p v-if="v.directions" dir="auto"><strong>{{ t('lan.directions') }}:</strong> {{ v.directions }}</p>
    <p v-if="v.parking" dir="auto"><strong>{{ t('lan.parking') }}:</strong> {{ v.parking }}</p>
    <p v-if="v.attendanceGuide" dir="auto"><strong>{{ t('lan.guide') }}:</strong> {{ v.attendanceGuide }}</p>
  </section>
  <section class="card stack block">
    <h2>{{ t('lan.personal') }}</h2>
    <ErrorNote :error="failure" />
    <p v-if="notice" role="status" class="ok">{{ notice }}</p>
    <form class="row" novalidate @submit.prevent="declare">
      <label class="sr-only" for="pe-item">{{ t('qr.item') }}</label>
      <input id="pe-item" v-model="item" class="input" dir="auto" :placeholder="t('qr.item')" />
      <button type="submit" class="btn btn-sm" :disabled="item.trim().length < 2">{{ t('qr.declare') }}</button>
    </form>
  </section>
</template>

<style scoped>
.cards { list-style: none; padding: 0; margin: 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 18rem), 1fr)); gap: var(--sp-3); }
.qr-card { align-items: center; text-align: center; }
.qr { inline-size: min(70vw, 16rem); background: #fff; padding: var(--sp-2); border-radius: var(--radius-md); }
.qr :deep(svg) { inline-size: 100%; block-size: auto; display: block; }
.block { margin-block-start: var(--sp-4); }
.row { flex-wrap: wrap; gap: var(--sp-2); }
.ok { color: var(--ok); }
.small { font-size: var(--fs-xs); }
h2, p, address { margin: 0; }
</style>
