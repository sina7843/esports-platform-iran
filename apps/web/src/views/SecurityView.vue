<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import qrcode from 'qrcode-generator';
import { QAlert, QBadge, QButton, QCard, QCode, QConfirmDialog, QContainer, QDataState, QOtpInput, QPageHeader, QSection, QTextField, useToast } from '@esp/ui';
import type { ApiClientError } from '../api/client';
import { esp02 } from '../api/esp02';
import { toClientError } from '../errors';
import { t } from '../i18n';
import { resetSession, session } from '../session';
import { useDataState } from '../useDataState';
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
const { push } = useToast();
watch(notice, (n) => { if (n) push({ tone: 'success', message: n, duration: 4000 }); });
const ds = useDataState({ loading: computed(() => mfa.loading.value && !mfa.data.value), error: mfa.error });
const confirmingDelete = ref(false);
// TOTP enrolment QR, built locally from the secret (never sent to a third party)
const totpSvg = computed(() => {
  if (!setup.value) return '';
  const label = encodeURIComponent(`QeSB:${session.me?.principal.displayName ?? 'account'}`);
  const q = qrcode(0, 'M');
  q.addData(`otpauth://totp/${label}?secret=${setup.value.secret}&issuer=QeSB`);
  q.make();
  return q.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
});
const onCode = (v: string | undefined) => { code.value = v ?? ''; };
</script>

<template>
  <QContainer>
    <div class="k-stack p-security">
      <QPageHeader compact :title="t('security.title')" :description="t('sc.desc')" />
      <QAlert v-if="failure" tone="danger">{{ failure.message }}</QAlert>

      <QSection id="mfa" small :title="t('security.mfa')">
        <QCard>
          <QDataState v-if="ds.state.value !== 'content' || !mfa.data.value" v-bind="ds.props.value" @retry="mfa.load" />
          <div v-else class="k-stack">
            <div class="k-row">
              <QBadge :tone="mfa.data.value.enabled ? 'success' : 'warning'" icon="lock">{{ mfa.data.value.enabled ? t('security.mfaOn') : t('security.mfaOff') }}</QBadge>
            </div>
            <QAlert v-if="mfa.data.value.requiredByRole" tone="warning">{{ t('security.mfaRequired') }}</QAlert>
            <div v-if="!mfa.data.value.enabled && !setup"><QButton variant="green" icon="shield" :loading="busy" @click="startSetup">{{ t('security.setup') }}</QButton></div>
            <div v-if="setup" class="p-security-setup">
              <!-- eslint-disable-next-line vue/no-v-html -- SVG built locally by qrcode-generator -->
              <span class="p-security-qr" role="img" :aria-label="t('sc.qr')" v-html="totpSvg" />
              <div class="k-stack">
                <QCode copy :label="t('security.secret')" :copy-label="t('sc.copy')">{{ setup.secret }}</QCode>
                <div>
                  <h3 class="p-security-h">{{ t('security.recovery') }}</h3>
                  <ul class="p-security-codes"><li v-for="c in setup.recoveryCodes" :key="c"><code class="q-mono q-ltr">{{ c }}</code></li></ul>
                </div>
              </div>
            </div>
            <form v-if="setup || (mfa.data.value.enabled && !mfa.data.value.sessionVerified)" class="k-stack" novalidate @submit.prevent="setup ? confirmSetup() : stepUp()">
              <QOtpInput :model-value="code" :length="6" :label="setup ? t('security.confirm') : t('security.stepUp')" hide-resend @update:model-value="onCode" />
              <div><QButton type="submit" variant="primary" :loading="busy" :disabled="code.length < 6">{{ setup ? t('security.confirm') : t('security.stepUp') }}</QButton></div>
            </form>
          </div>
        </QCard>
      </QSection>

      <QSection id="devices" small :title="t('sc.devices')">
        <QCard>
          <div class="k-row">
            <QButton variant="secondary" icon="logout" :loading="busy" @click="logoutOthers">{{ t('security.logoutOthers') }}</QButton>
            <QButton variant="ghost" icon="user" href="/account">{{ t('sc.sessions') }}</QButton>
          </div>
        </QCard>
      </QSection>

      <QSection id="data" small :title="t('sc.data')">
        <QCard>
          <div class="k-stack">
            <div><QButton variant="secondary" icon="download" :href="esp02.exportUrl()" download="my-data.json">{{ t('security.export') }}</QButton></div>
            <QAlert tone="danger" icon="alert" :title="t('security.delete')">{{ t('security.deleteWarn') }}</QAlert>
            <div v-if="!reauthSent"><QButton variant="danger" :loading="busy" @click="sendReauth">{{ t('security.reauthSend') }}</QButton></div>
            <form v-else class="p-security-del" novalidate @submit.prevent="confirmingDelete = true">
              <QTextField id="reauth" v-model="reauthCode" :label="t('security.reauthCode')" input-mode="numeric" ltr />
              <QButton type="submit" variant="danger" :disabled="!reauthCode">{{ t('security.delete') }}</QButton>
            </form>
          </div>
        </QCard>
      </QSection>
    </div>
    <QConfirmDialog :require-reason="false"
      :open="confirmingDelete" icon="trash" :title="t('security.delete')" :message="t('security.deleteConfirm')" :confirm-label="t('security.delete')" :cancel-label="t('sc.cancel')"
      :loading="busy" @close="confirmingDelete = false" @confirm="confirmingDelete = false; deleteAccount()"
    />
  </QContainer>
</template>

<style scoped>
.p-security { gap: var(--space-7); }
.p-security-h { margin: 0 0 var(--space-2); font-size: 14px; font-weight: 800; }
.p-security-setup { display: grid; grid-template-columns: 180px minmax(0, 1fr); gap: var(--space-5); align-items: start; }
.p-security-qr { display: block; inline-size: 180px; block-size: 180px; padding: var(--space-2); background: var(--ink); color: var(--bg); border-radius: var(--radius-md); }
:global([data-theme="light"] .p-security-qr) { background: var(--surface); border: 1px solid var(--line-strong); }
.p-security-qr :deep(svg) { display: block; inline-size: 100%; block-size: 100%; }
.p-security-codes { margin: 0; padding: 0; list-style: none; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-1) var(--space-4); }
.p-security-del { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: var(--space-3); align-items: end; max-inline-size: 520px; }
@media (max-width: 640px) { .p-security-setup, .p-security-del { grid-template-columns: minmax(0, 1fr); } }
</style>
