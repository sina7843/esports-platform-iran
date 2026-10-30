<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import {
  QActionBar, QAlert, QButton, QCard, QCheckbox, QContainer, QDataState, QEmptyState, QFacts, QPageHeader, QSegmentedControl, QSelect,
  QSkeleton, QSwitch, fa, formatJalali, num, toman, useToast,
} from '@esp/ui';
import { esp06, type NotificationPrefs } from '../api/esp06';
import { toClientError } from '../errors';
import { t, type MessageKey } from '../i18n';
import { session } from '../session';
import { setDigits, setLocale, setLowData, setTheme, settings, type DigitsSetting, type ThemeSetting } from '../settings';
import { useDataState } from '../useDataState';
import { useLoad } from '../useLoad';
import type { Locale } from '@esp/contracts';

/** Spec docs/redesign/03-specs/settings.md — display preferences apply live; notification preferences save to the account. */
const { push } = useToast();
const signedIn = computed(() => !!session.me);
const narrow = ref(typeof window !== 'undefined' && window.innerWidth < 640);

const CATS = ['registration', 'payment', 'invitation', 'checkin', 'match', 'schedule', 'result', 'decision', 'honor', 'follow.start', 'follow.end', 'follow.time'];
const ESSENTIAL = ['payment', 'checkin', 'result', 'decision'];

type Form = { sms: boolean; email: boolean; quiet: boolean; from: string; to: string; promotional: boolean; digest: boolean; categories: Record<string, boolean> };
const toForm = (p: NotificationPrefs): Form => ({
  sms: p.channels.sms, email: p.channels.email, quiet: !!p.quietHours, from: p.quietHours?.from ?? '23', to: p.quietHours?.to ?? '07',
  promotional: p.promotional, digest: p.digestFrequent, categories: { ...p.categories },
});
const { data, loading, error, load } = useLoad(() => (session.me ? esp06.prefs() : Promise.resolve(null)));
watch(() => session.me?.principal.id, () => void load());
const ds = useDataState({ loading, error });
const form = ref<Form | null>(null);
const saved = ref('');
watch(data, (p) => {
  form.value = p ? toForm(p) : null;
  saved.value = JSON.stringify(form.value);
});
const dirty = computed(() => !!form.value && JSON.stringify(form.value) !== saved.value);
const status = ref<'saving' | 'saved' | 'error' | null>(null);
watch(dirty, (d) => { if (d && status.value === 'saved') status.value = null; });

async function save() {
  const f = form.value;
  if (!f) return;
  status.value = 'saving';
  try {
    const p = await esp06.savePrefs({
      channels: { sms: f.sms, email: f.email, push: false }, quietHours: f.quiet ? { from: f.from, to: f.to } : null,
      promotional: f.promotional, digestFrequent: f.digest, categories: f.categories,
    });
    form.value = toForm(p);
    saved.value = JSON.stringify(form.value);
    status.value = 'saved';
    push({ tone: 'success', message: t('st.saved'), duration: 4000 });
  } catch (e) {
    status.value = 'error';
    push({ tone: 'danger', message: toClientError(e).message });
  }
}
function discard() {
  form.value = saved.value ? (JSON.parse(saved.value) as Form) : null;
  status.value = null;
}

const latin = computed(() => settings.locale === 'en' || settings.digits === 'latn');
const hours = computed(() => Array.from({ length: 24 }, (_, i) => {
  const hh = String(i).padStart(2, '0');
  return { value: hh, label: fa(`${hh}:00`) };
}));
const themeOptions = computed(() => [
  { value: 'dark', label: t('st.dark'), icon: 'moon' as const },
  { value: 'light', label: t('st.light'), icon: 'sun' as const },
  { value: 'system', label: t('st.system'), icon: 'monitor' as const },
]);
const now = new Date().toISOString();
const preview = computed(() => [
  { label: t('st.pDate'), value: formatJalali(now, 'date') },
  { label: t('st.pTime'), value: formatJalali(now, 'time') },
  { label: t('st.pAmount'), value: toman(15000000) },
  { label: t('st.pRating'), value: num(1840) },
]);
const cat = (c: string) => t(`ntf.cat.${c}` as MessageKey);
</script>

<template>
  <QContainer>
    <div class="k-stack p-settings">
      <QPageHeader compact :title="t('st.title')" :description="t('st.desc')" />
      <QAlert v-if="!signedIn" tone="info" :title="t('st.guestTitle')">{{ t('st.guestBody') }}</QAlert>
      <div class="p-settings-layout">
        <div class="p-settings-main">
          <QCard padding="lg" aria-labelledby="set-disp-h">
            <h2 id="set-disp-h" class="p-settings-h">{{ t('st.display') }}</h2>
            <p class="p-settings-d">{{ t('st.displayD') }}</p>
            <div class="p-settings-rows">
              <div class="p-settings-row">
                <div class="p-settings-row__label"><strong>{{ t('st.lang') }}</strong><span>{{ t('st.langD') }}</span></div>
                <div class="p-settings-row__ctl">
                  <QSegmentedControl :block="narrow" :aria-label="t('st.lang')" :model-value="settings.locale" :options="[{ value: 'fa', label: 'فارسی' }, { value: 'en', label: 'English' }]" @update:model-value="(v) => v && setLocale(v as Locale)" />
                </div>
              </div>
              <div class="p-settings-row">
                <div class="p-settings-row__label"><strong>{{ t('st.theme') }}</strong><span>{{ t('st.themeD') }}</span></div>
                <div class="p-settings-row__ctl">
                  <QSelect v-if="narrow" :label="t('st.theme')" hide-label :model-value="settings.theme" :options="themeOptions" @update:model-value="(v) => v && setTheme(v as ThemeSetting)" />
                  <QSegmentedControl v-else :aria-label="t('st.theme')" :model-value="settings.theme" :options="themeOptions" @update:model-value="(v) => v && setTheme(v as ThemeSetting)" />
                </div>
              </div>
              <div class="p-settings-row">
                <div class="p-settings-row__label"><strong>{{ t('st.digits') }}</strong><span>{{ settings.locale === 'en' ? t('st.digitsEn') : t('st.digitsFa') }}</span></div>
                <div class="p-settings-row__ctl">
                  <QSegmentedControl
                    :block="narrow" :aria-label="t('st.digits')" :model-value="latin ? 'latn' : 'fa'"
                    :options="[{ value: 'fa', label: t('st.digitsPersian', { sample: '۱۲۳' }), disabled: settings.locale === 'en' }, { value: 'latn', label: t('st.digitsLatin', { sample: '123' }) }]"
                    @update:model-value="(v) => v && setDigits(v as DigitsSetting)"
                  />
                </div>
              </div>
              <div class="p-settings-row">
                <div class="p-settings-row__label"><strong>{{ t('st.tz') }}</strong><span>{{ t('st.tzD') }}</span></div>
                <!-- OPEN-QUESTION(settings): a per-user time zone has no setting in the API yet; Tehran is shown as the fixed zone. -->
                <div class="p-settings-row__ctl"><bdi>{{ t('st.tzValue') }}</bdi></div>
              </div>
              <div class="p-settings-row p-settings-row--switch">
                <QSwitch block :label="t('st.low')" :description="t('st.lowD')" :model-value="settings.lowData" @update:model-value="(v) => setLowData(!!v)" />
              </div>
            </div>
          </QCard>

          <QCard padding="lg" aria-labelledby="set-ntf-h">
            <div id="set-ntf" class="k-stack p-settings-ntf">
              <div>
                <h2 id="set-ntf-h" class="p-settings-h">{{ t('st.ntf') }}</h2>
                <p class="p-settings-d">{{ t('st.ntfD') }}</p>
              </div>
              <QEmptyState v-if="!signedIn" compact icon="lock" :title="t('st.ntfSignIn')" :body="t('st.ntfSignInD')">
                <template #action><QButton variant="secondary" icon="user" href="/login?redirect=/account/settings">{{ t('st.signIn') }}</QButton></template>
              </QEmptyState>
              <QSkeleton v-else-if="ds.state.value === 'loading' && !form" variant="line" :lines="8" />
              <QDataState v-else-if="ds.state.value !== 'content' && ds.state.value !== 'loading'" v-bind="ds.props.value" @retry="load" />
              <div v-else-if="form" class="k-stack p-settings-ntf">
                <QAlert tone="info">{{ t('st.essential') }}</QAlert>
                <div class="k-stack">
                  <h3 class="p-settings-sub">{{ t('st.channels') }}</h3>
                  <div class="p-settings-switches">
                    <QSwitch block :label="t('st.inApp')" :description="t('st.inAppD')" :model-value="true" disabled />
                    <QSwitch v-model="form.sms" block :label="t('st.sms')" />
                    <QSwitch v-model="form.email" block :label="t('st.email')" />
                    <QSwitch block :label="t('st.push')" :description="t('st.pushD')" :model-value="false" disabled />
                  </div>
                </div>
                <div class="k-stack">
                  <QSwitch v-model="form.quiet" block :label="t('st.quiet')" :description="t('st.quietD')" />
                  <div v-if="form.quiet" class="p-settings-quiet">
                    <QSelect v-model="form.from" :label="t('st.from')" :options="hours" />
                    <QSelect v-model="form.to" :label="t('st.to')" :options="hours" />
                  </div>
                </div>
                <fieldset class="p-settings-cats">
                  <legend>{{ t('st.cats') }}</legend>
                  <QCheckbox
                    v-for="c in CATS" :key="c" :label="cat(c)" :description="ESSENTIAL.includes(c) ? t('st.catEssential') : undefined"
                    :model-value="form.categories[c] !== false" @update:model-value="(v) => form && (form.categories[c] = !!v)"
                  />
                </fieldset>
                <div class="p-settings-switches">
                  <QSwitch v-model="form.digest" block :label="t('st.digest')" :description="t('st.digestD')" />
                  <QSwitch v-model="form.promotional" block :label="t('st.promo')" :description="t('st.promoD')" />
                </div>
              </div>
            </div>
          </QCard>
          <div class="p-settings-pad" aria-hidden="true" />
        </div>
        <aside class="p-settings-aside" :aria-label="t('st.preview')">
          <QCard>
            <div class="p-settings-preview">
              <h2 class="h4 p-settings-ph">{{ t('st.preview') }}</h2>
              <QFacts :columns="2" dense :items="preview" />
              <p class="p-settings-d">{{ t('st.pNote') }}</p>
            </div>
          </QCard>
        </aside>
      </div>
    </div>
    <QActionBar
      v-if="signedIn && (dirty || status)"
      :status="status === 'saving' ? 'saving' : status === 'error' ? 'error' : status === 'saved' && !dirty ? 'saved' : 'dirty'"
      :message="status === 'saving' ? t('st.saving') : status === 'saved' && !dirty ? t('st.saved') : t('st.dirty')"
      :saving="status === 'saving'" :save-disabled="!dirty" :save-label="t('st.save')" :cancel-label="t('st.discard')" :aria-label="t('st.saveBar')"
      @save="save" @cancel="discard"
    />
  </QContainer>
</template>

<style scoped>
.p-settings { gap: var(--space-6); }
.p-settings-ntf { gap: var(--space-6); }
.p-settings-layout { display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: var(--space-6); align-items: start; }
.p-settings-main { display: flex; flex-direction: column; gap: var(--space-6); min-width: 0; }
.p-settings-aside { position: sticky; inset-block-start: var(--space-5); display: flex; flex-direction: column; gap: var(--space-4); min-width: 0; }
.p-settings-h { margin: 0; font-size: 18px; line-height: 28px; font-weight: 900; }
.p-settings-ph { margin: 0; }
.p-settings-d { margin: 0; font-size: 14px; line-height: 24px; color: var(--ink-muted); }
.p-settings-rows { display: flex; flex-direction: column; }
.p-settings-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: var(--space-3) var(--space-5); align-items: center; padding-block: var(--space-4); border-block-end: 1px solid var(--line); }
.p-settings-row:last-child { border-block-end: 0; padding-block-end: 0; }
.p-settings-row--switch { grid-template-columns: minmax(0, 1fr); }
.p-settings-row:first-child { padding-block-start: var(--space-2); }
.p-settings-row__label { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.p-settings-row__label strong { font-size: 15px; }
.p-settings-row__label span { font-size: 13px; line-height: 22px; color: var(--ink-subtle); }
.p-settings-row__ctl { min-width: 0; justify-self: end; }
.p-settings-row__ctl :deep(.q-select) { min-inline-size: 240px; }
.p-settings-switches { display: flex; flex-direction: column; gap: var(--space-4); }
.p-settings-cats { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-3) var(--space-5); margin: 0; padding: 0; border: 0; }
.p-settings-cats legend { padding: 0; margin-block-end: var(--space-3); font-weight: 800; }
.p-settings-quiet { display: grid; grid-template-columns: repeat(2, minmax(0, 160px)); gap: var(--space-4); }
.p-settings-preview { display: flex; flex-direction: column; gap: var(--space-4); }
.p-settings-sub { margin: 0; font-size: 15px; font-weight: 800; }
.p-settings-pad { block-size: var(--space-10); }
@media (max-width: 1100px) {
  .p-settings-layout { grid-template-columns: minmax(0, 1fr); }
  .p-settings-aside { position: static; }
}
@media (max-width: 640px) {
  .p-settings-row { grid-template-columns: minmax(0, 1fr); }
  .p-settings-row__ctl { justify-self: stretch; }
  .p-settings-row__ctl :deep(.q-select) { min-inline-size: 0; }
  .p-settings-cats { grid-template-columns: minmax(0, 1fr); }
  .p-settings-quiet { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
</style>
