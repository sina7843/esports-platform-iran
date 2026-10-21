<script setup lang="ts">
export interface Column {
  key: string;
  label: string;
}
defineProps<{ caption: string; columns: Column[]; rows: object[]; rowKey: string; rowHeader?: string }>();
function cell(row: object, key: string): unknown {
  return (row as Record<string, unknown>)[key];
}
</script>

<template>
  <div class="table-wrap" role="region" tabindex="0" :aria-label="caption">
    <table class="data-table">
      <caption>{{ caption }}</caption>
      <thead>
        <tr><th v-for="c in columns" :key="c.key" scope="col">{{ c.label }}</th></tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(cell(row, rowKey))">
          <component :is="c.key === rowHeader ? 'th' : 'td'" v-for="c in columns" :key="c.key" :scope="c.key === rowHeader ? 'row' : undefined" dir="auto" :data-label="c.label" :class="{ 'row-head': c.key === rowHeader }">
            <slot :name="`cell-${c.key}`" :row="row" :value="cell(row, c.key)">{{ cell(row, c.key) ?? '—' }}</slot>
          </component>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.table-wrap { overflow-x: auto; border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--surface); }
caption { padding: var(--sp-3) var(--sp-3) var(--sp-2); }
.row-head { background: transparent; color: var(--text); font-size: var(--fs-md); font-weight: 600; }
@media (max-width: 640px) {
  thead { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
  tr { display: block; border-block-end: 2px solid var(--border); padding-block: var(--sp-2); }
  td, th { display: flex; justify-content: space-between; gap: var(--sp-3); border: 0; padding: var(--sp-1) var(--sp-3); }
  td::before, th.row-head::before { content: attr(data-label); color: var(--text-muted); font-size: var(--fs-sm); flex: none; }
}
</style>
