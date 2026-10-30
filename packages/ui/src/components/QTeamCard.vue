<script setup lang="ts">
import { tr } from '../locale';
import { cnt, crest, firstChar } from '../maps/people';
import { usePeopleBool } from '../composables/people-bool';
import QButton from './QButton.vue';
import QIcon from './QIcon.vue';
import QLink from './QLink.vue';
import QVerifiedMark from './QVerifiedMark.vue';

/**
 * Team summary card: chamfered crest, name, game chips, members, city, follow toggle and link.
 * `v-model:following` (or `following` + `@follow-change`); `:on-follow-change="false"` hides the toggle (own team).
 * Slots: actions (extra buttons), footer (strip under the actions).
 */
export interface QTeamCardProps {
  name: string;
  initial?: (string) | undefined;
  logoSrc?: (string) | undefined;
  tag?: (string) | undefined;
  verified?: (boolean) | undefined;
  games?: (string[]) | undefined;
  members?: (number) | undefined;
  city?: (string) | undefined;
  href?: (string) | undefined;
  linkLabel?: (string) | undefined;
  /** Controlled follow state (`v-model:following`). */
  following?: boolean | undefined;
  defaultFollowing?: (boolean) | undefined;
  /** Listener of @follow-change; false hides the follow toggle. Declared as a prop so `false` can be passed. */
  onFollowChange?: ((following: boolean) => void) | false | undefined;
  followLabel?: (string) | undefined;
  followingLabel?: (string) | undefined;
  actions?: (string) | undefined;
  footer?: (string) | undefined;
}
const p = withDefaults(defineProps<QTeamCardProps>(), { following: undefined, onFollowChange: undefined });
const emit = defineEmits<{ 'update:following': [following: boolean] }>();
const { value: on, set: toggle } = usePeopleBool(() => p.following, () => p.defaultFollowing, (v) => {
  emit('update:following', v);
  if (typeof p.onFollowChange === 'function') p.onFollowChange(v);
});
const c = crest('q-team-card__crest', 64, true);
</script>

<template>
  <article class="q-team-card">
    <div class="q-team-card__head">
      <span :class="c.class" :style="c.style" aria-hidden="true"><img v-if="logoSrc" :src="logoSrc" alt="" /><template v-else>{{ initial || firstChar(name) }}</template></span>
      <div class="q-team-card__id">
        <h3 class="q-team-card__name">
          <QLink v-if="href" :href="href" class="q-team-card__link"><bdi>{{ name }}</bdi></QLink>
          <bdi v-else>{{ name }}</bdi>
          <QVerifiedMark v-if="verified" :size="16" :label="tr('تیم تأییدشده', 'Verified team')" />
        </h3>
        <span v-if="tag" class="q-team-card__tag q-ltr">{{ tag }}</span>
      </div>
    </div>
    <ul class="q-team-card__meta" :aria-label="tr('مشخصات تیم', 'Team details')">
      <li v-if="members != null"><QIcon name="users" :size="16" /><span>{{ cnt(members, 'عضو', 'member') }}</span></li>
      <li v-if="city"><QIcon name="map-pin" :size="16" /><span>{{ city }}</span></li>
    </ul>
    <ul v-if="games?.length" class="q-team-card__games" :aria-label="tr('بازی‌ها', 'Games')">
      <li v-for="g in games" :key="g" class="q-team-card__game q-ltr">{{ g }}</li>
    </ul>
    <div v-if="onFollowChange !== false || href || actions || $slots.actions" class="q-team-card__actions">
      <button
        v-if="onFollowChange !== false"
        type="button"
        :class="['q-team-card__follow', { 'q-team-card__follow--on': on }]"
        :aria-pressed="on ? 'true' : 'false'"
        :aria-label="(followLabel || tr('دنبال‌کردن', 'Follow')) + (name ? ' ' + name : '')"
        @click="toggle()"
      >
        <QIcon :name="on ? 'check' : 'plus'" :size="18" />
        <span aria-hidden="true">{{ on ? followingLabel || tr('دنبال می‌کنید', 'Following') : followLabel || tr('دنبال‌کردن', 'Follow') }}</span>
      </button>
      <slot name="actions">{{ actions }}</slot>
      <QButton v-if="href" variant="ghost" :href="href" icon-end="arrow-right" flip-icon class="q-team-card__more">{{ linkLabel || tr('صفحهٔ تیم', 'Team page') }}</QButton>
    </div>
    <div v-if="footer || $slots.footer" class="q-team-card__footer"><slot name="footer">{{ footer }}</slot></div>
  </article>
</template>
