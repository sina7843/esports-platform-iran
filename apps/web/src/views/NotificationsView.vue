<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { QBadge, QButton, QContainer, QDataState, QEmptyState, QFeedItem, QPageHeader, QSwitch, QTabs, dateTag, fa, formatJalali, isRtl, useToast, type IconName } from '@esp/ui';
import { esp06, type Notification } from '../api/esp06';
import { toClientError } from '../errors';
import { t, type MessageKey } from '../i18n';
import { useDataState } from '../useDataState';
import { useLoad } from '../useLoad';

/**
 * Spec docs/redesign/03-specs/notifications.md — NTF-001..006: in-site inbox grouped by Tehran day, unread filter,
 * mark read, acknowledgement for essential notices, delivery status per channel. Preferences live in Settings.
 */
const { push } = useToast();
const unreadOnly = ref(false);
const filter = ref('all');
const more = ref<string | null>(null);
const busy = ref(false);
const PAGE_HINT = 50;
const { data, loading, error, load } = useLoad(async () => {
  const r = await esp06.notifications({ unread: unreadOnly.value });
  more.value = r.items.length >= PAGE_HINT ? (r.items.at(-1)?.deliverAt ?? null) : null;
  return r;
});
watch(unreadOnly, () => void load());
const items = computed(() => data.value?.items ?? []);
const unread = computed(() => data.value?.unread ?? 0);
const ds = useDataState({ loading, error, empty: () => !!data.value && !items.value.length && !unreadOnly.value });

async function older() {
  if (!more.value || !data.value) return;
  busy.value = true;
  try {
    const r = await esp06.notifications({ before: more.value, unread: unreadOnly.value });
    data.value = { ...data.value, items: [...data.value.items, ...r.items.filter((n) => !data.value!.items.some((x) => x.id === n.id))] };
    more.value = r.items.length >= PAGE_HINT ? (r.items.at(-1)?.deliverAt ?? null) : null;
  } finally {
    busy.value = false;
  }
}
async function act(fn: () => Promise<unknown>, ok?: string) {
  try {
    await fn();
    if (ok) push({ tone: 'success', message: ok, duration: 4000 });
    await load();
  } catch (e) {
    push({ tone: 'danger', message: toClientError(e).message });
  }
}
const markAll = () => act(() => esp06.markRead('all'), t('nt.allRead'));
const markOne = (n: Notification) => { if (!n.readAt) void act(() => esp06.markRead([n.id])); };
const ack = (n: Notification) => act(() => esp06.ack(n.id), t('nt.ackDone'));

const GROUP: Record<string, string> = {
  match: 'matches', checkin: 'matches', schedule: 'matches', result: 'matches', decision: 'matches', 'follow.start': 'matches', 'follow.end': 'matches', 'follow.time': 'matches',
  registration: 'registrations', payment: 'registrations', invitation: 'teams', team: 'teams',
};
const ICON: Record<string, IconName> = {
  match: 'swords', checkin: 'check-circle', schedule: 'clock', result: 'trophy', decision: 'gavel', 'follow.start': 'play', 'follow.end': 'flag', 'follow.time': 'clock',
  registration: 'ticket', payment: 'wallet', invitation: 'users', team: 'users', honor: 'award', official: 'flag',
};
const groupOf = (n: Notification) => GROUP[n.category] ?? 'system';
const inFilter = (n: Notification, f: string) => f === 'all' || groupOf(n) === f;
const tabs = computed(() => (['all', 'matches', 'registrations', 'teams', 'system'] as const).map((k) => {
  const count = items.value.filter((n) => inFilter(n, k) && !n.readAt).length;
  return { key: k, label: t(`nt.${k}` as MessageKey), ...(count ? { count } : {}) };
}));
const shown = computed(() => items.value.filter((n) => inFilter(n, filter.value)));

const dayKey = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
const groups = computed(() => {
  const out: { key: string; at: string; items: Notification[] }[] = [];
  for (const n of shown.value) {
    const k = dayKey(n.deliverAt);
    const g = out.find((x) => x.key === k);
    if (g) g.items.push(n); else out.push({ key: k, at: n.deliverAt, items: [n] });
  }
  return out;
});
const today = dayKey(new Date().toISOString());
const yesterday = dayKey(new Date(Date.now() - 864e5).toISOString());
const dayLabel = (g: { key: string; at: string }) => g.key === today ? t('nt.today') : g.key === yesterday ? t('nt.yesterday')
  : new Intl.DateTimeFormat(dateTag(), { timeZone: 'Asia/Tehran', weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(g.at));
const CH: Record<string, MessageKey> = { sms: 'nt.chSms', email: 'nt.chEmail', push: 'nt.chPush' };
const ST: Record<string, MessageKey> = { delivered: 'nt.stDelivered', sent: 'nt.stSent', failed: 'nt.stFailed', pending: 'nt.stPending', skipped: 'nt.stSkipped' };
const cat = (c: string) => t(`ntf.cat.${c}` as MessageKey);
const linkOf = (n: Notification) => (n.link && n.link.startsWith('/') && !n.link.startsWith('//') ? n.link : undefined);
const needsAck = (n: Notification) => n.ackRequired && !n.ackAt;
</script>

<template>
  <QContainer>
    <div class="k-stack p-notifications">
      <QPageHeader compact :title="t('nt.title')" :description="t('nt.desc')">
        <template #actions>
          <QButton variant="secondary" icon="check" :disabled="!unread || ds.state.value !== 'content'" @click="markAll">{{ t('nt.markAll') }}</QButton>
          <QButton variant="ghost" icon="settings" href="/account/settings#set-ntf">{{ t('nt.prefs') }}</QButton>
        </template>
      </QPageHeader>
      <div class="p-notifications-bar">
        <div class="p-notifications-bar__tabs"><QTabs v-model="filter" variant="pill" :aria-label="t('nt.type')" :items="tabs" /></div>
        <QSwitch v-model="unreadOnly" :label="t('nt.unreadOnly')" />
      </div>
      <QDataState v-if="ds.state.value !== 'content'" v-bind="ds.props.value" skeleton="rows" icon="bell" :empty-title="t('nt.empty')" :empty-body="t('nt.emptyBody')" @retry="load" />
      <QEmptyState v-else-if="!shown.length" compact icon="filter" :title="unreadOnly ? t('nt.noUnread') : t('nt.noneHere')">
        <template #action><QButton variant="ghost" @click="filter = 'all'; unreadOnly = false">{{ t('nt.showAll') }}</QButton></template>
      </QEmptyState>
      <div v-else class="p-notifications-days">
        <section v-for="g in groups" :key="g.key" class="p-notifications-day" :aria-labelledby="`nd-${g.key}`">
          <h2 :id="`nd-${g.key}`" class="p-notifications-day__h">{{ dayLabel(g) }}</h2>
          <ul class="p-notifications-list">
            <QFeedItem
              v-for="n in g.items" :key="n.id" as="li" title-as="h3" :icon="ICON[n.category] ?? 'bell'" :tone="n.essential ? 'warning' : 'neutral'"
              :unread="!n.readAt" :unread-label="t('nt.unread')" :title="n.count > 1 ? `${n.title} ×${fa(n.count)}` : n.title"
              :time-text="formatJalali(n.deliverAt, 'time')" :href="needsAck(n) ? undefined : linkOf(n)" @click="markOne(n)"
            >
              <template #body>
                <span dir="auto">{{ n.body }}</span>
                <span class="p-notifications-meta">
                  {{ cat(n.category) }}<template v-if="n.essential"> · {{ t('nt.essential') }}</template>
                  <span v-for="c in n.channels.filter((x) => x.channel !== 'in_app')" :key="c.channel" :class="{ 'is-failed': c.status === 'failed' }">
                    · {{ CH[c.channel] ? t(CH[c.channel]!) : c.channel }}: {{ ST[c.status] ? t(ST[c.status]!) : c.status }}
                  </span>
                </span>
              </template>
              <template v-if="n.essential" #badge><QBadge tone="warning">{{ t('nt.essential') }}</QBadge></template>
              <template v-if="needsAck(n) || n.ackAt || (!n.readAt && !n.ackRequired)" #actions>
                <div class="p-notifications-acts">
                  <QButton v-if="needsAck(n)" variant="primary" size="sm" @click.stop="ack(n)">{{ t('nt.ack') }}</QButton>
                  <span v-if="n.ackAt" class="p-notifications-acked">{{ t('nt.acked', { time: formatJalali(n.ackAt, 'time') }) }}</span>
                  <QButton v-if="!n.readAt && !n.ackRequired" variant="ghost" size="sm" @click.stop="markOne(n)">{{ t('nt.read') }}</QButton>
                  <QButton v-if="needsAck(n) && linkOf(n)" variant="ghost" size="sm" :href="linkOf(n)" :icon-end="isRtl() ? 'arrow-left' : 'arrow-right'">{{ t('nt.open') }}</QButton>
                </div>
              </template>
            </QFeedItem>
          </ul>
        </section>
        <div class="p-notifications-more">
          <QButton v-if="more" variant="secondary" icon="chevron-down" :loading="busy" @click="older">{{ t('nt.older') }}</QButton>
          <p v-else class="p-notifications-summary">{{ t('nt.allShown') }}</p>
        </div>
      </div>
    </div>
  </QContainer>
</template>

<style scoped>
.p-notifications { gap: var(--space-6); }
.p-notifications-bar { display: flex; align-items: center; justify-content: space-between; gap: var(--space-4); flex-wrap: wrap; }
.p-notifications-bar__tabs { min-width: 0; flex: 1 1 520px; overflow-x: auto; }
.p-notifications-day { display: flex; flex-direction: column; gap: var(--space-3); }
.p-notifications-day__h { margin: 0; display: flex; align-items: center; gap: var(--space-3); font-size: 14px; font-weight: 800; color: var(--ink-muted); }
.p-notifications-day__h::after { content: ''; flex: 1 1 auto; block-size: 1px; background: var(--line); }
.p-notifications-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--surface); overflow: hidden; }
.p-notifications-list > li + li { border-block-start: 1px solid var(--line); }
.p-notifications-meta { display: block; margin-block-start: var(--space-1); font-size: 12px; color: var(--ink-subtle); }
.p-notifications-meta .is-failed { color: var(--danger-text); }
.p-notifications-acts { display: flex; flex-wrap: wrap; gap: var(--space-2); align-items: center; }
.p-notifications-acked { font-size: 12px; color: var(--success-text); }
.p-notifications-days { display: flex; flex-direction: column; gap: var(--space-6); }
.p-notifications-more { display: flex; justify-content: center; }
.p-notifications-summary { margin: 0; font-size: 13px; color: var(--ink-subtle); }
</style>
