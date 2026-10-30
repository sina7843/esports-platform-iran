<script setup lang="ts">
import { computed, nextTick, ref, useId, watch } from 'vue';
import { fa, tr } from '../locale';
import { chatChannels, uidOf } from '../maps/data';
import QBadge from './QBadge.vue';
import QButton from './QButton.vue';
import QIcon from './QIcon.vue';
import QJalaliDate from './QJalaliDate.vue';

/** ChatPanel: match-room chat — own/other/referee/system messages, recipient radio group, composer with green send. */
export interface QChatPanelMessage {
  id?: string | number;
  side: 'own' | 'other' | 'referee' | 'system';
  author?: string;
  text: string;
  at?: string;
  channel?: 'all' | 'officials';
}
export interface QChatPanelChannel { value: string; label: string }
export interface QChatPanelProps {
  messages: QChatPanelMessage[];
  title?: string;
  defaultChannel?: string;
  channels?: QChatPanelChannel[];
  showChannel?: boolean;
  channelLabel?: string;
  placeholder?: string;
  inputLabel?: string;
  sendLabel?: string;
  maxLength?: number;
  disabled?: boolean;
  /** Max height of the message log. Default 360px. */
  height?: number | string;
  emptyText?: string;
  headerExtra?: string;
  /** false hides the «۴ پیام» count. */
  showCount?: boolean;
}
const p = withDefaults(defineProps<QChatPanelProps>(), { showChannel: true, showCount: true, maxLength: 1000 });
const emit = defineEmits<{ send: [text: string, channel: string]; channelChange: [value: string] }>();
const channelModel = defineModel<string | undefined>('channel', { default: undefined });

if (channelModel.value === undefined) channelModel.value = p.defaultChannel || 'all';
const channel = computed(() => channelModel.value ?? 'all');
const setChannel = (v: string) => { channelModel.value = v; emit('channelChange', v); };

const uid = uidOf(useId());
const text = ref('');
const log = ref<HTMLElement | null>(null);
watch(() => p.messages.length, () => nextTick(() => { if (log.value) log.value.scrollTop = log.value.scrollHeight; }), { immediate: true });

const send = () => {
  const t = text.value.trim();
  if (!t || p.disabled) return;
  emit('send', t, channel.value);
  text.value = '';
};
const onKey = (e: KeyboardEvent) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
};
const list = computed(() => p.channels ?? chatChannels());
const nMsg = computed(() => p.messages.filter((m) => m.side !== 'system').length);
const heading = computed(() => p.title || tr('گفت‌وگو', 'Chat'));
const authorOf = (m: QChatPanelMessage) => m.author || (m.side === 'own' ? tr('شما', 'You') : m.side === 'referee' ? tr('داور', 'Referee') : '');
const rootStyle = computed(() => (p.height ? { '--q-chat-height': typeof p.height === 'number' ? `${p.height}px` : p.height } : undefined));
</script>

<template>
  <section class="q-chat-panel" :aria-labelledby="uid + 'h'" :style="rootStyle">
    <header class="q-chat-panel__head">
      <h3 :id="uid + 'h'" class="q-chat-panel__title">{{ heading }}</h3>
      <span v-if="showCount" class="q-chat-panel__count q-num">{{ tr(fa(nMsg) + ' پیام', nMsg + (nMsg === 1 ? ' message' : ' messages')) }}</span>
      <slot name="headerExtra">{{ headerExtra }}</slot>
    </header>
    <ol ref="log" class="q-chat-panel__log" role="log" aria-live="polite" :aria-label="heading" tabindex="0">
      <template v-if="messages.length">
        <template v-for="(m, i) in messages" :key="m.id ?? i">
          <li v-if="m.side === 'system'" class="q-chat-panel__sys">
            <span>{{ m.text }}<template v-if="m.at">{{ ' · ' }}<QJalaliDate :iso="m.at" format="time" class="q-chat-panel__time" /></template></span>
          </li>
          <li v-else :class="['q-chat-panel__msg', `q-chat-panel__msg--${m.side || 'other'}`]">
            <div class="q-chat-panel__meta">
              <bdi class="q-chat-panel__author">{{ authorOf(m) }}</bdi>
              <QBadge v-if="m.side === 'referee'" tone="info" icon="gavel">{{ tr('داور', 'Referee') }}</QBadge>
              <span v-if="m.channel === 'officials'" class="q-chat-panel__private"><QIcon name="lock" :size="12" />{{ tr('فقط داور', 'Referee only') }}</span>
              <QJalaliDate v-if="m.at" :iso="m.at" format="time" class="q-chat-panel__time" />
            </div>
            <p class="q-chat-panel__bubble" dir="auto">{{ m.text }}</p>
          </li>
        </template>
      </template>
      <li v-else class="q-chat-panel__sys"><span><slot name="emptyText">{{ emptyText || tr('هنوز پیامی ارسال نشده است.', 'No messages yet.') }}</slot></span></li>
    </ol>
    <form class="q-chat-panel__composer" novalidate @submit.prevent="send">
      <div v-if="showChannel" class="q-chat-panel__channel">
        <span :id="uid + 'c'" class="q-chat-panel__channel-label">{{ channelLabel || tr('گیرنده', 'Recipient') }}</span>
        <div class="q-chat-panel__seg" role="radiogroup" :aria-labelledby="uid + 'c'">
          <label v-for="c in list" :key="c.value" :class="['q-chat-panel__opt', { 'is-on': channel === c.value }]">
            <input type="radio" :name="uid + 'ch'" :value="c.value" :checked="channel === c.value" class="q-chat-panel__radio" @change="setChannel(c.value)">
            <span>{{ c.label }}</span>
          </label>
        </div>
      </div>
      <div class="q-chat-panel__row">
        <label :for="uid + 't'" class="q-sr">{{ inputLabel || tr('پیام', 'Message') }}</label>
        <textarea
          :id="uid + 't'"
          v-model="text"
          class="q-chat-panel__input"
          rows="1"
          dir="auto"
          :maxlength="maxLength"
          :placeholder="placeholder || tr('پیام', 'Message')"
          :disabled="disabled"
          @keydown="onKey"
        />
        <QButton type="submit" variant="green" icon="send" flip-icon :disabled="disabled || !text.trim()">{{ sendLabel || tr('ارسال', 'Send') }}</QButton>
      </div>
    </form>
  </section>
</template>
