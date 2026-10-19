<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import type { ApiClientError } from '../api/client';
import { esp02 } from '../api/esp02';
import DataState from '../components/DataState.vue';
import DigitInput from '../components/DigitInput.vue';
import ErrorNote from '../components/ErrorNote.vue';
import FormField from '../components/FormField.vue';
import PageHeader from '../components/PageHeader.vue';
import { toClientError } from '../errors';
import { t } from '../i18n';
import { resetSession } from '../session';
import { useLoad } from '../useLoad';

/** USR-009 (2FA, devices), ADM-012/DATA-006 (export, delete with anonymization). */
const router = useRouter();
const mfa = useLoad(() => esp02.mfa());
const failure = ref<ApiClientError | null>(null);
const notice = ref('');
const busy = ref(false);

async function run(fn: () => Promise<unknown>, ok = '') {
  busy.value = true;
  failure.value = null;
  notice.value = '';
  try {
    await fn();
    notice.value = ok;
  } catch (e) {
    failure.value = toClientError(e);
  } finally {
    busy.value = false;
  }
}

const setup = ref<{ secret: string; recoveryCodes: string[] } | null>(null);
const code = ref('');
const startSetup = () => run(async () => (setup.value = await esp02.totpSetup()));
const confirmSetup = () => run(async () => { await esp02.totpConfirm(code.value); setup.value = null; code.value = ''; await mfa.load(); });
const stepUp = () => run(async () => { await esp02.stepUp(code.value); code.value = ''; await mfa.load(); });
const logoutOthers = () => run(() => esp02.logoutOthers(), t('security.loggedOutOthers'));

const reauthSent = ref(false);
const reauthCode = ref('');
const sendReauth = () => run(async () => { await esp02.reauthRequest(); reauthSent.value = true; });
const deleteAccount = () =>
  run(async () => {
    await esp02.reauthVerify(reauthCode.value);
    await esp02.deleteAccount();
    resetSession();
    await router.replace('/');
  });
</script>

<template>
  <PageHeader :title="t('security.title')" />
  <ErrorNote :error="failure" />
  <p v-if="notice" role="status" class="ok">{{ notice }}</p>

  <section class="card stack" aria-labelledby="mfa-h">
    <h2 id="mfa-h">{{ t('security.mfa') }}</h2>
    <DataState :loading="mfa.loading.value" :error="mfa.error.value" @retry="mfa.load">
      <template v-if="mfa.data.value">
        <p>{{ mfa.data.value.enabled ? t('security.mfaOn') : t('security.mfaOff') }}</p>
        <p v-if="mfa.data.value.requiredByRole" class="notice">{{ t('security.mfaRequired') }}</p>
        <button v-if="!mfa.data.value.enabled && !setup" type="button" class="btn" :disabled="busy" @click="startSetup">{{ t('security.setup') }}</button>
        <div v-if="setup" class="stack">
          <p>{{ t('security.secret') }} <code class="ltr">{{ setup.secret }}</code></p>
          <p>{{ t('security.recovery') }}</p>
          <ul class="codes ltr"><li v-for="c in setup.recoveryCodes" :key="c"><code>{{ c }}</code></li></ul>
        </div>
        <form v-if="setup || (mfa.data.value.enabled && !mfa.data.value.sessionVerified)" class="row" novalidate @submit.prevent="setup ? confirmSetup() : stepUp()">
          <FormField id="totp" :label="setup ? t('security.confirm') : t('security.stepUp')">
            <template #default="{ id, describedBy }"><DigitInput :id="id" v-model="code" inputmode="numeric" :described-by="describedBy" /></template>
          </FormField>
          <button type="submit" class="btn btn-primary" :disabled="busy || code.length < 6">{{ t('security.confirm') }}</button>
        </form>
      </template>
    </DataState>
  </section>

  <section class="card stack block">
    <button type="button" class="btn" :disabled="busy" @click="logoutOthers">{{ t('security.logoutOthers') }}</button>
    <a class="btn" :href="esp02.exportUrl()" download="my-data.json">{{ t('security.export') }}</a>
  </section>

  <section class="card stack block danger" aria-labelledby="del-h">
    <h2 id="del-h">{{ t('security.delete') }}</h2>
    <p>{{ t('security.deleteWarn') }}</p>
    <button v-if="!reauthSent" type="button" class="btn" :disabled="busy" @click="sendReauth">{{ t('security.reauthSend') }}</button>
    <form v-else class="row" novalidate @submit.prevent="deleteAccount">
      <FormField id="reauth" :label="t('security.reauthCode')">
        <template #default="{ id, describedBy }"><DigitInput :id="id" v-model="reauthCode" inputmode="numeric" :described-by="describedBy" /></template>
      </FormField>
      <button type="submit" class="btn btn-danger" :disabled="busy || reauthCode.length < 4">{{ t('security.deleteConfirm') }}</button>
    </form>
  </section>
</template>

<style scoped>
.block { margin-block-start: var(--sp-6); }
.codes { columns: 2; margin: 0; }
.danger { border-color: var(--danger, #b42318); }
.ok { color: var(--accent-strong); }
.notice { margin: 0; padding: var(--sp-3); background: var(--warn-soft); color: var(--warn); border-radius: var(--radius-md); }
.row { align-items: flex-end; flex-wrap: wrap; gap: var(--sp-3); }
</style>
