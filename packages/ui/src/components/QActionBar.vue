<script setup lang="ts">
import { computed } from 'vue';
import { tr } from '../locale';
import { abStatus } from '../maps/navigation';
import QButton from './QButton.vue';
import QIcon from './QIcon.vue';

/** ActionBar — sticky footer bar for long forms: unsaved-changes note, «انصراف» (`cancel`) and the «ذخیره» primary (`save`). */
export interface QActionBarProps {
  status?: 'dirty' | 'saving' | 'saved' | 'error';
  /** Overrides the status text (or the `message` slot; default «تغییرات ذخیره نشده»). */
  message?: string;
  detail?: string;
  saveLabel?: string;
  cancelLabel?: string;
  saving?: boolean;
  saveDisabled?: boolean;
  /** Not sticky; bordered box (docs, previews). */
  inline?: boolean;
  ariaLabel?: string;
}
const p = withDefaults(defineProps<QActionBarProps>(), { status: 'dirty' });
const emit = defineEmits<{ save: []; cancel: [] }>();

const st = computed(() => abStatus(p.status));
const busy = computed(() => p.status === 'saving' || p.saving);
</script>

<template>
  <div :class="['q-action-bar', { 'q-action-bar--inline': inline }]" role="region" :aria-label="ariaLabel || tr('ذخیرهٔ تغییرات', 'Save changes')">
    <div class="q-action-bar__inner">
      <p class="q-action-bar__note" :data-tone="st.cls" role="status">
        <QIcon v-if="st.icon" :name="st.icon" :size="18" />
        <span v-else class="q-action-bar__dot" aria-hidden="true" />
        <span class="q-action-bar__msg"><slot name="message">{{ message || st.text }}</slot></span>
        <span v-if="detail || $slots.detail" class="q-action-bar__detail"><slot name="detail">{{ detail }}</slot></span>
      </p>
      <div class="q-action-bar__actions">
        <QButton variant="secondary" :disabled="busy" @click="emit('cancel')">{{ cancelLabel || tr('انصراف', 'Cancel') }}</QButton>
        <QButton variant="primary" :loading="busy" :disabled="saveDisabled || status === 'saved'" @click="emit('save')">{{ saveLabel || tr('ذخیره', 'Save') }}</QButton>
      </div>
    </div>
  </div>
</template>
