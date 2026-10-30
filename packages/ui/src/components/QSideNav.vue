<script setup lang="ts">
import { computed, useId, type FunctionalComponent } from 'vue';
import type { IconName } from '../icons';
import { fa, tr } from '../locale';
import { appArena, countText } from '../maps/navigation';
import QBadge from './QBadge.vue';
import QDrawer from './QDrawer.vue';
import QIcon from './QIcon.vue';
import QLink from './QLink.vue';
import QLogo from './QLogo.vue';

export interface SideNavItem {
  key: string; label: string; icon?: IconName; href?: string; count?: number;
  /** Badge tone for the count; default neutral (green when active). */
  countTone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'live' | 'red' | 'green';
}
export interface SideNavSection { title: string; items: SideNavItem[] }
/**
 * SideNav — the panel's grouped navigation. mode 'rail' (in the layout; `collapsed` = icons only) or 'drawer' (mobile:
 * inside a Drawer from inline-start with focus trap, Escape and focus return). Drawer: `v-model:open` + `close`.
 * `navigate` emits (key, event). Links go through QLink (SPA navigation). `class` lands on the nav (rail) or the drawer.
 */
export interface QSideNavProps {
  sections: SideNavSection[];
  /** Key of the current item. */
  active?: (string) | undefined;
  /** Icons only (76px); labels stay for screen readers, title gives the tooltip. */
  collapsed?: (boolean) | undefined;
  mode?: ('rail' | 'drawer') | undefined;
  /** drawer mode: inline rendering for docs. */
  inline?: (boolean) | undefined;
  inlineHeight?: (number) | undefined;
  backdrop?: (string) | undefined;
  /** drawer mode heading next to the logo; default «میدان رقابت». */
  drawerTitle?: (string) | undefined;
  /** id of the <nav> (the TopBar menu button's aria-controls). */
  id?: (string) | undefined;
  ariaLabel?: (string) | undefined;
}
const p = withDefaults(defineProps<QSideNavProps>(), { mode: 'rail' });
const open = defineModel<boolean>('open', { default: false });
const emit = defineEmits<{ close: []; navigate: [key: string, e: MouseEvent] }>();

const uid = useId();
const drawer = computed(() => p.mode === 'drawer');
const isCollapsed = computed(() => !!p.collapsed && !drawer.value);
const tip = (it: SideNavItem) => it.label + (it.count ? ` (${fa(it.count)})` : '');
function close() {
  emit('close');
  open.value = false;
}
// rail mode renders the <nav> itself as the root; drawer mode wraps it in a Drawer
const Bare: FunctionalComponent = (_, { slots }) => slots.default?.()[0];
const drawerProps = computed(() => ({
  open: open.value, side: 'start', width: 300, onClose: close,
  ...(p.inline != null ? { inline: p.inline } : {}),
  ...(p.inlineHeight != null ? { inlineHeight: p.inlineHeight } : {}),
  ...(p.backdrop != null ? { backdrop: p.backdrop } : {}),
}));
</script>

<template>
  <component :is="drawer ? QDrawer : Bare" v-bind="drawer ? drawerProps : {}">
    <template v-if="drawer" #title>
      <span class="q-side-nav__brand"><QLogo :size="36" alt="" />{{ drawerTitle || appArena() }}</span>
    </template>
    <template v-if="drawer && $slots.backdrop" #backdrop><slot name="backdrop" /></template>
    <nav
      :id="id" :class="['q-side-nav', { 'q-side-nav--collapsed': isCollapsed, 'q-side-nav--drawer': drawer }]"
      :aria-label="ariaLabel || tr('ناوبری پنل', 'Panel navigation')"
    >
      <section v-for="(s, si) in sections" :key="si" class="q-side-nav__section" :aria-labelledby="`${uid}-s${si}`">
        <h2 :id="`${uid}-s${si}`" :class="['q-side-nav__title', { 'q-sr': isCollapsed }]">{{ s.title }}</h2>
        <ul class="q-side-nav__list">
          <li v-for="it in s.items ?? []" :key="it.key">
            <QLink
              :href="it.href || '#'" :class="['q-side-nav__item', { 'is-active': it.key === active }]"
              :aria-current="it.key === active ? 'page' : undefined" :title="isCollapsed ? tip(it) : undefined"
              @click="emit('navigate', it.key, $event)"
            >
              <QIcon :name="it.icon || 'chevron-left'" :size="20" class="q-side-nav__icon" />
              <span :class="['q-side-nav__label', { 'q-sr': isCollapsed }]">{{ isCollapsed ? tip(it) : it.label }}</span>
              <QBadge v-if="it.count && !isCollapsed" :tone="it.countTone || (it.key === active ? 'green' : 'neutral')" class="q-side-nav__count">{{ countText(it.count) }}</QBadge>
              <span v-if="it.count && isCollapsed" class="q-side-nav__pip" aria-hidden="true" />
            </QLink>
          </li>
        </ul>
      </section>
    </nav>
  </component>
</template>
