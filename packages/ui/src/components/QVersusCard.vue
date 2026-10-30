<script setup lang="ts">
import { computed } from 'vue';
import { fa, tr } from '../locale';
import { initialOf, latin, nameOf, type BroadcastTeam } from '../maps/broadcast';
import QLogo from './QLogo.vue';
import QTricolor from './QTricolor.vue';

export interface QVersusCardTeam extends BroadcastTeam {
  /** Seed number, shown as «سید ۱». */
  seed?: number;
  /** Short fact under the name, e.g. «۲ برد پیاپی». */
  note?: string;
}
export interface QVersusCardFact { label: string; value: string; /** Isolate as LTR. */ ltr?: boolean; tone?: 'green' }
/** Full-frame between-matches card: two large crests, names, seeds, match info and a sponsor slot. 16:9, scales to its container. */
export interface QVersusCardProps {
  home: QVersusCardTeam;
  away: QVersusCardTeam;
  event: string;
  stage?: string;
  info?: QVersusCardFact[];
  sponsor?: { name: string; logoUrl?: string | null };
  /** Show the QeSB mark. Default true. */
  logo?: boolean;
  logoVariant?: 'auto' | 'color' | 'white' | 'black';
  labels?: Partial<Record<'vs' | 'sponsor' | 'seed', string>>;
}
const p = withDefaults(defineProps<QVersusCardProps>(), { logo: true, logoVariant: 'auto' });

const L = computed(() => ({ vs: tr('در برابر', 'vs'), sponsor: tr('اسپانسر', 'Sponsor'), seed: tr('سید', 'Seed'), ...p.labels }));
const sides = computed(() => [p.home, p.away].map((t, i) => ({ t: t ?? { name: '' }, away: i === 1 })));
</script>

<template>
  <div class="q-versus-card">
    <div class="q-versus-card__frame" role="region" :aria-label="`${nameOf(home)} ${L.vs} ${nameOf(away)}`">
      <header class="q-versus-card__head">
        <div class="q-versus-card__titles">
          <span class="q-versus-card__event"><QTricolor class="q-versus-card__tri" />{{ event }}</span>
          <span v-if="stage" class="q-versus-card__stage">{{ stage }}</span>
        </div>
        <span v-if="logo !== false" class="q-versus-card__logo"><QLogo :size="72" :variant="logoVariant" /></span>
      </header>
      <div class="q-versus-card__main">
        <template v-for="(s, i) in sides" :key="i">
          <div v-if="i === 1" class="q-versus-card__vs">
            <span class="q-versus-card__vs-line" aria-hidden="true" /><strong>{{ L.vs }}</strong><span class="q-versus-card__vs-line" aria-hidden="true" />
          </div>
          <div :class="['q-versus-card__side', { 'q-versus-card__side--away': s.away }]">
            <span class="q-versus-card__crest" aria-hidden="true"><span>{{ initialOf(s.t) }}</span></span>
            <bdi class="q-versus-card__name">{{ nameOf(s.t) }}</bdi>
            <span class="q-versus-card__facts">
              <span v-if="s.t.seed != null" class="q-versus-card__seed">{{ `${L.seed} ${fa(s.t.seed)}` }}</span>
              <span v-if="s.t.note" class="q-versus-card__note">{{ s.t.note }}</span>
            </span>
          </div>
        </template>
      </div>
      <footer class="q-versus-card__foot">
        <dl class="q-versus-card__info">
          <div v-for="(f, i) in info ?? []" :key="i" :class="['q-versus-card__fact', { 'q-versus-card__fact--green': f.tone === 'green' }]">
            <dt>{{ f.label }}</dt>
            <dd><span v-if="f.ltr" class="q-ltr">{{ f.value }}</span><template v-else>{{ f.value }}</template></dd>
          </div>
        </dl>
        <div v-if="sponsor" class="q-versus-card__sponsor">
          <span class="q-versus-card__sponsor-label">{{ L.sponsor }}</span>
          <span class="q-versus-card__sponsor-slot q-stripes">
            <img v-if="sponsor.logoUrl" :src="sponsor.logoUrl" :alt="sponsor.name" />
            <bdi v-else :class="latin(sponsor.name) ? 'q-ltr' : undefined">{{ sponsor.name }}</bdi>
          </span>
        </div>
      </footer>
    </div>
  </div>
</template>
