<script setup lang="ts">
import { esp05 as esp05Api } from '../api/esp05';
import { request } from '../api/client';
import { num, honorLabel, t } from '../i18n';
import { useLoad } from '../useLoad';
import JalaliDate from './JalaliDate.vue';
import StatusBadge from './StatusBadge.vue';

/**
 * RANK-007/008, AWD-001..004, USR-006: competitive record, platform honors (verifiable) and declared achievements
 * (always shown apart), and rating trend. Built from final official results only; empty means empty.
 */
const props = defineProps<{ kind: 'player' | 'team'; id: string }>();
const esp05: typeof esp05Api = esp05Api;
type Career = { played: number; wins: number; losses: number; draws: number; items: Array<{ matchId: string; eventName: string; opponent: string; result: string; forfeit: boolean; at: string }>; standings?: Array<{ eventId: string; eventName: string; nameAtTime: string; place: number; of: number }> };
const { data } = useLoad(async () => {
  const career = await request<Career>('GET', `/careers/${props.kind === 'player' ? 'players' : 'teams'}/${encodeURIComponent(props.id)}`);
  const honors = props.kind === 'player' ? await esp05.playerHonors(props.id) : await esp05.teamHonors(props.id);
  const trend = (await esp05.trend(props.id)).items;
  return { career, honors, trend };
});
const mark = (r: string) => (r === 'W' ? t('career.w') : r === 'L' ? t('career.l') : t('career.d'));
</script>

<template>
  <section v-if="data" class="card stack" aria-labelledby="cp-h">
    <h2 id="cp-h">{{ t('player.record') }}</h2>
    <p v-if="!data.career.played" class="muted">{{ t('player.noRecord') }}</p>
    <template v-else>
      <p>{{ t('career.summary', { p: num(data.career.played), w: num(data.career.wins), l: num(data.career.losses), d: num(data.career.draws) }) }}</p>
      <ul class="list">
        <li v-for="m in data.career.items.slice(0, 10)" :key="m.matchId"><span :class="m.result === 'W' ? 'ok' : m.result === 'L' ? 'danger' : ''">{{ mark(m.result) }}</span> — <bdi>{{ m.opponent }}</bdi> · <bdi>{{ m.eventName }}</bdi> · <JalaliDate :iso="m.at" format="date" /><span v-if="m.forfeit" class="muted small"> ({{ t('career.forfeit') }})</span></li>
      </ul>
    </template>
    <template v-if="data.career.standings?.length">
      <h3>{{ t('career.placements') }}</h3>
      <ul class="list"><li v-for="s in data.career.standings" :key="s.eventId"><bdi>{{ s.eventName }}</bdi> — {{ t('hon.place', { n: s.place }) }} / {{ num(s.of) }} <span class="muted small">(<bdi>{{ s.nameAtTime }}</bdi>)</span></li></ul>
    </template>

    <h3>{{ t('hon.verified') }}</h3>
    <p v-if="!data.honors.verified.length" class="muted">{{ t('hon.none') }}</p>
    <ul class="list">
      <li v-for="h in data.honors.verified" :key="h.id" :class="{ revoked: h.state === 'revoked' }">{{ honorLabel(h.label) }} — <bdi>{{ h.eventName }}</bdi><span v-if="h.team"> (<bdi>{{ h.team.nameAtTime }}</bdi>)</span>
        <StatusBadge v-if="h.state !== 'active'" :state="h.state" /> · <a :href="esp05.cardUrl(h.id)" target="_blank" rel="noopener">{{ t('hon.card') }}</a> · <RouterLink :to="`/verify/${h.verifyCode}`">{{ t('ver.title') }}</RouterLink></li>
    </ul>
    <template v-if="data.honors.declared.length">
      <h3>{{ t('hon.declared') }}</h3>
      <p class="muted small">{{ t('hon.declaredHint') }}</p>
      <ul class="list"><li v-for="d in data.honors.declared" :key="d.id"><bdi>{{ d.title }}</bdi> — <bdi>{{ d.eventName }}</bdi><span v-if="d.year"> ({{ num(d.year) }})</span> <span class="muted">· {{ t(`hon.${d.label}` as never) }}</span></li></ul>
    </template>

    <template v-for="tr in data.trend" :key="tr.system.id">
      <h3>{{ t('career.rating') }} — {{ tr.system.gameId }} · {{ tr.system.mode }} <span class="muted small">({{ tr.system.label.official ? t('rank.official') : t('rank.unapproved') }})</span></h3>
      <p v-if="tr.current">{{ num(Number(tr.current['rating'])) }}<span v-if="tr.current['rd'] !== null" class="muted"> ±{{ num(Number(tr.current['rd'])) }}</span></p>
      <svg class="spark" viewBox="0 0 100 30" role="img" :aria-label="t('career.trendAria', { n: tr.points.length })" preserveAspectRatio="none">
        <polyline fill="none" stroke="currentColor" stroke-width="1" :points="tr.points.map((p, i) => { const min = Math.min(...tr.points.map((x) => x.rating)); const max = Math.max(...tr.points.map((x) => x.rating)); return `${tr.points.length > 1 ? (i / (tr.points.length - 1)) * 100 : 50},${max === min ? 15 : 28 - ((p.rating - min) / (max - min)) * 26}`; }).join(' ')" />
      </svg>
    </template>
  </section>
</template>

<style scoped>
.list { margin: 0; padding-inline-start: var(--sp-5); }
.revoked { text-decoration: line-through; opacity: 0.7; }
.spark { inline-size: 100%; max-inline-size: 24rem; block-size: 3rem; color: var(--accent, var(--info)); transform: scaleX(var(--dir-flip, 1)); }
:dir(rtl) .spark { transform: scaleX(-1); }
.ok { color: var(--ok); }
.danger { color: var(--danger); }
.small { font-size: var(--fs-xs); }
h2, h3, p { margin: 0; }
</style>
