<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from 'vue';
import type { IconName } from '../icons';
import { tr } from '../locale';
import { KINDS, RANK_TONE, crest, firstChar, tx } from '../maps/people';
import { usePeopleBool } from '../composables/people-bool';
import QBadge from './QBadge.vue';
import QButton from './QButton.vue';
import QIcon from './QIcon.vue';
import QVerifiedMark from './QVerifiedMark.vue';

export interface QProfileHeaderBadge { label: string; tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'green'; icon?: IconName }
export interface QProfileHeaderHonour { label: string; rank?: 1 | 2 | 3 }
export interface QProfileHeaderFact { label: string; value: string }
export interface QProfileHeaderMenuItem { label: string; icon?: IconName; danger?: boolean; onSelect?: () => void }

/**
 * Public page header for a player, team or organizer: cover, avatar/crest, name, handle, marks, honours, facts, actions.
 * `v-model:following` + `@follow-change`; `:on-follow-change="false"` hides the toggle (own profile).
 * Default «…» menu items emit `report` / `block`. Slot: actions (before the menu).
 */
export interface QProfileHeaderProps {
  kind?: ('player' | 'team' | 'organizer') | undefined;
  name: string;
  handle?: (string) | undefined;
  initial?: (string) | undefined;
  avatarSrc?: (string) | undefined;
  coverSrc?: (string) | undefined;
  coverText?: (string) | undefined;
  verified?: (boolean) | undefined;
  verifiedLabel?: (string) | undefined;
  kindLabel?: (string) | undefined;
  badges?: (QProfileHeaderBadge[]) | undefined;
  honours?: (QProfileHeaderHonour[]) | undefined;
  facts?: (QProfileHeaderFact[]) | undefined;
  careerSummary?: string | null | false | undefined;
  emptyCareerLabel?: (string) | undefined;
  hideCareer?: (boolean) | undefined;
  careerIcon?: (IconName) | undefined;
  following?: boolean | undefined;
  defaultFollowing?: (boolean) | undefined;
  /** Listener of @follow-change; false hides the follow toggle. */
  onFollowChange?: ((following: boolean) => void) | false | undefined;
  followLabel?: (string) | undefined;
  followingLabel?: (string) | undefined;
  menuItems?: (QProfileHeaderMenuItem[]) | undefined;
  defaultMenuOpen?: (boolean) | undefined;
  actions?: (string) | undefined;
  headingLevel?: (1 | 2 | 3) | undefined;
}
const p = withDefaults(defineProps<QProfileHeaderProps>(), {
  kind: 'player', careerSummary: undefined, following: undefined, onFollowChange: undefined, careerIcon: 'chart',
});
const emit = defineEmits<{ 'update:following': [following: boolean]; block: []; report: [] }>();
const { value: on, set: toggle } = usePeopleBool(() => p.following, () => p.defaultFollowing, (v) => {
  emit('update:following', v);
  if (typeof p.onFollowChange === 'function') p.onFollowChange(v);
});

const hid = useId();
const av = computed(() => crest('q-profile-header__avatar', 96, p.kind !== 'player'));
const items = computed<QProfileHeaderMenuItem[]>(() => p.menuItems ?? [
  { label: tr('گزارش تخلف', 'Report'), icon: 'flag', onSelect: () => emit('report') },
  { label: tr('مسدودکردن', 'Block'), icon: 'ban', danger: true, onSelect: () => emit('block') },
]);
const verifiedText = computed(() => p.verifiedLabel || (p.kind === 'organizer' ? tr('برگزارکنندهٔ تأییدشده', 'Verified organizer')
  : p.kind === 'team' ? tr('تیم تأییدشده', 'Verified team') : tr('هویت تأییدشده', 'Verified identity')));
const moreLabel = computed(() => tr('گزینه‌های بیشتر', 'More options'));

/* «…» menu: click toggles, first item focused on open, arrows/Home/End move, Escape closes and returns focus, outside click closes. */
const menuOpen = ref(!!p.defaultMenuOpen);
const menuId = useId();
const wrap = ref<HTMLElement | null>(null);
let focusFirst = false;
const menuItemsEls = () => Array.from(wrap.value?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
function onDoc(e: MouseEvent) { if (wrap.value && !wrap.value.contains(e.target as Node)) menuOpen.value = false; }
function onKey(e: KeyboardEvent) {
  if (e.key !== 'Escape') return;
  menuOpen.value = false;
  wrap.value?.querySelector('button')?.focus();
}
function unlisten() { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); }
watch(menuOpen, async (open) => {
  unlisten();
  if (!open || typeof document === 'undefined') return;
  document.addEventListener('mousedown', onDoc);
  document.addEventListener('keydown', onKey);
  if (focusFirst) { await nextTick(); menuItemsEls()[0]?.focus(); focusFirst = false; }
}, { immediate: true });
onBeforeUnmount(unlisten);
function toggleMenu() { focusFirst = !menuOpen.value; menuOpen.value = !menuOpen.value; }
function onMenuKey(e: KeyboardEvent) {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;
  e.preventDefault();
  const els = menuItemsEls(), n = els.length;
  const i = els.indexOf(document.activeElement as HTMLElement);
  const j = e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : e.key === 'ArrowDown' ? (i + 1) % n : (i - 1 + n) % n;
  els[j]?.focus();
}
function select(it: QProfileHeaderMenuItem) { menuOpen.value = false; it.onSelect?.(); }
</script>

<template>
  <section :class="['q-profile-header', `q-profile-header--${kind}`]" :aria-labelledby="hid">
    <div class="q-profile-header__cover q-stripes" aria-hidden="true">
      <img v-if="coverSrc" :src="coverSrc" alt="" />
      <span v-else-if="coverText" class="q-profile-header__cover-text">{{ coverText }}</span>
    </div>
    <div class="q-profile-header__main">
      <span :class="av.class" :style="av.style" aria-hidden="true"><img v-if="avatarSrc" :src="avatarSrc" alt="" /><template v-else>{{ initial || firstChar(name) }}</template></span>
      <div class="q-profile-header__id">
        <div class="q-profile-header__title">
          <component :is="`h${headingLevel ?? 1}`" :id="hid" class="q-profile-header__name"><bdi>{{ name }}</bdi></component>
          <QVerifiedMark v-if="verified" :size="22" :label="verifiedText" />
        </div>
        <div class="q-profile-header__sub">
          <span v-if="handle" class="q-profile-header__handle q-ltr">{{ handle }}</span>
          <span>{{ kindLabel || tx(KINDS[kind]) || kind }}</span>
        </div>
      </div>
      <div class="q-profile-header__actions">
        <button
          v-if="onFollowChange !== false"
          type="button"
          :class="['q-profile-header__follow', { 'q-profile-header__follow--on': on }]"
          :aria-pressed="on ? 'true' : 'false'"
          :aria-label="(followLabel || tr('دنبال‌کردن', 'Follow')) + (name ? ' ' + name : '')"
          @click="toggle()"
        >
          <QIcon :name="on ? 'check' : 'plus'" :size="18" />
          <span aria-hidden="true">{{ on ? followingLabel || tr('دنبال می‌کنید', 'Following') : followLabel || tr('دنبال‌کردن', 'Follow') }}</span>
        </button>
        <slot name="actions">{{ actions }}</slot>
        <div v-if="items.length" ref="wrap" class="q-profile-header__menu">
          <QButton
            variant="secondary" icon-only icon="more" :aria-label="moreLabel" aria-haspopup="menu"
            :aria-expanded="menuOpen ? 'true' : 'false'" :aria-controls="menuOpen ? menuId : undefined" @click="toggleMenu"
          />
          <div v-if="menuOpen" :id="menuId" class="q-profile-header__menu-list" role="menu" :aria-label="moreLabel" @keydown="onMenuKey">
            <button
              v-for="(it, i) in items" :key="i" type="button" role="menuitem" tabindex="-1"
              :class="['q-profile-header__menu-item', { 'q-profile-header__menu-item--danger': it.danger }]"
              @click="select(it)"
            >
              <QIcon v-if="it.icon" :name="it.icon" :size="18" /><span>{{ it.label }}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
    <ul v-if="badges?.length || honours?.length" class="q-profile-header__marks" :aria-label="tr('نشان‌ها و افتخارات', 'Badges and honors')">
      <li v-for="(b, i) in badges ?? []" :key="'b' + i"><QBadge :tone="b.tone || 'success'" :icon="b.icon || 'check-circle'">{{ b.label }}</QBadge></li>
      <li
        v-for="(o, i) in honours ?? []" :key="'h' + i"
        :class="['q-profile-header__honour', o.rank ? `q-profile-header__honour--${RANK_TONE[o.rank] || 'none'}` : null]"
      >
        <QIcon :name="o.rank === 1 ? 'trophy' : 'award'" :size="16" /><span>{{ o.label }}</span>
      </li>
    </ul>
    <dl v-if="facts?.length" class="q-profile-header__facts">
      <div v-for="(x, i) in facts" :key="i"><dt>{{ x.label }}</dt><dd>{{ x.value }}</dd></div>
    </dl>
    <p v-if="!hideCareer && careerSummary !== false" :class="['q-profile-header__career', { 'q-profile-header__career--empty': !careerSummary }]">
      <QIcon :name="careerIcon" :size="16" />
      <span>{{ careerSummary || emptyCareerLabel || tr('کارنامه‌ای ثبت نشده است', 'No record yet') }}</span>
    </p>
  </section>
</template>
