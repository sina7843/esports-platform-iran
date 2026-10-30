<script setup lang="ts">
import { computed, useId } from 'vue';
import { tr } from '../locale';
import { REC_KIND, crest, firstChar, fmtDate, tx } from '../maps/people';
import QBadge from './QBadge.vue';
import QButton from './QButton.vue';
import QLink from './QLink.vue';

/** Recruitment ad. Long Latin text wraps; closed ads keep their content but disable applying. Emits apply. */
export interface QRecruitmentCardProps {
  team: { name: string; initial?: string; logoSrc?: string; href?: string };
  game?: string;
  kind?: 'player' | 'coach' | 'analyst' | 'manager';
  role?: string;
  level?: string;
  city?: string;
  activityHours?: string;
  description?: string;
  state?: 'open' | 'closed';
  postedAt?: string;
  applied?: boolean;
  applyLabel?: string;
}
const p = withDefaults(defineProps<QRecruitmentCardProps>(), { kind: 'player', state: 'open' });
const emit = defineEmits<{ apply: [] }>();
const hid = useId();
const open = computed(() => p.state === 'open');
const c = crest('q-recruitment-card__crest', 48, true);
const facts = computed(() => [
  p.level ? { id: 'level', k: tr('سطح', 'Level'), v: p.level } : null,
  p.city ? { id: 'city', k: tr('شهر', 'City'), v: p.city } : null,
  p.activityHours ? { id: 'hours', k: tr('ساعات فعالیت', 'Activity hours'), v: p.activityHours } : null,
].filter((x) => x !== null));
const heading = computed(() => (REC_KIND[p.kind] ? tx(REC_KIND[p.kind]) : tr(`جذب ${p.kind}`, `Looking for: ${p.kind}`)));
</script>

<template>
  <article :class="['q-recruitment-card', { 'q-recruitment-card--closed': !open }]" :aria-labelledby="hid">
    <div class="q-recruitment-card__head">
      <span :class="c.class" :style="c.style" aria-hidden="true"><img v-if="team.logoSrc" :src="team.logoSrc" alt="" /><template v-else>{{ team.initial || firstChar(team.name) }}</template></span>
      <div class="q-recruitment-card__team">
        <span class="q-recruitment-card__team-name"><QLink v-if="team.href" :href="team.href"><bdi>{{ team.name }}</bdi></QLink><bdi v-else>{{ team.name }}</bdi></span>
        <span v-if="game" class="q-recruitment-card__game q-ltr">{{ game }}</span>
      </div>
      <QBadge v-if="open" tone="success" dot>{{ tr('باز', 'Open') }}</QBadge>
      <QBadge v-else tone="neutral" icon="lock">{{ tr('بسته', 'Closed') }}</QBadge>
    </div>
    <h3 :id="hid" class="q-recruitment-card__title">
      {{ heading }}<template v-if="role"><span class="q-recruitment-card__sep" aria-hidden="true"> · </span><bdi>{{ role }}</bdi></template>
    </h3>
    <dl v-if="facts.length" class="q-recruitment-card__facts">
      <div v-for="x in facts" :key="x.id"><dt>{{ x.k }}</dt><dd><bdi>{{ x.v }}</bdi></dd></div>
    </dl>
    <p v-if="description" class="q-recruitment-card__desc" dir="auto">{{ description }}</p>
    <div class="q-recruitment-card__foot">
      <span v-if="postedAt" class="q-recruitment-card__date">{{ tr('ثبت ', 'Posted ') }}<time :datetime="postedAt">{{ fmtDate(postedAt, 'short') }}</time></span>
      <QBadge v-if="applied" tone="success" icon="check">{{ tr('درخواست ثبت شد.', 'Application submitted.') }}</QBadge>
      <QButton v-else-if="open" variant="green" icon="send" @click="emit('apply')">{{ applyLabel || tr('درخواست همکاری', 'Apply') }}</QButton>
      <QButton v-else variant="secondary" disabled>{{ tr('آگهی بسته شده است', 'This ad is closed') }}</QButton>
    </div>
  </article>
</template>
