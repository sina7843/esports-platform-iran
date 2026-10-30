<script setup lang="ts">
import { computed } from 'vue';
import { tr } from '../locale';
import { CHECKIN_STATES, GID_STATES, ROLES, ROSTER_STATES, cnt, crest, firstChar, stateBadge, tx } from '../maps/people';
import QBadge from './QBadge.vue';
import QIcon from './QIcon.vue';

export type QRosterListRole = 'owner' | 'manager' | 'captain' | 'player' | 'substitute' | 'coach' | 'analyst';
export interface QRosterListMember {
  id?: string | number;
  name: string;
  initial?: string;
  avatarSrc?: string;
  roles?: QRosterListRole[];
  gameId?: { value: string; state?: 'unverified' | 'pending' | 'verified' | 'rejected' | 'disputed' };
  roster?: 'confirmed' | 'invited' | 'declined';
  checkIn?: 'checked_in' | 'pending' | 'absent';
  /** Row action text; prefer the `row-actions` scoped slot ({ member, index }) for buttons. */
  actions?: string;
}
/** Team members with roles, game-identity verification, roster confirmation and check-in states. Slots: headerAction, row-actions. */
export interface QRosterListProps {
  /** Heading; false hides the header. Default «اعضای فعلی». */
  title?: string | false | undefined;
  members: QRosterListMember[];
  headerAction?: (string) | undefined;
  emptyLabel?: (string) | undefined;
  /** The «ترکیب و حضور» column. Default: shown only when a member has roster or checkIn. */
  showStates?: boolean | undefined;
}
const p = withDefaults(defineProps<QRosterListProps>(), { title: undefined, showStates: undefined });
const listLabel = computed(() => p.title || tr('اعضای فعلی', 'Current members'));
const states = computed(() => (p.showStates != null ? p.showStates : p.members.some((m) => m.roster || m.checkIn)));
const rows = computed(() => p.members.map((m) => ({
  m,
  gid: m.gameId ? stateBadge(GID_STATES, m.gameId.state || 'unverified') : null,
  roster: m.roster ? stateBadge(ROSTER_STATES, m.roster) : null,
  check: m.checkIn ? stateBadge(CHECKIN_STATES, m.checkIn) : null,
})));
const av = crest('q-roster-list__avatar', 40, false);
</script>

<template>
  <div :class="['q-roster-list', { 'q-roster-list--no-states': !states }]">
    <div v-if="title !== false" class="q-roster-list__head">
      <h3 class="q-roster-list__title">{{ listLabel }}</h3>
      <span class="q-roster-list__count">{{ cnt(members.length, 'نفر', 'member') }}</span>
      <slot name="headerAction">{{ headerAction }}</slot>
    </div>
    <div v-if="members.length" class="q-roster-list__box">
      <div class="q-roster-list__cols" aria-hidden="true">
        <span>{{ tr('عضو و شناسهٔ بازی', 'Member and game ID') }}</span><span>{{ tr('نقش', 'Role') }}</span>
        <span v-if="states">{{ tr('ترکیب و حضور', 'Roster and check-in') }}</span><span />
      </div>
      <ul class="q-roster-list__list" :aria-label="listLabel">
        <li v-for="({ m, gid, roster, check }, index) in rows" :key="m.id ?? m.name" class="q-roster-list__row">
          <div class="q-roster-list__who">
            <span :class="av.class" :style="av.style" aria-hidden="true"><img v-if="m.avatarSrc" :src="m.avatarSrc" alt="" /><template v-else>{{ m.initial || firstChar(m.name) }}</template></span>
            <div class="q-roster-list__names">
              <span class="q-roster-list__name"><bdi>{{ m.name }}</bdi></span>
              <span v-if="m.gameId && gid" class="q-roster-list__gid">
                <span class="q-roster-list__gid-value q-ltr">{{ m.gameId.value }}</span>
                <QBadge v-bind="gid.props"><span class="q-sr">{{ tr('شناسهٔ بازی: ', 'Game ID: ') }}</span>{{ gid.label }}</QBadge>
              </span>
            </div>
          </div>
          <ul class="q-roster-list__roles" :aria-label="tr('نقش‌ها', 'Roles')">
            <li v-for="r in m.roles ?? []" :key="r" :class="['q-roster-list__role', { 'q-roster-list__role--lead': r === 'owner' || r === 'captain' }]">
              <QIcon v-if="r === 'owner'" name="crown" :size="14" /><QIcon v-else-if="r === 'captain'" name="shield" :size="14" />{{ tx(ROLES[r]) || r }}
            </li>
          </ul>
          <div v-if="states" class="q-roster-list__states">
            <QBadge v-if="roster" v-bind="roster.props"><span class="q-sr">{{ tr('ترکیب: ', 'Roster: ') }}</span>{{ roster.label }}</QBadge>
            <QBadge v-if="check" v-bind="check.props"><span class="q-sr">{{ tr('حضور: ', 'Check-in: ') }}</span>{{ check.label }}</QBadge>
          </div>
          <div class="q-roster-list__actions"><slot name="row-actions" :member="m" :index="index">{{ m.actions }}</slot></div>
        </li>
      </ul>
    </div>
    <p v-else class="q-roster-list__empty">{{ emptyLabel || tr('هنوز عضوی در تیم نیست.', 'No members in this team yet.') }}</p>
  </div>
</template>
