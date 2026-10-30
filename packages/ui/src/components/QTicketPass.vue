<script setup lang="ts">
import { computed, useId } from 'vue';
import { tr } from '../locale';
import { EQUIP, fmtDate, pseudoQrPath, stateBadge } from '../maps/people';
import QBadge from './QBadge.vue';
import QIcon from './QIcon.vue';

/**
 * Attendance pass: event, attendee, QR with rotating-code note, venue/address/station/parking, equipment.
 * Slot `qr`: the real QR node (e.g. an <svg> built by the app with qrcode-generator); without it a deterministic,
 * non-scannable pseudo-QR from `code` is drawn. `sample` (default true) overlays «نمونه» and labels it not scannable.
 */
export interface QTicketPassProps {
  event: string;
  game?: string;
  discipline?: string;
  date?: string;
  attendee: { name: string; team?: string; role?: string };
  code?: string;
  qrLabel?: string;
  sample?: boolean;
  rotateNote?: string;
  gate?: string;
  venue?: { name?: string; address?: string; station?: string; parking?: string };
  equipment?: { item: string; state?: 'declared' | 'approved' | 'rejected' }[];
  eyebrow?: string;
}
const p = withDefaults(defineProps<QTicketPassProps>(), { sample: true });
const hid = useId();
const rows = computed(() => {
  const v = p.venue ?? {};
  return ([
    v.name ? ['venue', tr('محل برگزاری', 'Venue'), v.name] : null, v.address ? ['address', tr('نشانی', 'Address'), v.address] : null,
    p.gate ? ['gate', tr('ورودی', 'Gate'), p.gate] : null, v.station ? ['station', tr('ایستگاه', 'Station'), v.station] : null,
    v.parking ? ['parking', tr('پارکینگ', 'Parking'), v.parking] : null,
  ] as const).filter((r) => r !== null);
});
const equip = computed(() => (p.equipment ?? []).map((e) => ({ item: e.item, b: stateBadge(EQUIP, e.state || 'declared') })));
const qrPath = computed(() => pseudoQrPath(p.code || p.event));
</script>

<template>
  <article class="q-ticket-pass" :aria-labelledby="hid">
    <div class="q-ticket-pass__inner">
      <div class="q-ticket-pass__main">
        <div class="q-ticket-pass__eyebrow">
          <QIcon name="ticket" :size="16" />{{ eyebrow || tr('کارت حضور', 'Entry card') }}
          <QBadge v-if="attendee.role" tone="neutral">{{ attendee.role }}</QBadge>
        </div>
        <h3 :id="hid" class="q-ticket-pass__event"><bdi>{{ event }}</bdi></h3>
        <p v-if="date || discipline || game" class="q-ticket-pass__when">
          <span v-if="game" class="q-ltr">{{ game }}</span>
          <span v-if="discipline">{{ discipline }}</span>
          <time v-if="date" :datetime="date" class="q-ticket-pass__date">{{ fmtDate(date, 'datetime') }}</time>
        </p>
        <div class="q-ticket-pass__attendee">
          <span class="q-ticket-pass__label">{{ tr('دارنده', 'Holder') }}</span>
          <strong><bdi>{{ attendee.name }}</bdi></strong>
          <span v-if="attendee.team" class="q-ticket-pass__muted"><bdi>{{ attendee.team }}</bdi></span>
        </div>
        <dl v-if="rows.length" class="q-ticket-pass__venue">
          <div v-for="r in rows" :key="r[0]"><dt>{{ r[1] }}</dt><dd><bdi>{{ r[2] }}</bdi></dd></div>
        </dl>
        <div v-if="equip.length" class="q-ticket-pass__equip">
          <h4 class="q-ticket-pass__equip-title">{{ tr('تجهیزات شخصی', 'Personal equipment') }}</h4>
          <ul><li v-for="(e, i) in equip" :key="i"><bdi>{{ e.item }}</bdi><QBadge v-bind="e.b.props">{{ e.b.label }}</QBadge></li></ul>
        </div>
      </div>
      <div class="q-ticket-pass__tear" aria-hidden="true" />
      <div class="q-ticket-pass__stub">
        <div
          class="q-ticket-pass__qr" role="img"
          :aria-label="sample ? tr('کد QR نمونه — قابل اسکن نیست', 'Sample QR code — not scannable') : qrLabel || tr('کد QR کارت حضور', 'Entry card QR code')"
        >
          <slot name="qr">
            <svg viewBox="-2 -2 29 29" class="q-ticket-pass__qr-svg" aria-hidden="true" focusable="false" shape-rendering="crispEdges"><path :d="qrPath" /></svg>
          </slot>
          <span v-if="sample" class="q-ticket-pass__sample" aria-hidden="true">{{ tr('نمونه', 'Sample') }}</span>
        </div>
        <span v-if="code" class="q-ticket-pass__code q-ltr">{{ code }}</span>
        <p class="q-ticket-pass__rotate">
          <QIcon name="refresh" :size="16" />
          <span>{{ rotateNote || tr('کد هر دقیقه عوض می‌شود و هر کد فقط یک بار در ورودی پذیرفته می‌شود.', 'The code changes every minute and each code is accepted only once at the gate.') }}</span>
        </p>
      </div>
    </div>
  </article>
</template>
