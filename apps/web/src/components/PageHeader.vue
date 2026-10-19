<script setup lang="ts">
defineProps<{ title: string; lead?: string }>();
</script>

<template>
  <header class="page-header">
    <div>
      <h1><slot name="title">{{ title }}</slot></h1>
      <p v-if="lead" class="muted lead">{{ lead }}</p>
    </div>
    <div class="row"><slot name="actions" /></div>
  </header>
</template>

<style scoped>
.page-header { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: flex-end; gap: var(--sp-4); margin-block-end: var(--sp-5); padding-block-end: var(--sp-4); border-block-end: 1px solid var(--border); }
h1 { margin: 0; font-size: var(--fs-xl); letter-spacing: -0.01em; }
.lead { margin: var(--sp-1) 0 0; max-inline-size: 60ch; }
</style>
