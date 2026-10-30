<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useSlots } from 'vue';
import { tr } from '../locale';
import QIcon from './QIcon.vue';

/**
 * Monospaced inline or block code, always LTR-isolated; optional copy button («کپی شد» / «Copied» for 2 s).
 * Text: `value` or the default slot (copied text = value, else the slot's plain text). Emits copy(text).
 */
export interface QCodeProps {
  value?: string | undefined;
  block?: boolean | undefined;
  copy?: boolean | undefined;
  label?: string | undefined;
  copyLabel?: string | undefined;
  copiedDuration?: number | undefined;
  wrap?: boolean | undefined;
}
const p = withDefaults(defineProps<QCodeProps>(), { copiedDuration: 2000 });
const emit = defineEmits<{ copy: [text: string] }>();
const slots = useSlots();
const copied = ref(false);
let timer: ReturnType<typeof setTimeout> | undefined;
onBeforeUnmount(() => clearTimeout(timer));

const COPIED = computed(() => tr('کپی شد', 'Copied'));
const btnLabel = computed(() => p.copyLabel || tr('کپی', 'Copy'));
function slotText(): string {
  return (slots.default?.() ?? []).map((n) => (typeof n.children === 'string' ? n.children : '')).join('');
}
const text = () => (p.value != null ? String(p.value) : slotText());

function fallback(t: string) {
  try {
    const ta = document.createElement('textarea');
    ta.value = t;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  } catch { /* ignore */ }
}
function copyText(t: string) {
  try {
    if (navigator.clipboard?.writeText) { navigator.clipboard.writeText(t).catch(() => fallback(t)); return; }
  } catch { /* fall through */ }
  fallback(t);
}
function onCopy() {
  const t = text();
  copyText(t);
  copied.value = true;
  clearTimeout(timer);
  timer = setTimeout(() => { copied.value = false; }, p.copiedDuration || 2000);
  emit('copy', t);
}
const inlineAria = computed(() => (copied.value ? COPIED.value : btnLabel.value + (p.label ? ` ${p.label}` : '')));
</script>

<template>
  <div v-if="block" :class="['q-code', 'q-code--block', { 'q-code--wrap': wrap }]">
    <div v-if="label || copy" class="q-code__bar">
      <span class="q-code__label">{{ label }}</span>
      <button v-if="copy" type="button" :class="['q-code__copy', { 'q-code__copy--done': copied }]" @click="onCopy">
        <QIcon :name="copied ? 'check' : 'copy'" :size="14" /><span>{{ copied ? COPIED : btnLabel }}</span>
      </button>
    </div>
    <pre class="q-code__pre q-ltr"><code><slot>{{ value }}</slot></code></pre>
    <span v-if="copy" class="q-sr" role="status">{{ copied ? COPIED : '' }}</span>
  </div>
  <span v-else class="q-code q-code--inline">
    <code class="q-code__inline q-ltr"><slot>{{ value }}</slot></code>
    <button v-if="copy" type="button" :class="['q-code__copy', { 'q-code__copy--done': copied }]" :aria-label="inlineAria" @click="onCopy">
      <QIcon :name="copied ? 'check' : 'copy'" :size="14" /><span v-if="copied" aria-hidden="true">{{ COPIED }}</span>
    </button>
    <span v-if="copy" class="q-sr" role="status">{{ copied ? COPIED : '' }}</span>
  </span>
</template>
