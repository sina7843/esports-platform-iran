<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { normalizeIranMobile } from '@esp/contracts';
import { QAlert, QButton, QCard, QCode, QIcon, QLogo, QOtpInput, QTextField, QTricolor, fa, isRtl } from '@esp/ui';
import { api, type ApiClientError } from '../api/client';
import { esp02 } from '../api/esp02';
import { errorText, toClientError } from '../errors';
import { t } from '../i18n';
import { setMe } from '../session';
import { safeRedirect } from '../validators';

/**
 * Spec docs/redesign/03-specs/login.md — USR-001: Iranian mobile + one-time code. Persian, Arabic-Indic and Latin digits
 * normalise to the same number; the request answer is identical for known and unknown numbers (no enumeration).
 */
const route = useRoute();
const router = useRouter();
const redirect = computed(() => typeof route.query.redirect === 'string' && !!route.query.redirect);
const CODE_LENGTH = 6;
// Dev sign-in: dev builds, or a private-trial build with VITE_DEV_LOGIN=true (the server still refuses it unless AUTH_DEV_LOGIN_ENABLED).
const devLogin = import.meta.env.DEV || import.meta.env.VITE_DEV_LOGIN === 'true';
const principalId = ref('');
const devCode = ref('');
const devTouched = ref(false);
const devError = ref<ApiClientError | null>(null);
async function devSubmit() {
  devTouched.value = true;
  if (!principalId.value.trim() || !devCode.value) return;
  busy.value = true;
  devError.value = null;
  try {
    setMe(await api.devSession(principalId.value.trim(), devCode.value));
    await router.replace(safeRedirect(route.query.redirect));
  } catch (e) {
    devError.value = toClientError(e);
  } finally {
    busy.value = false;
  }
}

const phone = ref('');
const touched = ref(false);
const step = ref<'phone' | 'code'>('phone');
const code = ref('');
const busy = ref(false);
const done = ref(false);
const resendIn = ref(60);
const sendError = ref<ApiClientError | null>(null);
const codeError = ref<'wrong' | 'locked' | null>(null);

const norm = computed(() => normalizeIranMobile(phone.value));
const phoneErr = computed(() => (touched.value && !norm.value ? (phone.value.trim() ? t('lg.phoneInvalid') : t('lg.phoneEmpty')) : undefined));
const offline = computed(() => sendError.value?.code === 'NETWORK');
const serviceDown = computed(() => ['PROVIDER_UNAVAILABLE', 'PROVIDER_NOT_CONFIGURED', 'INTERNAL', 'UNKNOWN'].includes(sendError.value?.code ?? ''));
const otherError = computed(() => (sendError.value && !offline.value && !serviceDown.value ? errorText(sendError.value.code) : ''));
const local = computed(() => {
  const n = `0${(norm.value ?? '').slice(3)}`;
  return fa(`${n.slice(0, 4)} ${n.slice(4, 7)} ${n.slice(7)}`);
});

async function send() {
  touched.value = true;
  if (!norm.value) return;
  busy.value = true;
  sendError.value = null;
  try {
    const r = await esp02.otpRequest(norm.value);
    resendIn.value = r.resendAfterSeconds;
    step.value = 'code';
    code.value = '';
    codeError.value = null;
  } catch (e) {
    sendError.value = toClientError(e);
  } finally {
    busy.value = false;
  }
}

async function verify(value?: string) {
  const v = value ?? code.value;
  if (!norm.value || v.length < CODE_LENGTH || codeError.value === 'locked') return;
  busy.value = true;
  try {
    await esp02.otpVerify(norm.value, v);
    done.value = true;
    setMe(await api.me());
    await router.replace(safeRedirect(route.query.redirect)); // UX-007: back to the deep link
  } catch (e) {
    const err = toClientError(e);
    codeError.value = err.code === 'RATE_LIMITED' ? 'locked' : 'wrong';
    if (err.code === 'NETWORK') { sendError.value = err; step.value = 'phone'; }
  } finally {
    busy.value = false;
  }
}

function changeNumber() {
  step.value = 'phone';
  codeError.value = null;
  code.value = '';
}
function onCode(v: string | undefined) {
  code.value = v ?? '';
  if (codeError.value === 'wrong') codeError.value = null;
}
</script>

<template>
  <div class="p-login-wrap">
    <aside class="p-login-brand" :aria-label="t('lg.about')">
      <span class="p-login-eyebrow"><QTricolor />{{ t('lg.eyebrow') }}</span>
      <h2 class="p-login-title">{{ t('lg.title1') }}<em>{{ t('lg.title2') }}</em>{{ t('lg.title3') }}</h2>
      <p class="p-login-lead">{{ t('lg.lead') }}</p>
      <ul class="p-login-trust">
        <li><QIcon name="shield" :size="18" />{{ t('lg.trust1') }}</li>
        <li><QIcon name="file" :size="18" />{{ t('lg.trust2') }}</li>
        <li><QIcon name="award" :size="18" />{{ t('lg.trust3') }}</li>
      </ul>
      <div><QButton variant="ghost" href="/events" :icon-end="isRtl() ? 'arrow-left' : 'arrow-right'">{{ t('lg.browse') }}</QButton></div>
      <span class="p-login-mark" aria-hidden="true">ARENA</span>
    </aside>
    <div class="p-login-side">
      <div class="p-login-card">
        <QCard padding="lg" chamfer>
          <div class="p-login-form">
            <div class="k-stack p-login-head">
              <div class="p-login-logo"><QLogo :size="44" alt="" /><QTricolor /></div>
              <h1 class="p-login-h1">{{ step === 'phone' ? t('lg.h1Phone') : t('lg.h1Code') }}</h1>
              <p class="p-login-sub">{{ step === 'phone' ? t('lg.subPhone') : t('lg.subCode') }}</p>
            </div>
            <QAlert v-if="redirect" tone="info" icon="lock">{{ t('lg.redirect') }}</QAlert>
            <QAlert v-if="serviceDown" tone="danger" :title="t('lg.downTitle')">
              {{ t('lg.downBody') }}
              <div v-if="sendError?.requestId" class="p-login-rid"><QCode copy :label="t('lg.requestId')" :copy-label="t('lg.copy')">{{ sendError.requestId }}</QCode></div>
            </QAlert>
            <QAlert v-if="otherError" tone="danger">{{ otherError }}</QAlert>
            <QAlert v-if="offline" tone="warning" icon="wifi-off" :title="t('lg.offTitle')">{{ t('lg.offBody') }}</QAlert>

            <form v-if="step === 'phone'" class="p-login-form" novalidate @submit.prevent="send">
              <QTextField
                id="otp-phone" v-model="phone" :label="t('lg.phone')" required type="tel" input-mode="tel" auto-complete="tel" ltr prefix-icon="user"
                :placeholder="fa('0912 345 6789')" :error="phoneErr" :hint="t('lg.phoneHint', { sample: fa('09123456789') })"
              />
              <QButton type="submit" variant="primary" size="lg" block chamfer :loading="busy" :icon-end="isRtl() ? 'arrow-left' : 'arrow-right'">{{ t('lg.send') }}</QButton>
              <p class="p-login-terms">
                {{ t('lg.terms1') }}<RouterLink to="/legal/terms">{{ t('lg.terms') }}</RouterLink>{{ t('lg.and') }}<RouterLink to="/legal/privacy">{{ t('lg.privacy') }}</RouterLink>{{ t('lg.terms2') }}
              </p>
            </form>

            <QAlert v-else-if="done" tone="success" :title="t('lg.welcome')">{{ redirect ? t('lg.back') : t('lg.toAccount') }}</QAlert>

            <form v-else class="p-login-form" novalidate @submit.prevent="verify()">
              <div class="p-login-sent" role="status">
                <span>{{ t('lg.sent1') }}<bdi dir="ltr">{{ local }}</bdi>{{ t('lg.sent2') }}</span>
                <QButton variant="ghost" size="sm" icon="edit" @click="changeNumber">{{ t('lg.change') }}</QButton>
              </div>
              <QAlert v-if="codeError === 'locked'" tone="danger" :title="t('lg.lockedTitle')">{{ t('lg.lockedBody') }}</QAlert>
              <QOtpInput
                :model-value="code" :length="CODE_LENGTH" :label="t('lg.code')" required :disabled="codeError === 'locked' || busy"
                :error="codeError === 'wrong' ? t('lg.codeWrong') : codeError === 'locked' ? t('lg.codeLocked') : undefined"
                :resend-in="resendIn" :resend-text="t('lg.resendIn')" :resend-label="t('lg.resend')" :hint="t('lg.codeHint')"
                @update:model-value="onCode" @complete="verify" @resend="send"
              />
              <QButton type="submit" variant="primary" size="lg" block chamfer :loading="busy" :disabled="codeError === 'locked' || code.length < CODE_LENGTH">{{ t('lg.signIn') }}</QButton>
            </form>
          </div>
        </QCard>
        <details v-if="devLogin" class="p-login-dev">
          <summary>{{ t('otp.devToggle') }}</summary>
          <form class="p-login-form" novalidate @submit.prevent="devSubmit">
            <QAlert tone="warning">{{ t('login.devNotice') }}</QAlert>
            <QTextField id="dev-principal" v-model="principalId" :label="t('login.principalId')" :hint="t('login.principalHint')" ltr auto-complete="username" required :error="devTouched && !principalId.trim() ? t('common.required') : undefined" />
            <QTextField id="dev-code" v-model="devCode" :label="t('login.devCode')" type="password" ltr auto-complete="current-password" required :error="devTouched && !devCode ? t('common.required') : undefined" />
            <QAlert v-if="devError" tone="danger">{{ devError.message }}</QAlert>
            <QButton type="submit" variant="secondary" block :loading="busy">{{ t('login.submit') }}</QButton>
          </form>
        </details>
      </div>
    </div>
  </div>
</template>

<style scoped>
:global(.k-shell--login .k-main) { padding-block: 0; }
.p-login-wrap { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr); min-height: calc(100vh - var(--topbar-height)); }
/* brand column: hairline arena grid, stripes, outlined wordmark */
.p-login-brand { position: relative; overflow: hidden; display: flex; flex-direction: column; justify-content: center; gap: var(--space-6); padding: var(--space-10) var(--space-9);
  background-color: var(--surface); border-inline-end: 1px solid var(--line);
  background-image: linear-gradient(var(--line) 1px, transparent 1px), linear-gradient(90deg, var(--line) 1px, transparent 1px); background-size: 56px 56px; }
.p-login-brand::after { content: ''; position: absolute; inset: 0; pointer-events: none; background: linear-gradient(to top, var(--surface) 10%, transparent 70%); }
.p-login-brand > * { position: relative; z-index: 1; }
.p-login-eyebrow { display: inline-flex; align-items: center; gap: var(--space-2); font-size: 14px; font-weight: 700; color: var(--green-text); }
.p-login-title { margin: 0; font-size: 52px; line-height: 68px; font-weight: 900; text-wrap: balance; }
.p-login-title em { font-style: normal; color: var(--green-text); }
.p-login-lead { margin: 0; font-size: 17px; line-height: 30px; color: var(--ink-muted); max-width: 46ch; }
.p-login-trust { display: flex; flex-direction: column; gap: var(--space-3); margin: 0; padding: 0; list-style: none; font-size: 14px; color: var(--ink-muted); }
.p-login-trust li { display: flex; align-items: center; gap: var(--space-3); }
.p-login-trust .q-icon { color: var(--green-text); }
.p-login-mark { position: absolute; inset-block-end: var(--space-7); inset-inline-end: calc(-1 * var(--space-6)); font-size: 120px; line-height: 1; font-weight: 900; color: transparent; -webkit-text-stroke: 1.5px var(--line-strong); white-space: nowrap; direction: ltr; z-index: 0; pointer-events: none; }
/* form column */
.p-login-side { display: flex; align-items: center; justify-content: center; padding: var(--space-9) var(--space-7); background: var(--bg); }
.p-login-card { inline-size: 100%; max-inline-size: 460px; }
.p-login-form { display: flex; flex-direction: column; gap: var(--space-5); }
.p-login-head { gap: var(--space-2); }
.p-login-logo { display: flex; align-items: center; gap: var(--space-3); }
.p-login-h1 { margin: 0; font-size: 28px; line-height: 40px; font-weight: 900; }
.p-login-sub { margin: 0; color: var(--ink-muted); font-size: 15px; line-height: 26px; }
.p-login-sent { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); flex-wrap: wrap; padding: var(--space-3) var(--space-4); border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--surface-sunken); font-size: 14px; }
.p-login-sent bdi { font-weight: 800; }
.p-login-dev { margin-block-start: var(--space-5); color: var(--ink-muted); font-size: 14px; }
.p-login-dev summary { cursor: pointer; min-block-size: 44px; display: flex; align-items: center; }
.p-login-rid { margin-block-start: var(--space-2); }
.p-login-terms { margin: 0; font-size: 13px; line-height: 22px; color: var(--ink-subtle); }
.p-login-terms a { color: var(--green-text); font-weight: 700; }
@media (max-width: 900px) {
  .p-login-wrap { grid-template-columns: minmax(0, 1fr); min-height: 0; }
  .p-login-side { order: -1; padding: var(--space-7) var(--space-4); }
  .p-login-brand { padding: var(--space-8) var(--space-4); border-inline-end: 0; border-block-start: 1px solid var(--line); }
  .p-login-title { font-size: 34px; line-height: 50px; }
  .p-login-mark { font-size: 72px; }
}
</style>
