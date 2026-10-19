<script setup lang="ts">
import { computed, ref } from 'vue';
import { normalizeDigits } from '@esp/contracts';
import DigitInput from '../components/DigitInput.vue';
import FormField from '../components/FormField.vue';
import JalaliDate from '../components/JalaliDate.vue';
import MoneyLabel from '../components/MoneyLabel.vue';
import PageHeader from '../components/PageHeader.vue';
import { t } from '../i18n';
import { setDigits, setLocale, setTheme, settings, TIME_ZONE, type DigitsSetting, type ThemeSetting } from '../settings';
import { dateToIso, isIranMobile, isNonNegativeInt } from '../validators';
import type { Locale } from '@esp/contracts';

// ---- demo form: Persian and Latin digits are processed identically
const mobile = ref('');
const date = ref('');
const amount = ref('');

const mobileError = computed(() => (mobile.value && !isIranMobile(mobile.value) ? t('settings.mobileInvalid') : ''));
const dateIso = computed(() => dateToIso(date.value));
const dateError = computed(() => (date.value && !dateIso.value ? t('settings.dateInvalid') : ''));
const amountError = computed(() => (amount.value && !isNonNegativeInt(amount.value) ? t('settings.amountInvalid') : ''));
const amountNum = computed(() => (amount.value && isNonNegativeInt(amount.value) ? Number(normalizeDigits(amount.value)) : null));
</script>

<template>
  <PageHeader :title="t('settings.title')" />

  <section class="card stack form" aria-labelledby="disp-h">
    <h2 id="disp-h">{{ t('settings.display') }}</h2>
    <FormField id="s-locale" :label="t('ui.locale')">
      <template #default="{ id }">
        <select :id="id" class="input" :value="settings.locale" @change="setLocale(($event.target as HTMLSelectElement).value as Locale)">
          <option value="fa">{{ t('ui.locale.fa') }}</option>
          <option value="en">{{ t('ui.locale.en') }}</option>
        </select>
      </template>
    </FormField>
    <FormField id="s-theme" :label="t('ui.theme')">
      <template #default="{ id }">
        <select :id="id" class="input" :value="settings.theme" @change="setTheme(($event.target as HTMLSelectElement).value as ThemeSetting)">
          <option value="light">{{ t('ui.theme.light') }}</option>
          <option value="dark">{{ t('ui.theme.dark') }}</option>
          <option value="system">{{ t('ui.theme.system') }}</option>
        </select>
      </template>
    </FormField>
    <FormField id="s-digits" :label="t('ui.digits')">
      <template #default="{ id }">
        <select :id="id" class="input" :value="settings.digits" @change="setDigits(($event.target as HTMLSelectElement).value as DigitsSetting)">
          <option value="fa">{{ t('ui.digits.fa') }}</option>
          <option value="latn">{{ t('ui.digits.latn') }}</option>
        </select>
      </template>
    </FormField>
    <FormField id="s-tz" :label="t('ui.timeZone')">
      <template #default="{ id }">
        <input :id="id" class="input" :value="TIME_ZONE" readonly :aria-label="t('settings.tzValue')" dir="ltr" />
      </template>
    </FormField>
    <p class="muted">{{ t('settings.tzValue') }}</p>
  </section>

  <form class="card stack form demo" novalidate aria-labelledby="demo-h" @submit.prevent>
    <h2 id="demo-h">{{ t('settings.demo') }}</h2>
    <p class="muted">{{ t('settings.demoHint') }}</p>

    <FormField id="d-mobile" :label="t('settings.mobile')" :hint="t('settings.mobileHint')" :error="mobileError">
      <template #default="{ id, describedBy, invalid }">
        <DigitInput :id="id" v-model="mobile" inputmode="tel" :described-by="describedBy" :invalid="invalid" />
      </template>
    </FormField>
    <p v-if="mobile" class="muted">{{ t('settings.normalized') }}: <code>{{ normalizeDigits(mobile) }}</code></p>

    <FormField id="d-date" :label="t('settings.date')" :error="dateError" hint="2026-10-18 / ۲۰۲۶-۱۰-۱۸">
      <template #default="{ id, describedBy, invalid }">
        <DigitInput :id="id" v-model="date" inputmode="text" :described-by="describedBy" :invalid="invalid" />
      </template>
    </FormField>
    <p v-if="dateIso">{{ t('settings.dateShown') }}: <JalaliDate :iso="dateIso" format="date" /></p>

    <FormField id="d-amount" :label="t('settings.amount')" :error="amountError">
      <template #default="{ id, describedBy, invalid }">
        <DigitInput :id="id" v-model="amount" :described-by="describedBy" :invalid="invalid" />
      </template>
    </FormField>
    <p v-if="amountNum !== null">{{ t('settings.amountShown') }}: <MoneyLabel :rial="amountNum" /></p>
  </form>
</template>

<style scoped>
.form { max-inline-size: 34rem; margin-block-end: var(--sp-5); }
</style>
