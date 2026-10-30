<script setup lang="ts">
import { computed, useId } from 'vue';
import { fa, tr } from '../locale';
import { CERT_KIND, RANK_TONE, fmtDate, tx } from '../maps/people';
import QBadge from './QBadge.vue';
import QButton from './QButton.vue';
import QCard from './QCard.vue';
import QIcon from './QIcon.vue';
import QTricolor from './QTricolor.vue';

/**
 * Honour / certificate: title, recipient, event, date, 12-character verification code (LTR groups of 4) and «استعلام».
 * Slots: actions (beside «استعلام»), footer (under the verify row).
 */
export interface QCertificateCardProps {
  title: string;
  kind?: ('placement' | 'attendance') | undefined;
  kindLabel?: (string) | undefined;
  rank?: (1 | 2 | 3) | undefined;
  recipient?: (string) | undefined;
  event?: (string) | undefined;
  date?: (string) | undefined;
  code: string;
  /** Default `/verify?code=<code>`. */
  verifyHref?: (string) | undefined;
  state?: ('valid' | 'revoked') | undefined;
  revokedReason?: (string) | undefined;
  actions?: (string) | undefined;
  footer?: (string) | undefined;
}
const p = withDefaults(defineProps<QCertificateCardProps>(), { kind: 'placement', state: 'valid' });
const hid = useId();
const tone = computed(() => (p.rank && RANK_TONE[p.rank]) || 'none');
const code = computed(() => String(p.code || '').replace(/[^0-9A-Za-z]/g, '').toUpperCase());
const groups = computed(() => code.value.match(/.{1,4}/g) ?? []);
const revoked = computed(() => p.state === 'revoked');
const href = computed(() => p.verifyHref || `/verify?code=${encodeURIComponent(code.value)}`);
const kindText = computed(() => p.kindLabel || tx(CERT_KIND[p.kind]));
</script>

<template>
  <QCard
    as="article" chamfer padding="none" :aria-label="`${kindText}: ${title}`"
    :class="['q-certificate-card', `q-certificate-card--${tone}`, { 'q-certificate-card--revoked': revoked }]"
  >
    <div class="q-certificate-card__band">
      <QTricolor /><span>{{ kindText }}</span>
      <QBadge v-if="revoked" tone="danger" icon="ban">{{ tr('باطل‌شده', 'Revoked') }}</QBadge>
    </div>
    <div class="q-certificate-card__body">
      <span
        class="q-certificate-card__medal" :role="rank ? 'img' : undefined"
        :aria-label="rank ? tr('مقام ', 'Place ') + fa(rank) : undefined" :aria-hidden="rank ? undefined : 'true'"
      >
        <QIcon :name="rank === 1 ? 'trophy' : 'award'" :size="28" />
        <span v-if="rank" class="q-certificate-card__place" aria-hidden="true">{{ fa(rank) }}</span>
      </span>
      <h3 :id="hid" class="q-certificate-card__title"><bdi>{{ title }}</bdi></h3>
      <p v-if="recipient" class="q-certificate-card__to">{{ tr('اعطا به ', 'Awarded to ') }}<strong><bdi>{{ recipient }}</bdi></strong></p>
      <dl class="q-certificate-card__facts">
        <div v-if="event"><dt>{{ tr('رویداد', 'Event') }}</dt><dd><bdi>{{ event }}</bdi></dd></div>
        <div v-if="date"><dt>{{ tr('تاریخ', 'Date') }}</dt><dd><time :datetime="date">{{ fmtDate(date) }}</time></dd></div>
      </dl>
      <p v-if="revoked && revokedReason" class="q-certificate-card__revoked" role="note">{{ tr('دلیل ابطال: ', 'Revocation reason: ') }}<bdi>{{ revokedReason }}</bdi></p>
      <div class="q-certificate-card__verify">
        <div class="q-certificate-card__code-wrap">
          <span class="q-certificate-card__code-label">{{ tr('کد تأیید', 'Verification code') }}</span>
          <span class="q-certificate-card__code q-ltr">
            <span class="q-sr">{{ code.split('').join(' ') }}</span>
            <span v-for="(g, i) in groups" :key="i" aria-hidden="true">{{ g }}</span>
          </span>
        </div>
        <div v-if="actions || $slots.actions" class="q-certificate-card__actions">
          <slot name="actions">{{ actions }}</slot>
          <QButton variant="ghost" :href="href" icon="shield">{{ tr('استعلام', 'Check') }}</QButton>
        </div>
        <QButton v-else variant="ghost" :href="href" icon="shield">{{ tr('استعلام', 'Check') }}</QButton>
      </div>
      <div v-if="footer || $slots.footer" class="q-certificate-card__footer"><slot name="footer">{{ footer }}</slot></div>
    </div>
  </QCard>
</template>
