<script setup lang="ts">
import { computed, ref, useId, useSlots } from 'vue';
import { tr } from '../locale';
import { actionProps, uidOf, type QHeroAction } from '../maps/data';
import QButton from './QButton.vue';
import QIcon from './QIcon.vue';
import QTricolor from './QTricolor.vue';

/** Hero: the Arena home hero — tricolor eyebrow, display title with one accented word, body, CTA row, optional search and media column. */
export interface QHeroSearchConfig {
  placeholder?: string;
  label?: string;
  buttonLabel?: string;
  defaultValue?: string;
  onSubmit?: (query: string) => void;
}
export interface QHeroProps {
  /** false hides it. Default «خانه ورزش‌های الکترونیکی ایران». */
  eyebrow?: string | false | undefined;
  /** Default «رقابت از اینجا شروع می‌شود.» */
  title?: string;
  /** One word of the title to colour (default «شروع» with the default title). */
  accentWord?: string;
  accent?: 'red' | 'green';
  body?: string;
  /** Red, chamfered, xl — the one primary action (or the `primaryAction` slot). */
  primaryAction?: QHeroAction;
  /** Green secondary, xl (or the `secondaryAction` slot). */
  secondaryAction?: QHeroAction;
  /** true / config for the built-in Arena search (or the `search` slot). Submits emit `search`. */
  search?: boolean | QHeroSearchConfig;
  headingLevel?: 1 | 2;
}
const p = withDefaults(defineProps<QHeroProps>(), { eyebrow: undefined, accent: 'red', headingLevel: 1 });
const emit = defineEmits<{ search: [query: string] }>();
const slots = useSlots();

const uid = uidOf(useId());
const titleText = computed(() => p.title ?? tr('رقابت از اینجا شروع می‌شود.', 'Your next competition starts here.'));
const word = computed(() => (p.accentWord === undefined && p.title == null ? tr('شروع', 'starts') : p.accentWord));
const titleParts = computed(() => {
  const t = titleText.value, w = word.value;
  const at = w ? t.indexOf(w) : -1;
  return at >= 0 && w ? [t.slice(0, at), w, t.slice(at + w.length)] as const : null;
});
const hasMedia = computed(() => !!(slots.media || slots.default));
const hasActions = computed(() => !!(p.primaryAction || p.secondaryAction || slots.primaryAction || slots.secondaryAction || slots.actions));
const searchCfg = computed<QHeroSearchConfig>(() => (typeof p.search === 'object' ? p.search : {}));
const q = ref<HTMLInputElement | null>(null);
const submit = () => {
  const v = q.value?.value ?? '';
  searchCfg.value.onSubmit?.(v);
  emit('search', v);
};
</script>

<template>
  <section :class="['q-hero', { 'q-hero--media': hasMedia }]" :aria-labelledby="uid">
    <div class="q-hero__grid">
      <div class="q-hero__copy">
        <p v-if="eyebrow !== false" class="q-hero__eyebrow"><QTricolor /><slot name="eyebrow">{{ eyebrow || tr('خانه ورزش‌های الکترونیکی ایران', 'THE HOME OF IRANIAN ESPORTS') }}</slot></p>
        <component :is="'h' + headingLevel" :id="uid" class="q-hero__title display-xl">
          <slot name="title">
            <template v-if="titleParts">{{ titleParts[0] }}<span :class="['q-hero__accent', `q-hero__accent--${accent === 'green' ? 'green' : 'red'}`]">{{ titleParts[1] }}</span>{{ titleParts[2] }}</template>
            <template v-else>{{ titleText }}</template>
          </slot>
        </component>
        <p v-if="body || slots.body" class="q-hero__body body-lg"><slot name="body">{{ body }}</slot></p>
        <div v-if="hasActions" class="q-hero__actions">
          <slot name="primaryAction">
            <QButton
              v-if="primaryAction"
              v-bind="actionProps(primaryAction, { variant: 'primary', size: 'xl', chamfer: true, iconEnd: 'arrow-right', flipIcon: true })"
              @click="primaryAction.onClick?.($event)"
            >{{ primaryAction.label }}</QButton>
          </slot>
          <slot name="secondaryAction">
            <QButton
              v-if="secondaryAction"
              v-bind="actionProps(secondaryAction, { variant: 'green', size: 'xl' })"
              @click="secondaryAction.onClick?.($event)"
            >{{ secondaryAction.label }}</QButton>
          </slot>
          <slot name="actions" />
        </div>
        <slot name="search">
          <form v-if="search" class="q-hero__search" role="search" @submit.prevent="submit">
            <label :for="uid + 's'" class="q-sr">{{ searchCfg.label || tr('جست‌وجو', 'Search') }}</label>
            <span class="q-hero__search-icon" aria-hidden="true"><QIcon name="search" :size="18" /></span>
            <input
              :id="uid + 's'"
              ref="q"
              type="search"
              dir="auto"
              class="q-hero__search-input"
              :placeholder="searchCfg.placeholder || tr('نام تیم، بازیکن، رویداد یا خبر…', 'Team, player, event or news…')"
              :value="searchCfg.defaultValue"
            >
            <button type="submit" class="q-hero__search-btn">{{ searchCfg.buttonLabel || tr('جست‌وجو', 'Search') }}</button>
          </form>
        </slot>
      </div>
      <div v-if="hasMedia" class="q-hero__media"><slot name="media"><slot /></slot></div>
    </div>
  </section>
</template>
