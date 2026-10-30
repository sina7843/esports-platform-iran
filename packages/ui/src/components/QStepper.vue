<script setup lang="ts">
import { computed } from 'vue';
import { fa, tr } from '../locale';
import { stepDefault, stepSr, type StepState } from '../maps/data';
import QIcon from './QIcon.vue';

/** Stepper: numbered steps; done = green check, current = green ring, upcoming = muted. Horizontal or vertical. */
export interface QStepperStep { label: string; description?: string }
export interface QStepperProps {
  /** Default: اطلاعات تیم، تأیید اعضا، پرداخت، اعلام حضور. */
  steps?: (Array<string | QStepperStep>) | undefined;
  /** Zero-based current step; steps.length marks all done. */
  current?: (number) | undefined;
  orientation?: ('horizontal' | 'vertical') | undefined;
  /** `aria-label` names the <ol>, not the root (as in the DS). */
  ariaLabel?: (string) | undefined;
}
const p = withDefaults(defineProps<QStepperProps>(), { current: 0, orientation: 'horizontal' });

const list = computed(() => (p.steps ?? stepDefault()).map((s): QStepperStep => (typeof s === 'string' ? { label: s } : s)));
const stateOf = (i: number): StepState => (i < p.current ? 'done' : i === p.current ? 'current' : 'upcoming');
</script>

<template>
  <div :class="['q-stepper', `q-stepper--${orientation}`]">
    <ol class="q-stepper__list" :aria-label="ariaLabel || tr('مراحل ثبت‌نام', 'Registration steps')">
      <li
        v-for="(s, i) in list"
        :key="i"
        :class="['q-stepper__step', `q-stepper__step--${stateOf(i)}`]"
        :aria-current="stateOf(i) === 'current' ? 'step' : undefined"
      >
        <span class="q-stepper__marker q-num" aria-hidden="true">
          <QIcon v-if="stateOf(i) === 'done'" name="check" :size="16" :stroke-width="3" />
          <template v-else>{{ fa(i + 1) }}</template>
        </span>
        <span class="q-stepper__text">
          <span class="q-stepper__label">{{ s.label }}</span>
          <span v-if="s.description" class="q-stepper__desc">{{ s.description }}</span>
          <span class="q-sr">{{ tr('، ', ', ') + stepSr(stateOf(i)) }}</span>
        </span>
      </li>
    </ol>
  </div>
</template>
