<script setup lang="ts">
import { computed, useId } from 'vue';
import type { IconName } from '../icons';
import { tr } from '../locale';
import QButton from './QButton.vue';
import QDialog from './QDialog.vue';
import QIcon from './QIcon.vue';

/**
 * ConfirmDialog — destructive / second-approval confirmation: warning copy, a required reason (the confirm button stays
 * disabled until it is written) and an optional second-approval note. `v-model:open` + `close`; `confirm` gets the trimmed
 * reason; `v-model:reason` + `reasonChange`. Default slot = extra content after the consequences (e.g. a re-auth OtpInput).
 */
export interface QConfirmDialogProps {
  title?: string;
  /** Warning copy (or the `message` slot). */
  message?: string;
  /** Bullet list of consequences (or `<li>`s in the `consequences` slot). */
  consequences?: string[];
  /** Default true: the confirm stays disabled until a reason is written. */
  requireReason?: boolean;
  /** v1.1 — show the reason field without gating the confirm button. Wins over requireReason. */
  reasonOptional?: boolean;
  /** v1.1 — 'danger' (default) or 'primary' (red primary confirm + info icon) for irreversible non-destructive steps. */
  tone?: 'danger' | 'primary';
  minReasonLength?: number;
  reasonLabel?: string;
  reasonPlaceholder?: string;
  reasonHint?: string;
  defaultReason?: string;
  /** true or custom text: shows «این اقدام به تأیید دوم نیاز دارد». */
  secondApproval?: boolean | string;
  confirmLabel?: string;
  cancelLabel?: string;
  loading?: boolean;
  icon?: IconName;
  size?: 'sm' | 'md' | 'lg';
  inline?: boolean;
  inlineHeight?: number;
  backdrop?: string;
}
const p = withDefaults(defineProps<QConfirmDialogProps>(), {
  requireReason: true, tone: 'danger', minReasonLength: 1, defaultReason: '', size: 'sm', secondApproval: false,
});
const open = defineModel<boolean>('open', { required: true });
const reasonModel = defineModel<string>('reason');
const emit = defineEmits<{ close: []; confirm: [reason: string]; reasonChange: [v: string] }>();

const id = useId();
const reason = computed(() => reasonModel.value ?? p.defaultReason);
const optional = computed(() => !!p.reasonOptional);
const need = computed(() => !optional.value && p.requireReason !== false);
const primary = computed(() => p.tone === 'primary');
const ok = computed(() => !need.value || reason.value.trim().length >= p.minReasonLength);
function setReason(v: string) {
  reasonModel.value = v;
  emit('reasonChange', v);
}
function close() {
  emit('close');
  open.value = false;
}
function confirm() {
  if (ok.value) emit('confirm', reason.value.trim());
}
const dialogExtras = computed(() => ({
  ...(p.inlineHeight != null ? { inlineHeight: p.inlineHeight } : {}),
  ...(p.backdrop != null ? { backdrop: p.backdrop } : {}),
  ...(p.title != null ? { title: p.title } : {}),
}));
</script>

<template>
  <QDialog
    :open="open" :inline="inline" :size="size" role="alertdialog" :icon="icon || (primary ? 'info' : 'alert')" :tone="primary ? 'info' : 'danger'"
    v-bind="dialogExtras" :class="['q-confirm-dialog', { 'q-confirm-dialog--primary': primary }]" @close="close"
  >
    <template v-if="$slots.title" #title><slot name="title" /></template>
    <template v-if="$slots.backdrop" #backdrop><slot name="backdrop" /></template>
    <p v-if="message || $slots.message" class="q-confirm-dialog__message"><slot name="message">{{ message }}</slot></p>
    <ul v-if="consequences?.length || $slots.consequences" class="q-confirm-dialog__list">
      <slot name="consequences"><li v-for="(t, i) in consequences" :key="i">{{ t }}</li></slot>
    </ul>
    <div v-if="$slots.default" class="q-confirm-dialog__extra"><slot /></div>
    <div v-if="need || optional" class="q-confirm-dialog__field">
      <label :for="`${id}-r`" class="q-confirm-dialog__label">{{ reasonLabel || (optional ? tr('دلیل (اختیاری)', 'Reason (optional)') : tr('دلیل را بنویسید', 'Write a reason')) }}<span v-if="need" class="q-confirm-dialog__req" aria-hidden="true"> *</span></label>
      <textarea
        :id="`${id}-r`" class="q-confirm-dialog__textarea" rows="3" :value="reason" :required="need || undefined"
        :aria-required="need ? 'true' : undefined" :aria-describedby="`${id}-h`" :placeholder="reasonPlaceholder" data-autofocus="true"
        @input="setReason(($event.target as HTMLTextAreaElement).value)"
      />
      <p :id="`${id}-h`" class="q-confirm-dialog__hint">{{ reasonHint || (optional ? tr('نوشتن دلیل اختیاری است؛ اگر بنویسید در سابقه ثبت می‌شود.', 'A reason is optional; if you write one, it is kept in the record.') : tr('تا دلیل را ننویسید، دکمهٔ تأیید فعال نمی‌شود.', 'The confirm button stays disabled until you write a reason.')) }}</p>
    </div>
    <div v-if="secondApproval" class="q-confirm-dialog__note">
      <QIcon name="shield" :size="18" />
      <span>{{ typeof secondApproval === 'string' ? secondApproval : tr('این اقدام به تأیید دوم نیاز دارد', 'This action needs a second approval') }}</span>
    </div>
    <template #footer>
      <QButton variant="secondary" @click="close">{{ cancelLabel || tr('انصراف', 'Cancel') }}</QButton>
      <QButton :variant="primary ? 'primary' : 'danger'" :disabled="!ok" :loading="loading" @click="confirm">{{ confirmLabel || tr('تأیید', 'Confirm') }}</QButton>
    </template>
  </QDialog>
</template>
