<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { esp06 as esp06Api } from '../api/esp06';
import { num, t } from '../i18n';

/**
 * CAST-004..006 broadcast graphics for an OBS browser source. Data comes only from the overlay endpoint, which
 * applies the stream delay on the server; the label says whether it is synced to the stream or the latest result.
 */
const esp06: typeof esp06Api = esp06Api;
const route = useRoute();
const token = computed(() => String(route.params['token']));
const s = ref<Record<string, unknown> | null>(null);
const failed = ref(false);
let timer: ReturnType<typeof setInterval> | undefined;
async function load() {
  try {
    s.value = await esp06.overlay(token.value);
    failed.value = false;
  } catch {
    failed.value = true;
  }
}
onMounted(() => {
  void load();
  timer = setInterval(() => void load(), 3000);
});
onBeforeUnmount(() => clearInterval(timer));
type Score = { sides: string[]; state: string; outcome: { kind: string; winnerSide?: number; scores?: [number, number] | null; maps?: [number, number] | null } | null; provisional: boolean } | null;
const sb = computed(() => s.value?.['scoreboard'] as Score | undefined);
const sc = computed(() => {
  const o = sb.value?.outcome;
  const v = o?.maps ?? o?.scores;
  return v ? `${num(v[0])} – ${num(v[1])}` : '';
});
</script>

<template>
  <main class="overlay" :aria-label="t('ovl.title')">
    <p v-if="failed" class="err">{{ t('ovl.invalid') }}</p>
    <template v-else-if="s">
      <p class="label">{{ s['label'] === 'latest_result' ? t('ovl.latest') : t('ovl.synced', { n: num(Number(s['delaySeconds'])) }) }}</p>
      <section v-if="sb" class="score">
        <bdi>{{ sb.sides[0] }}</bdi>
        <strong class="ltr">{{ sc || t('ovl.vs') }}</strong>
        <bdi>{{ sb.sides[1] }}</bdi>
        <small v-if="sb.provisional">{{ t('live.provisional') }}</small>
      </section>
      <section v-if="s['lineup']" class="lineup">
        <div v-for="(l, i) in s['lineup'] as Array<{ name: string; players: string[] } | null>" :key="i"><template v-if="l"><strong><bdi>{{ l.name }}</bdi></strong> <bdi>{{ l.players.join('، ') }}</bdi></template></div>
      </section>
      <section v-if="s['veto']" class="veto"><span v-for="(v, i) in s['veto'] as Array<{ kind: string; value: string }>" :key="i">{{ v.kind }}: <bdi class="ltr">{{ v.value }}</bdi></span></section>
      <section v-if="s['bracket']" class="bracket"><span v-for="(b, i) in s['bracket'] as Array<{ sides: string[]; state: string }>" :key="i"><bdi>{{ b.sides.join(' — ') }}</bdi></span></section>
      <section v-if="s['sponsors']" class="sponsors"><span v-for="(sp, i) in s['sponsors'] as Array<{ name: string; logoUrl: string | null }>" :key="i"><img v-if="sp.logoUrl" :src="sp.logoUrl" :alt="sp.name" /><bdi v-else>{{ sp.name }}</bdi></span><small>{{ t('ovl.sponsor') }}</small></section>
    </template>
  </main>
</template>

<style scoped>
.overlay { font-family: inherit; color: #fff; background: transparent; padding: 12px; display: grid; gap: 8px; direction: rtl; }
.label { font-size: 12px; opacity: 0.8; margin: 0; }
.score { display: flex; gap: 16px; align-items: center; background: rgba(15, 23, 42, 0.85); padding: 8px 16px; border-radius: 8px; font-size: 28px; }
.lineup, .veto, .bracket, .sponsors { display: flex; flex-wrap: wrap; gap: 12px; background: rgba(15, 23, 42, 0.7); padding: 6px 12px; border-radius: 6px; font-size: 16px; }
.sponsors img { block-size: 32px; }
.err { color: #fca5a5; }
</style>
