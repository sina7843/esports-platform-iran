<script setup lang="ts">
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, type ApiClientError } from '../api/client';
import ErrorNote from '../components/ErrorNote.vue';
import FormField from '../components/FormField.vue';
import OtpLoginForm from '../components/OtpLoginForm.vue';
import Icon from '../components/Icon.vue';
import PageHeader from '../components/PageHeader.vue';
import { toClientError } from '../errors';
import { t } from '../i18n';
import { setMe } from '../session';
import { safeRedirect } from '../validators';

const route = useRoute();
const router = useRouter();
const seeds = ['usr_seed_admin', 'usr_seed_organizer', 'usr_seed_referee', 'usr_seed_captain', 'usr_seed_player', 'usr_seed_reporter', 'usr_seed_finance', 'usr_seed_finance_2'];

const principalId = ref('');
const devCode = ref('');
const busy = ref(false);
const failure = ref<ApiClientError | null>(null);
const touched = ref(false);

async function afterOtp() {
  setMe(await api.me());
  await router.replace(safeRedirect(route.query.redirect)); // UX-007
}

async function submit() {
  touched.value = true;
  if (!principalId.value.trim() || !devCode.value) return;
  busy.value = true;
  failure.value = null;
  try {
    setMe(await api.devSession(principalId.value.trim(), devCode.value));
    await router.replace(safeRedirect(route.query.redirect)); // UX-007: return to the deep link
  } catch (e) {
    failure.value = toClientError(e);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="login-layout"><aside class="login-intro"><span class="login-emblem"><Icon name="swords" :size="64" /></span><p class="muted">{{ t('home.eyebrow') }}</p><h1>{{ t('home.headline') }}</h1><p>{{ t('home.description') }}</p><RouterLink to="/events" class="btn">{{ t('home.browseEvents') }}<Icon name="forward" :size="18" /></RouterLink></aside><div class="login-content"><PageHeader :title="t('login.title')" />
  <p v-if="route.query.redirect" class="muted">{{ t('login.redirectNote') }}</p>
  <section class="card stack form" aria-labelledby="otp-h">
    <h2 id="otp-h">{{ t('otp.title') }}</h2>
    <OtpLoginForm @done="afterOtp" />
  </section>
  <details class="dev">
  <summary>{{ t('otp.devToggle') }}</summary>
  <form class="card stack form" novalidate @submit.prevent="submit">
    <p class="notice" role="note">{{ t('login.devNotice') }}</p>

    <FormField id="principalId" :label="t('login.principalId')" :hint="t('login.principalHint')" :error="touched && !principalId.trim() ? t('common.required') : ''" required>
      <template #default="{ id, describedBy, invalid }">
        <input :id="id" v-model="principalId" class="input" dir="ltr" list="seed-ids" autocomplete="username" :aria-describedby="describedBy" :aria-invalid="invalid ? 'true' : undefined" />
        <datalist id="seed-ids"><option v-for="s in seeds" :key="s" :value="s" /></datalist>
      </template>
    </FormField>

    <FormField id="devCode" :label="t('login.devCode')" :error="touched && !devCode ? t('common.required') : ''" required>
      <template #default="{ id, describedBy, invalid }">
        <input :id="id" v-model="devCode" class="input" type="password" dir="ltr" autocomplete="current-password" :aria-describedby="describedBy" :aria-invalid="invalid ? 'true' : undefined" />
      </template>
    </FormField>

    <ErrorNote :error="failure" />
    <button type="submit" class="btn btn-primary" :disabled="busy">{{ busy ? t('login.submitting') : t('login.submit') }}</button>
  </form>
  </details>
  </div></div>
</template>

<style scoped>
.login-layout { display: grid; grid-template-columns: 1fr 1fr; gap: var(--sp-7); align-items: start; padding-block: var(--sp-6); }
.login-intro { border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--surface); padding: var(--sp-7); }
.login-intro h1 { font-size: var(--fs-2xl); line-height: 1.5; }
.login-intro > p { color: var(--text-muted); }
.login-emblem { display: inline-flex; padding: var(--sp-5); color: var(--accent); background: var(--accent-soft); border-radius: var(--radius-lg); margin-block-end: var(--sp-6); }
.login-content { min-inline-size: 0; }
@media (max-width: 900px) { .login-layout { grid-template-columns: 1fr; gap: var(--sp-4); } .login-intro { padding: var(--sp-5); } .login-emblem { display: none; } }
.form { max-inline-size: 32rem; }
.dev { margin-block-start: var(--sp-6); }
.notice { margin: 0; padding: var(--sp-3); background: var(--warn-soft); color: var(--warn); border-radius: var(--radius-md); }
</style>
