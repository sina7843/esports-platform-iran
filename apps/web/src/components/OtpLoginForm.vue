<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import { normalizeIranMobile } from '@esp/contracts';
import type { ApiClientError } from '../api/client';
import { esp02 } from '../api/esp02';
import { toClientError } from '../errors';
import { num, t } from '../i18n';
import DigitInput from './DigitInput.vue';
import ErrorNote from './ErrorNote.vue';
import FormField from './FormField.vue';

/** USR-001: Iranian mobile + one-time code. Persian and Latin digits normalize to the same number. */
const emit = defineEmits<{ done: [] }>();
const phone = ref('');
const code = ref('');
const step = ref<'phone' | 'code'>('phone');
const message = ref('');
const busy = ref(false);
const touched = ref(false);
const failure = ref<ApiClientError | null>(null);
const wait = ref(0);
let timer: ReturnType<typeof setInterval> | null = null;

const normalized = computed(() => normalizeIranMobile(phone.value));
const phoneError = computed(() => (touched.value && !normalized.value ? t('otp.phoneInvalid') : ''));

function countdown(seconds: number) {
  wait.value = seconds;
  if (timer) clearInterval(timer);
  timer = setInterval(() => {
    wait.value = Math.max(0, wait.value - 1);
    if (wait.value === 0 && timer) clearInterval(timer);
  }, 1000);
}
onBeforeUnmount(() => timer && clearInterval(timer));

async function send() {
  touched.value = true;
  if (!normalized.value) return;
  busy.value = true;
  failure.value = null;
  try {
    const r = await esp02.otpRequest(normalized.value);
    message.value = r.message; // identical for known and unknown numbers (no enumeration)
    step.value = 'code';
    countdown(r.resendAfterSeconds);
  } catch (e) {
    failure.value = toClientError(e);
  } finally {
    busy.value = false;
  }
}

async function verify() {
  if (!normalized.value || code.value.length < 4) return;
  busy.value = true;
  failure.value = null;
  try {
    await esp02.otpVerify(normalized.value, code.value);
    emit('done');
  } catch (e) {
    failure.value = toClientError(e);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <form v-if="step === 'phone'" class="stack" novalidate @submit.prevent="send">
    <FormField id="otp-phone" :label="t('otp.phone')" :hint="t('otp.phoneHint')" :error="phoneError" required>
      <template #default="{ id, describedBy, invalid }">
        <DigitInput :id="id" v-model="phone" inputmode="tel" :described-by="describedBy" :invalid="invalid" />
      </template>
    </FormField>
    <ErrorNote :error="failure" />
    <button type="submit" class="btn btn-primary" :disabled="busy">{{ t('otp.send') }}</button>
  </form>
  <form v-else class="stack" novalidate @submit.prevent="verify">
    <p class="notice" role="status">{{ message }}</p>
    <FormField id="otp-code" :label="t('otp.code')" required>
      <template #default="{ id, describedBy, invalid }">
        <DigitInput :id="id" v-model="code" inputmode="numeric" :described-by="describedBy" :invalid="invalid" />
      </template>
    </FormField>
    <ErrorNote :error="failure" />
    <div class="row">
      <button type="submit" class="btn btn-primary" :disabled="busy">{{ t('otp.verify') }}</button>
      <button type="button" class="btn" :disabled="wait > 0 || busy" @click="send">{{ wait > 0 ? t('otp.resendIn', { s: num(wait) }) : t('otp.send') }}</button>
      <button type="button" class="btn" @click="step = 'phone'; code = ''">{{ t('otp.changePhone') }}</button>
    </div>
  </form>
</template>
