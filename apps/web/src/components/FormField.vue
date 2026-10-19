<script setup lang="ts">
import { computed } from 'vue';
const props = defineProps<{ id: string; label: string; hint?: string; error?: string; required?: boolean }>();
const describedBy = computed(() => [props.hint ? `${props.id}-hint` : '', props.error ? `${props.id}-error` : ''].filter(Boolean).join(' ') || undefined);
</script>

<template>
  <div class="field">
    <label :for="id">{{ label }}<span v-if="required" class="req" aria-hidden="true"> *</span></label>
    <slot :id="id" :described-by="describedBy" :invalid="!!error" />
    <p v-if="hint" :id="`${id}-hint`" class="hint muted">{{ hint }}</p>
    <p v-if="error" :id="`${id}-error`" class="err" role="alert">{{ error }}</p>
  </div>
</template>

<style scoped>
.field { display: grid; gap: var(--sp-1); }
label { font-weight: 600; font-size: var(--fs-sm); }
.req { color: var(--danger); }
.hint, .err { margin: 0; font-size: var(--fs-sm); }
.err { color: var(--danger); }
</style>
