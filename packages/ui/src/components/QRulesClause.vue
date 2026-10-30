<script setup lang="ts">
import { computed, nextTick, useId } from 'vue';
import { tr } from '../locale';
import { CLAUSE_KIND, dotted, fmtDate, stateBadge } from '../maps/people';
import { usePeopleBool } from '../composables/people-bool';
import QBadge from './QBadge.vue';
import QIcon from './QIcon.vue';

/**
 * One numbered rules clause: «بند ۴٫۲», LTR reference anchor, version, kind, amendment note and acceptance.
 * `v-model:accepted` (or `accepted` + `@accept-change`); `defaultAccepted` when uncontrolled. Slots: default (wins), body.
 */
export interface QRulesClauseProps {
  number: string;
  anchor?: (string) | undefined;
  title: string;
  body?: (string) | undefined;
  kind?: ('mandatory' | 'configurable' | 'human_review') | undefined;
  version?: (string) | undefined;
  citation?: (string) | undefined;
  amended?: ({ version?: string; note?: string }) | undefined;
  requireAcceptance?: (boolean) | undefined;
  accepted?: boolean | undefined;
  defaultAccepted?: (boolean) | undefined;
  acceptedAt?: (string) | undefined;
  acceptLocked?: (boolean) | undefined;
}
const p = withDefaults(defineProps<QRulesClauseProps>(), { accepted: undefined });
const emit = defineEmits<{ 'update:accepted': [accepted: boolean]; acceptChange: [accepted: boolean] }>();
const { value: acc, set } = usePeopleBool(() => p.accepted, () => p.defaultAccepted, (v) => { emit('update:accepted', v); emit('acceptChange', v); });
const cid = useId();
const hid = useId();
/** Controlled like React: if the parent keeps `accepted`, the native box snaps back to it. */
function onChange(e: Event) {
  const el = e.target as HTMLInputElement;
  set(el.checked);
  void nextTick(() => { el.checked = acc.value; });
}
const kb = computed(() => (p.kind ? stateBadge(CLAUSE_KIND, p.kind) : null));
</script>

<template>
  <article :id="anchor || undefined" :class="['q-rules-clause', { 'q-rules-clause--amended': amended }]" :aria-labelledby="hid">
    <div class="q-rules-clause__head">
      <span class="q-rules-clause__num">{{ tr('بند ', 'Clause ') + dotted(number) }}</span>
      <a v-if="anchor" class="q-rules-clause__anchor q-ltr" :href="'#' + anchor" :aria-label="tr('پیوند به بند ', 'Link to clause ') + dotted(number)">#{{ anchor }}</a>
      <QBadge v-if="kb" v-bind="kb.props">{{ kb.label }}</QBadge>
      <span v-if="version" class="q-rules-clause__version-wrap"><span class="q-rules-clause__version q-ltr">{{ version }}</span></span>
    </div>
    <h3 :id="hid" class="q-rules-clause__title">{{ title }}</h3>
    <p class="q-rules-clause__body"><slot><slot name="body">{{ body }}</slot></slot></p>
    <p v-if="citation" class="q-rules-clause__cite">{{ tr('مرجع بند: ', 'Citation: ') }}<span class="q-ltr">{{ citation }}</span></p>
    <p v-if="amended" class="q-rules-clause__amend" role="note">
      <QIcon name="edit" :size="16" />
      <span><strong>{{ tr('اصلاح‌شده', 'Amended') }}</strong><template v-if="amended.version">{{ tr(' در ', ' in ') }}<span class="q-ltr">{{ amended.version }}</span></template>{{ amended.note ? tr('؛ ', '; ') : '' }}<bdi v-if="amended.note">{{ amended.note }}</bdi></span>
    </p>
    <div v-if="requireAcceptance" :class="['q-rules-clause__accept', { 'q-rules-clause__accept--on': acc }]">
      <input :id="cid" type="checkbox" :checked="acc" :disabled="acceptLocked" @change="onChange" />
      <label :for="cid">{{ acc ? tr('پذیرفتم', 'Accepted') : tr('این بند را خواندم و می‌پذیرم', 'I have read and accept this clause') }}</label>
      <span v-if="acc && acceptedAt" class="q-rules-clause__accepted-at"><time :datetime="acceptedAt">{{ fmtDate(acceptedAt, 'datetime') }}</time></span>
    </div>
  </article>
</template>
