<script setup lang="ts">
import { computed, inject, useAttrs } from 'vue';
import { QLinkKey } from '../link';

/**
 * Internal: an <a>, or — when the app provided its RouterLink under QLinkKey and the href is internal — the RouterLink in
 * custom mode around the same <a> (same DOM, SPA navigation). class, style, aria-* and @click always land on the <a>;
 * a click handler that calls preventDefault() stops the navigation.
 */
defineOptions({ inheritAttrs: false });
const props = defineProps<{ href: string }>();
const attrs = useAttrs();
const routerLink = inject(QLinkKey, null);
const rest = computed(() => {
  const { onClick: _c, ...o } = attrs;
  return o;
});
const internal = computed(() => !!routerLink && props.href.startsWith('/') && !props.href.startsWith('//') && !attrs.target);

function go(e: MouseEvent, navigate: (e?: MouseEvent) => unknown) {
  const own = attrs.onClick as ((e: MouseEvent) => void) | ((e: MouseEvent) => void)[] | undefined;
  for (const f of Array.isArray(own) ? own : own ? [own] : []) f(e);
  if (!e.defaultPrevented) void navigate(e);
}
</script>

<template>
  <component :is="routerLink" v-if="internal" :to="href" custom v-slot="{ href: to, navigate }">
    <a v-bind="rest" :href="to" @click="go($event, navigate)"><slot /></a>
  </component>
  <a v-else v-bind="$attrs" :href="href"><slot /></a>
</template>
