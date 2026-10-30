<script setup lang="ts">
import { computed, useId, useSlots } from 'vue';
import { tr } from '../locale';
import type { IconName } from '../icons';
import { actionProps, uidOf, type QHeroAction } from '../maps/data';
import QButton from './QButton.vue';
import QIcon from './QIcon.vue';

/** CtaBanner: full-width band with an icon tile, title, text and one button («مسابقه بعدی، قدم بعدی»). */
export interface QCtaBannerProps {
  icon?: IconName;
  /** Default «مسابقه بعدی، قدم بعدی». */
  title?: string;
  /** false hides it. */
  text?: string | false | undefined;
  /** Button config (green by default; or the `action` slot); null hides it. Default «قوانین». */
  action?: QHeroAction | null | undefined;
  headingLevel?: 2 | 3;
}
const p = withDefaults(defineProps<QCtaBannerProps>(), { icon: 'swords', text: undefined, action: undefined, headingLevel: 2 });
const slots = useSlots();

const uid = uidOf(useId());
const act = computed<QHeroAction | null>(() => (p.action === undefined ? { label: tr('قوانین', 'Rules'), href: '#' } : p.action));
</script>

<template>
  <section class="q-cta-banner" :aria-labelledby="uid">
    <div class="q-cta-banner__inner">
      <span class="q-cta-banner__tile q-chamfer-sm" aria-hidden="true"><QIcon :name="icon" :size="28" /></span>
      <div class="q-cta-banner__text">
        <component :is="'h' + headingLevel" :id="uid" class="q-cta-banner__title h3"><slot name="title">{{ title || tr('مسابقه بعدی، قدم بعدی', 'Your next match. Your next step.') }}</slot></component>
        <p v-if="text !== false" class="q-cta-banner__desc body-sm">
          <slot name="text">{{ text || tr('برنامه، قوانین و نتایج را پیش از ورود به رقابت بررسی کن.', 'Check the schedule, rules and results before joining the competition.') }}</slot>
        </p>
      </div>
      <div v-if="act || slots.action" class="q-cta-banner__action">
        <slot name="action">
          <QButton
            v-if="act"
            v-bind="actionProps(act, { variant: 'green', size: 'lg', iconEnd: 'arrow-right', flipIcon: true })"
            @click="act.onClick?.($event)"
          >{{ act.label }}</QButton>
        </slot>
      </div>
    </div>
  </section>
</template>
