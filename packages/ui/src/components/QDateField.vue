<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import { fa, isRtl, localeState, tr } from '../locale';
import {
  DAY, WEEK_EN, WEEK_FA, calDate, calOf, hmOf, isoOf, jCmp, longText, monthLen, monthTitle, pad2, parseIso, timeText,
  type Cal, type CalDay, type HM,
} from '../maps/inputs';
import { useControlled, useUid } from '../composables/inputs-field';
import QButton from './QButton.vue';
import QFormField from './QFormField.vue';
import QIcon from './QIcon.vue';

/**
 * DateField: date or date-time in Tehran time. fa: Jalali, Saturday-first grid; en: Gregorian, Monday-first grid.
 * Today outlined, selected green, optional disabled past, month navigation, optional hour/minute selects.
 * v-model is ISO ('YYYY-MM-DD', or 'YYYY-MM-DDTHH:mm:00+03:30' with withTime) + change(iso).
 * hint: undefined → Tehran-time note with withTime; null hides it.
 */
export interface QDateFieldProps {
  label?: string | undefined;
  hint?: string | null | undefined;
  error?: string | undefined;
  required?: boolean | undefined;
  disabled?: boolean | undefined;
  placeholder?: string | undefined;
  withTime?: boolean | undefined;
  minuteStep?: number | undefined;
  defaultHour?: number | undefined;
  disablePast?: boolean | undefined;
  min?: string | undefined;
  max?: string | undefined;
  today?: string | undefined;
  defaultOpen?: boolean | undefined;
  dialogLabel?: string | undefined;
  doneLabel?: string | undefined;
  id?: string | undefined;
  defaultValue?: string | null | undefined;
}
const p = withDefaults(defineProps<QDateFieldProps>(), { hint: undefined, minuteStep: 5, defaultHour: 18 });
const model = defineModel<string | null>();
const emit = defineEmits<{ change: [iso: string] }>();
const cur = useControlled<string | null>(model, p.defaultValue ?? null);

const cal = computed<Cal>(() => (localeState.locale === 'en' ? 'gregory' : 'persian'));
const weekStart = computed(() => (cal.value === 'gregory' ? 1 : 6)); // getUTCDay() of the first column
const WEEK = computed(() => (cal.value === 'gregory' ? WEEK_EN : WEEK_FA));
const valDate = computed(() => parseIso(cur.value));
const todayD = computed(() => parseIso(p.today) ?? new Date());
const tj = computed(() => calOf(cal.value, todayD.value));
const sj = computed(() => (valDate.value ? calOf(cal.value, valDate.value) : null));
const minJ = computed(() => { const d = parseIso(p.min); return d ? calOf(cal.value, d) : p.disablePast ? tj.value : null; });
const maxJ = computed(() => { const d = parseIso(p.max); return d ? calOf(cal.value, d) : null; });

const viewState = ref<{ cal: Cal; y: number; m: number } | null>(null);
// locale switched (or first render): anchor on the selection or today in the current calendar
const view = computed(() => {
  if (viewState.value && viewState.value.cal === cal.value) return viewState.value;
  const init = sj.value ?? tj.value;
  return { cal: cal.value, y: init.y, m: init.m };
});
const open = ref(!!p.defaultOpen);
const focusState = ref<CalDay | null>(null);
const focusJ = computed(() => (focusState.value && focusState.value.cal === cal.value ? focusState.value : null));
const hmState = ref<HM>({ hh: p.defaultHour, mm: 0 });
const hm = computed<HM>(() => (valDate.value && p.withTime ? hmOf(valDate.value) : hmState.value));
const rootRef = ref<HTMLElement | null>(null);
const triggerRef = ref<HTMLButtonElement | null>(null);
const id = useUid('q-date', () => p.id);
const popId = computed(() => `${id.value}-pop`);

const first = computed(() => calDate(cal.value, view.value.y, view.value.m, 1));
const title = computed(() => monthTitle(first.value));
const rows = computed(() => {
  const lead = (first.value.getUTCDay() - weekStart.value + 7) % 7; // column of day 1
  const cells: (number | null)[] = [];
  for (let b = 0; b < lead; b++) cells.push(null);
  const n = monthLen(cal.value, view.value.y, view.value.m);
  for (let d = 1; d <= n; d++) cells.push(d);
  while (cells.length % 7) cells.push(null);
  const out: (number | null)[][] = [];
  for (let r = 0; r < cells.length; r += 7) out.push(cells.slice(r, r + 7));
  return out;
});
const fj = computed<CalDay>(() => {
  const v = view.value;
  const same = (j: CalDay | null) => !!j && j.y === v.y && j.m === v.m;
  if (same(focusJ.value)) return focusJ.value!;
  if (same(sj.value)) return sj.value!;
  if (same(tj.value)) return tj.value;
  return { cal: cal.value, y: v.y, m: v.m, d: 1 };
});

const isOff = (j: CalDay) => !!((minJ.value && jCmp(j, minJ.value) < 0) || (maxJ.value && jCmp(j, maxJ.value) > 0));
const dayOf = (d: number): CalDay => ({ cal: cal.value, y: view.value.y, m: view.value.m, d });
const isSel = (j: CalDay) => !!sj.value && jCmp(j, sj.value) === 0;
const isToday = (j: CalDay) => jCmp(j, tj.value) === 0;
const dayLabel = (j: CalDay) => longText(calDate(cal.value, j.y, j.m, j.d)) + (isToday(j) ? tr('، امروز', ', today') : '');

function set(v: string) {
  model.value = v;
  emit('change', v);
}
/** DS focuses the roving day after renders that moved it (open, arrows, PageUp/PageDown). */
function focusDay() {
  void nextTick(() => {
    const el = rootRef.value?.querySelector<HTMLElement>('.q-date-field__day[tabindex="0"]');
    el?.focus();
  });
}
function shiftMonth(d: number) {
  let m = view.value.m + d;
  let y = view.value.y;
  while (m < 1) { m += 12; y--; }
  while (m > 12) { m -= 12; y++; }
  viewState.value = { cal: cal.value, y, m };
}
function close(refocus: boolean) {
  open.value = false;
  if (refocus) triggerRef.value?.focus();
}
function pickDay(j: CalDay) {
  if (isOff(j)) return;
  set(isoOf(j, p.withTime ? hm.value : null));
  focusState.value = j;
  if (!p.withTime) close(true);
}
function setTime(next: HM) {
  hmState.value = next;
  const j = sj.value ?? focusJ.value;
  if (j) set(isoOf(j, next));
}
function openPop() {
  const j = sj.value ?? tj.value;
  viewState.value = { cal: cal.value, y: j.y, m: j.m };
  focusState.value = j;
  open.value = true;
  focusDay();
}
function moveFocus(j0: CalDay, delta: number) {
  const j = calOf(cal.value, new Date(calDate(cal.value, j0.y, j0.m, j0.d).getTime() + delta * DAY));
  focusState.value = j;
  if (j.y !== view.value.y || j.m !== view.value.m) viewState.value = { cal: cal.value, y: j.y, m: j.m };
  focusDay();
}
function onGridKey(e: KeyboardEvent, j: CalDay) {
  // Arrow keys follow the rendered direction (the consumer's dir), not the locale: ArrowRight = previous day in RTL.
  const dirCss = rootRef.value ? window.getComputedStyle(rootRef.value).direction : '';
  const rtl = dirCss ? dirCss === 'rtl' : isRtl();
  const map: Record<string, number> = { ArrowRight: rtl ? -1 : 1, ArrowLeft: rtl ? 1 : -1, ArrowDown: 7, ArrowUp: -7 };
  const delta = map[e.key];
  if (delta != null) { e.preventDefault(); moveFocus(j, delta); }
  else if (e.key === 'PageDown' || e.key === 'PageUp') { e.preventDefault(); shiftMonth(e.key === 'PageDown' ? 1 : -1); focusDay(); }
}
function onAnchorBlur(e: FocusEvent) {
  if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null)) open.value = false;
}
function onAnchorKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && open.value) { e.preventDefault(); close(true); }
}

const text = computed(() => (valDate.value ? longText(valDate.value) + (p.withTime ? tr('، ساعت ', ', ') + timeText(valDate.value) : '') : null));
const hours = Array.from({ length: 24 }, (_, i) => i);
const mins = computed(() => {
  const out: number[] = [];
  for (let mi = 0; mi < 60; mi += p.minuteStep || 5) out.push(mi);
  if (!out.includes(hm.value.mm)) out.push(hm.value.mm);
  return out.sort((a, c) => a - c);
});
const hintText = computed(() => (p.hint === undefined ? (p.withTime ? tr('زمان‌ها به وقت تهران', 'Times are in Tehran time') : undefined) : (p.hint ?? undefined)));
const pickLabel = computed(() => tr('انتخاب تاریخ', 'Choose a date'));
</script>

<template>
  <QFormField :id="id" :label="label" :hint="hintText" :error="error" :required="required" :disabled="disabled" class="q-date-field">
    <template v-if="$slots.label" #label><slot name="label" /></template>
    <template v-if="$slots.hint" #hint><slot name="hint" /></template>
    <template v-if="$slots.error" #error><slot name="error" /></template>
    <template #default="f">
      <div ref="rootRef" class="q-date-field__anchor" @focusout="onAnchorBlur" @keydown="onAnchorKey">
        <button
          :id="f.id"
          ref="triggerRef"
          type="button"
          :disabled="disabled"
          :class="['q-form-field__control', 'q-date-field__trigger', { 'q-form-field__control--invalid': f.invalid, 'q-form-field__control--disabled': disabled }]"
          aria-haspopup="dialog"
          :aria-expanded="open ? 'true' : 'false'"
          :aria-controls="popId"
          :aria-describedby="f.describedBy"
          :aria-invalid="f.invalid ? 'true' : undefined"
          @click="open ? (open = false) : openPop()"
        >
          <QIcon name="calendar" :size="20" class="q-date-field__icon" />
          <span :class="['q-date-field__value', { 'q-date-field__value--placeholder': !text }]">{{ text || placeholder || pickLabel }}</span>
          <QIcon name="chevron-down" :size="20" class="q-date-field__chevron" />
        </button>
        <div :id="popId" role="dialog" :aria-label="dialogLabel || pickLabel" :hidden="!open" class="q-date-field__pop">
          <div class="q-date-field__head">
            <!-- chevron-left/right with flip: points outward at the inline start/end in both directions. -->
            <button type="button" class="q-date-field__nav" :aria-label="tr('ماه قبل', 'Previous month')" @click="shiftMonth(-1)">
              <QIcon name="chevron-left" :size="20" flip />
            </button>
            <div class="q-date-field__title" aria-live="polite">{{ title }}</div>
            <button type="button" class="q-date-field__nav" :aria-label="tr('ماه بعد', 'Next month')" @click="shiftMonth(1)">
              <QIcon name="chevron-right" :size="20" flip />
            </button>
          </div>
          <table class="q-date-field__grid" role="grid" :aria-label="title">
            <thead>
              <tr>
                <th v-for="w in WEEK" :key="w[1]" scope="col" :abbr="w[1]" class="q-date-field__wd"><span aria-hidden="true">{{ w[0] }}</span><span class="q-sr">{{ w[1] }}</span></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, ri) in rows" :key="ri">
                <template v-for="(dn, ci) in row" :key="ci">
                  <td v-if="!dn" class="q-date-field__cell" />
                  <td v-else class="q-date-field__cell" role="gridcell" :aria-selected="isSel(dayOf(dn)) ? 'true' : undefined">
                    <button
                      type="button"
                      :tabindex="fj.d === dn ? 0 : -1"
                      :disabled="isOff(dayOf(dn))"
                      :class="['q-date-field__day', { 'q-date-field__day--selected': isSel(dayOf(dn)), 'q-date-field__day--today': isToday(dayOf(dn)) }]"
                      :aria-label="dayLabel(dayOf(dn))"
                      :aria-pressed="isSel(dayOf(dn)) ? 'true' : 'false'"
                      :aria-current="isToday(dayOf(dn)) ? 'date' : undefined"
                      @click="pickDay(dayOf(dn))"
                      @keydown="onGridKey($event, dayOf(dn))"
                    >{{ fa(dn) }}</button>
                  </td>
                </template>
              </tr>
            </tbody>
          </table>
          <div class="q-date-field__foot">
            <div v-if="withTime" class="q-date-field__time" dir="ltr">
              <label class="q-sr" :for="`${id}-hh`">{{ tr('ساعت', 'Hour') }}</label>
              <select :id="`${id}-hh`" class="q-date-field__time-select" :value="hm.hh" @change="setTime({ hh: +($event.target as HTMLSelectElement).value, mm: hm.mm })">
                <option v-for="x in hours" :key="x" :value="x">{{ fa(pad2(x)) }}</option>
              </select>
              <span class="q-date-field__colon" aria-hidden="true">:</span>
              <label class="q-sr" :for="`${id}-mm`">{{ tr('دقیقه', 'Minute') }}</label>
              <select :id="`${id}-mm`" class="q-date-field__time-select" :value="hm.mm" @change="setTime({ hh: hm.hh, mm: +($event.target as HTMLSelectElement).value })">
                <option v-for="x in mins" :key="x" :value="x">{{ fa(pad2(x)) }}</option>
              </select>
            </div>
            <span class="q-date-field__tz"><QIcon name="clock" :size="16" />{{ withTime ? tr('به وقت تهران', 'Tehran time') : tr('تقویم هجری شمسی', 'Gregorian calendar') }}</span>
            <QButton v-if="withTime" variant="green" size="md" class="q-date-field__done" @click="close(true)">{{ doneLabel || tr('تأیید', 'Done') }}</QButton>
          </div>
        </div>
      </div>
    </template>
  </QFormField>
</template>
