<script setup lang="ts">
import type { ApiClientError } from '../api/client';
import { errorText } from '../errors';
import { t } from '../i18n';

defineProps<{ error: ApiClientError | null }>();
</script>

<template>
  <p v-if="error" class="note-err" role="alert">
    {{ errorText(error.code) }}
    <span v-if="error.requestId" class="muted">({{ t('state.requestId') }}: <code>{{ error.requestId }}</code>)</span>
  </p>
</template>

<style scoped>
.note-err { margin: 0; padding: var(--sp-2) var(--sp-3); border-radius: var(--radius-md); background: var(--danger-soft); color: var(--danger); }
</style>
