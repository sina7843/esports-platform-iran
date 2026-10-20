<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { ApiClientError } from '../api/client';
import { esp05 as esp05Api } from '../api/esp05';
import ErrorNote from '../components/ErrorNote.vue';
import JalaliDate from '../components/JalaliDate.vue';
import PageHeader from '../components/PageHeader.vue';
import { toClientError } from '../errors';
import { honorLabel, t } from '../i18n';

/** AWD-004: anyone can check an honor or certificate code; revoked or corrected ones say so plainly. */
const esp05: typeof esp05Api = esp05Api;
const route = useRoute();
const router = useRouter();
const code = ref(String(route.params['code'] ?? ''));
const result = ref<Awaited<ReturnType<typeof esp05.verify>> | null>(null);
const failure = ref<ApiClientError | null>(null);
async function check() {
  failure.value = null;
  result.value = null;
  const c = code.value.trim().toUpperCase();
  if (!c) return;
  if (route.params['code'] !== c) void router.replace(`/verify/${c}`);
  try {
    result.value = await esp05.verify(c);
  } catch (e) {
    failure.value = toClientError(e);
  }
}
onMounted(() => {
  if (code.value) void check();
});
</script>

<template>
  <PageHeader :title="t('ver.title')" :lead="t('ver.lead')" />
  <form class="row" novalidate @submit.prevent="check">
    <label for="ver-c">{{ t('ver.code') }}</label>
    <input id="ver-c" v-model="code" class="input ltr" maxlength="12" autocomplete="off" spellcheck="false" />
    <button type="submit" class="btn btn-primary" :disabled="!code.trim()">{{ t('ver.check') }}</button>
  </form>
  <ErrorNote :error="failure" />
  <section v-if="result" class="card stack block" role="status" aria-live="polite">
    <p :class="result.valid ? 'ok' : 'danger'"><strong>{{ result.valid ? t('ver.valid') : t('ver.invalid') }}</strong></p>
    <template v-if="result.honor">
      <p><bdi>{{ result.honor.team?.nameAtTime ?? result.honor.recipients.map((r) => r.displayName).join('، ') }}</bdi> — {{ honorLabel(result.honor.label) }}</p>
      <p><bdi>{{ result.honor.eventName }}</bdi> · <JalaliDate :iso="result.honor.issuedAt" format="date" /></p>
      <p v-if="result.honor.revokedReason" class="danger" dir="auto">{{ t('ver.revokedReason') }}: {{ result.honor.revokedReason }}</p>
      <img :src="esp05.cardUrl(result.honor.id)" :alt="t('hon.card')" class="card-img" width="600" height="315" />
    </template>
    <template v-if="result.certificate">
      <p><bdi>{{ result.certificate.displayName }}</bdi> — {{ t(`cert.kind.${result.certificate.kind}` as never) }}<span v-if="result.certificate.place"> ({{ t('hon.place', { n: result.certificate.place }) }})</span></p>
      <p><bdi>{{ result.certificate.eventName }}</bdi> · <JalaliDate :iso="result.certificate.issuedAt" format="date" /></p>
    </template>
  </section>
</template>

<style scoped>
.row { flex-wrap: wrap; gap: var(--sp-2); align-items: center; }
.block { margin-block-start: var(--sp-4); }
.card-img { max-inline-size: 100%; block-size: auto; border-radius: var(--radius, 6px); }
.ok { color: var(--ok); }
.danger { color: var(--danger); }
p { margin: 0; }
</style>
