<script setup lang="ts">
import { computed } from 'vue';
import { ApiClientError } from '../api/client';
import { errorText, isForbidden } from '../errors';
import { t } from '../i18n';
import Icon, { type IconName } from './Icon.vue';

const props = defineProps<{
  loading?: boolean;
  error?: Error | null;
  empty?: boolean;
  forbidden?: boolean;
  offline?: boolean;
}>();
const emit = defineEmits<{ retry: [] }>();

type Kind = 'offline' | 'forbidden' | 'error' | 'loading' | 'empty' | 'content';
const apiError = computed(() => (props.error instanceof ApiClientError ? props.error : null));
const kind = computed<Kind>(() => {
  if (props.offline || apiError.value?.code === 'NETWORK') return 'offline';
  if (props.forbidden || isForbidden(apiError.value)) return 'forbidden';
  if (props.error) return 'error';
  if (props.loading) return 'loading';
  if (props.empty) return 'empty';
  return 'content';
});
const icons: Record<Exclude<Kind, 'content'>, IconName> = { offline: 'wifi-off', forbidden: 'lock', error: 'alert', loading: 'loader', empty: 'inbox' };
const message = computed(() => (kind.value === 'content' ? '' : t(`state.${kind.value}`)));
const detail = computed(() => (kind.value === 'error' && apiError.value ? errorText(apiError.value.code) : ''));
const retryable = computed(() => kind.value === 'error' || kind.value === 'offline');
</script>

<template>
  <slot v-if="kind === 'content'" />
  <div v-else class="state" :data-state="kind" :role="kind === 'loading' ? 'status' : kind === 'empty' ? undefined : 'alert'" :aria-busy="kind === 'loading'">
    <Icon :name="icons[kind]" :size="32" />
    <slot v-if="kind === 'empty'" name="empty"><p class="msg">{{ message }}</p></slot>
    <p v-else class="msg">{{ message }}</p>
    <p v-if="detail" class="muted">{{ detail }}</p>
    <p v-if="kind === 'error' && apiError?.requestId" class="muted">
      {{ t('state.requestId') }}: <code>{{ apiError.requestId }}</code>
    </p>
    <button v-if="retryable" type="button" class="btn" @click="emit('retry')">
      <Icon name="refresh" :size="16" /> {{ t('state.retry') }}
    </button>
  </div>
</template>

<style scoped>
.state { display: grid; justify-items: center; gap: var(--sp-2); text-align: center; padding: var(--sp-7) var(--sp-4); color: var(--text-muted); border: 1px dashed var(--border); border-radius: var(--radius-lg); }
.msg { margin: 0; font-weight: 600; color: var(--text); }
/* reserve space while loading so content arriving later does not push the page down (CLS) */
[data-state='loading'] { min-block-size: 24rem; align-content: start; }
[data-state='error'] { color: var(--danger); }
[data-state='forbidden'] { color: var(--warn); }
[data-state='offline'] { color: var(--info); }
</style>
