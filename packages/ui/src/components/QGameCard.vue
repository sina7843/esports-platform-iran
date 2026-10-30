<script setup lang="ts">
import { computed, useId } from 'vue';
import { tr } from '../locale';
import { GAME_STATES, stateBadge } from '../maps/people';
import QBadge from './QBadge.vue';
import QIcon from './QIcon.vue';
import QLink from './QLink.vue';

/** Catalogue game: 3:4 cover (image or stripes + outlined Latin name), title, publisher, catalogue state, per-mode readiness. */
export interface QGameCardProps {
  title: string;
  latinName?: (string) | undefined;
  coverSrc?: (string) | undefined;
  publisher?: (string) | undefined;
  state?: ('proposed' | 'under_review' | 'ready' | 'suspended' | 'archived') | undefined;
  modes?: ({ name: string; ready: boolean }[]) | undefined;
  testOnly?: (boolean) | undefined;
  testOnlyNote?: (string) | undefined;
  href?: (string) | undefined;
}
const p = withDefaults(defineProps<QGameCardProps>(), { state: 'proposed' });
const hid = useId();
const b = computed(() => stateBadge(GAME_STATES, p.state));
</script>

<template>
  <component
    :is="href ? QLink : 'article'" :href="href" :aria-labelledby="hid"
    :class="['q-game-card', { 'q-game-card--link': href, 'q-game-card--archived': state === 'archived' }]"
  >
    <div :class="['q-game-card__cover', { 'q-stripes': !coverSrc }]">
      <img v-if="coverSrc" :src="coverSrc" alt="" />
      <span v-else class="q-game-card__latin" aria-hidden="true">{{ latinName || title }}</span>
      <span class="q-game-card__state"><QBadge v-bind="b.props">{{ b.label }}</QBadge></span>
    </div>
    <div class="q-game-card__body">
      <h3 :id="hid" class="q-game-card__title"><bdi>{{ title }}</bdi></h3>
      <span v-if="publisher" class="q-game-card__publisher">{{ tr('ناشر: ', 'Publisher: ') }}<span class="q-ltr">{{ publisher }}</span></span>
      <ul v-if="modes?.length" class="q-game-card__modes" :aria-label="tr('آمادگی مودها', 'Mode readiness')">
        <li v-for="m in modes" :key="m.name" :class="['q-game-card__mode', { 'q-game-card__mode--ready': m.ready }]">
          <QIcon :name="m.ready ? 'check' : 'minus'" :size="14" />
          <span class="q-ltr">{{ m.name }}</span>
          <span class="q-sr">{{ m.ready ? tr(' آماده', ' ready') : tr(' آماده نیست', ' not ready') }}</span>
        </li>
      </ul>
      <p v-else class="q-game-card__nomode">{{ tr('هیچ مودی آماده برگزاری استاندارد اعلام نشده است.', 'No mode is declared ready for standard competitions.') }}</p>
      <span
        v-if="testOnly" class="q-game-card__test"
        :title="testOnlyNote || tr('TEST ONLY — ماژول عمومی آزمایشی، نه قانون تأییدشده ناشر', 'TEST ONLY — generic test module, not publisher-approved rules')"
      >
        <QIcon name="alert" :size="14" />{{ tr('فقط آزمایشی', 'Test only') }}
      </span>
    </div>
  </component>
</template>
