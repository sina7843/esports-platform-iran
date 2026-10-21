<script setup lang="ts">
import { esp07 } from '../api/esp07';
import { t } from '../i18n';
import { useLoad } from '../useLoad';
import DataState from './DataState.vue';
import Icon from './Icon.vue';
import StatusBadge from './StatusBadge.vue';
const emit = defineEmits<{ preset: [] }>();
const sms = useLoad(() => esp07.smsProvider());
const env = 'SMS_ADAPTER=kavenegar\nKAVENEGAR_API_KEY=<server-secret>\nKAVENEGAR_OTP_TEMPLATE=<approved-template>\nKAVENEGAR_SENDER=<optional-transactional-sender>';
</script>
<template>
  <section class="card stack block" aria-labelledby="kavenegar-title">
    <div class="row between"><div class="row"><Icon name="shield" :size="24" /><h2 id="kavenegar-title">{{ t('sms.title') }}</h2></div><a class="btn btn-sm" href="https://console.kavenegar.com/" target="_blank" rel="noopener noreferrer">{{ t('sms.console') }}<Icon name="arrow" :size="16" /></a></div>
    <p class="muted">{{ t('sms.lead') }}</p>
    <DataState :loading="sms.loading.value" :error="sms.error.value" @retry="sms.load">
      <dl v-if="sms.data.value" class="sms-facts">
        <div><dt>{{ t('sms.adapter') }}</dt><dd><bdi>{{ sms.data.value.adapter }}</bdi></dd></div>
        <div><dt>{{ t('sms.apiKey') }}</dt><dd>{{ sms.data.value.apiKeyConfigured ? t('sms.configured') : t('sms.missing') }}</dd></div>
        <div><dt>{{ t('sms.template') }}</dt><dd><bdi>{{ sms.data.value.template || '—' }}</bdi></dd></div>
        <div><dt>{{ t('sms.health') }}</dt><dd><StatusBadge :state="sms.data.value.health.status" /></dd></div>
      </dl>
      <p v-if="sms.data.value?.adapter !== 'kavenegar'" class="notice">{{ t('sms.notActive') }}</p>
      <p v-else class="notice">{{ t('sms.probeNote') }}</p>
    </DataState>
    <ol class="sms-steps"><li>{{ t('sms.step1') }}</li><li>{{ t('sms.step2') }}</li><li>{{ t('sms.step3') }}</li></ol>
    <details><summary>{{ t('sms.envTitle') }}</summary><pre class="env"><code>{{ env }}</code></pre><p class="small muted">{{ t('sms.envNote') }}</p></details>
    <div class="row"><button type="button" class="btn btn-primary" @click="emit('preset')">{{ t('sms.preset') }}</button><button type="button" class="btn" :disabled="sms.loading.value" @click="sms.load">{{ t('sms.refresh') }}</button><a href="https://kavenegar.com/rest.html" target="_blank" rel="noopener noreferrer">{{ t('sms.docs') }}</a></div>
  </section>
</template>
<style scoped>
.sms-facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr)); gap: var(--sp-4); margin: 0; }
dt { color: var(--text-muted); font-size: var(--fs-sm); } dd { margin: var(--sp-1) 0 0; font-weight: 600; }
h2 { margin: 0; } .between { justify-content: space-between; }
.notice { padding: var(--sp-3); border-inline-start: 3px solid var(--accent); background: var(--accent-soft); border-radius: var(--radius-sm); }
.sms-steps { padding-inline-start: var(--sp-5); } .sms-steps li + li { margin-block-start: var(--sp-2); }
.env { direction: ltr; text-align: start; overflow-x: auto; padding: var(--sp-4); background: var(--surface-2); border-radius: var(--radius-md); }
.small { font-size: var(--fs-sm); }
</style>
