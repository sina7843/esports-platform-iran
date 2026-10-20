<script setup lang="ts">
import { reactive, ref } from 'vue';
import type { ApiClientError } from '../api/client';
import { esp06 as esp06Api, type NotificationPrefs } from '../api/esp06';
import DataState from '../components/DataState.vue';
import ErrorNote from '../components/ErrorNote.vue';
import JalaliDate from '../components/JalaliDate.vue';
import PageHeader from '../components/PageHeader.vue';
import { toClientError } from '../errors';
import { num, t } from '../i18n';
import { useLoad } from '../useLoad';

/**
 * COM-001..004 notification centre: inbox with read and acknowledgement (separate), per-channel status (sent,
 * failed, delivered are shown as they are), preferences with quiet hours, categories, promotional opt-in and
 * aggregation. Essential notices are explained and cannot be turned off.
 */
const esp06: typeof esp06Api = esp06Api;
const unreadOnly = ref(false);
const form = reactive({ quiet: false, from: '23:00', to: '07:00' });
const { data, loading, error, load } = useLoad(async () => {
  const prefs = await esp06.prefs();
  Object.assign(form, prefs.quietHours ? { quiet: true, from: prefs.quietHours.from, to: prefs.quietHours.to } : { quiet: false });
  return { box: await esp06.notifications({ unread: unreadOnly.value }), prefs };
});
const failure = ref<ApiClientError | null>(null);
const notice = ref('');
async function act(fn: () => Promise<unknown>, ok = '') {
  failure.value = null;
  notice.value = '';
  try {
    await fn();
    notice.value = ok;
    await load();
  } catch (e) {
    failure.value = toClientError(e);
  }
}
const CATS = ['registration', 'payment', 'invitation', 'checkin', 'match', 'schedule', 'result', 'decision', 'honor', 'follow.start', 'follow.end', 'follow.time'];
function prefsBody(p: NotificationPrefs) {
  return { channels: { sms: p.channels.sms, email: p.channels.email, push: p.channels.push }, quietHours: form.quiet ? { from: form.from, to: form.to } : null, promotional: p.promotional, digestFrequent: p.digestFrequent, categories: p.categories };
}
</script>

<template>
  <PageHeader :title="t('nav.notifications')" :lead="t('ntf.lead')" />
  <ErrorNote :error="failure" />
  <p v-if="notice" role="status" class="ok">{{ notice }}</p>
  <DataState :loading="loading" :error="error" @retry="load">
    <template v-if="data">
      <section class="card stack" aria-labelledby="ib-h">
        <div class="row between">
          <h2 id="ib-h">{{ t('ntf.inbox') }} <span class="muted small">({{ t('ntf.unread', { n: num(data.box.unread) }) }})</span></h2>
          <span class="row">
            <label class="small"><input v-model="unreadOnly" type="checkbox" @change="load" /> {{ t('ntf.unreadOnly') }}</label>
            <button type="button" class="btn btn-sm" :disabled="!data.box.unread" @click="act(() => esp06.markRead('all'))">{{ t('ntf.markAll') }}</button>
          </span>
        </div>
        <p v-if="!data.box.items.length" class="muted">{{ t('ntf.empty') }}</p>
        <ul class="cards">
          <li v-for="n in data.box.items" :key="n.id" class="item stack" :class="{ unread: !n.readAt }">
            <div class="row between">
              <strong dir="auto">{{ n.title }}<span v-if="n.count > 1" class="muted"> ×{{ num(n.count) }}</span></strong>
              <span class="small muted"><JalaliDate :iso="n.deliverAt" /></span>
            </div>
            <p v-if="n.body" dir="auto">{{ n.body }}</p>
            <p class="small muted">{{ t(`ntf.cat.${n.category}` as never) }}<span v-if="n.essential"> · {{ t('ntf.essential') }}</span> · <span v-for="c in n.channels.filter((x) => x.channel !== 'in_app')" :key="c.channel">{{ t(`ntf.ch.${c.channel}` as never) }}: {{ t(`ntf.st.${c.status}` as never) }}; </span></p>
            <div class="row">
              <RouterLink v-if="n.link" :to="n.link" @click="act(() => esp06.markRead([n.id]))">{{ t('ntf.open') }}</RouterLink>
              <button v-if="!n.readAt" type="button" class="btn btn-sm" @click="act(() => esp06.markRead([n.id]))">{{ t('ntf.markRead') }}</button>
              <button v-if="n.ackRequired && !n.ackAt" type="button" class="btn btn-sm btn-primary" @click="act(() => esp06.ack(n.id), t('ntf.acked'))">{{ t('ntf.ack') }}</button>
              <span v-if="n.ackAt" class="small ok">{{ t('ntf.ackedAt') }} <JalaliDate :iso="n.ackAt" /></span>
            </div>
          </li>
        </ul>
      </section>

      <section class="card stack block" aria-labelledby="pf-h">
        <h2 id="pf-h">{{ t('ntf.prefs') }}</h2>
        <p class="small muted">{{ t('ntf.essentialNote') }}</p>
        <fieldset class="row"><legend>{{ t('ntf.channels') }}</legend>
          <label><input type="checkbox" checked disabled /> {{ t('ntf.ch.in_app') }}</label>
          <label><input v-model="data.prefs.channels.sms" type="checkbox" /> {{ t('ntf.ch.sms') }}</label>
          <label><input v-model="data.prefs.channels.email" type="checkbox" /> {{ t('ntf.ch.email') }}</label>
          <label><input v-model="data.prefs.channels.push" type="checkbox" /> {{ t('ntf.ch.push') }}</label>
        </fieldset>
        <p class="small muted">{{ t('ntf.pushNote') }}</p>
        <fieldset class="row"><legend>{{ t('ntf.quiet') }}</legend>
          <label><input v-model="form.quiet" type="checkbox" /> {{ t('ntf.quietOn') }}</label>
          <label>{{ t('ntf.from') }} <input v-model="form.from" type="time" class="input" :disabled="!form.quiet" /></label>
          <label>{{ t('ntf.to') }} <input v-model="form.to" type="time" class="input" :disabled="!form.quiet" /></label>
        </fieldset>
        <fieldset class="grid"><legend>{{ t('ntf.categories') }}</legend>
          <label v-for="c in CATS" :key="c"><input type="checkbox" :checked="data.prefs.categories[c] !== false" @change="data.prefs.categories[c] = ($event.target as HTMLInputElement).checked" /> {{ t(`ntf.cat.${c}` as never) }}</label>
        </fieldset>
        <label><input v-model="data.prefs.digestFrequent" type="checkbox" /> {{ t('ntf.digest') }}</label>
        <label><input v-model="data.prefs.promotional" type="checkbox" /> {{ t('ntf.promotional') }}</label>
        <button type="button" class="btn btn-primary" @click="act(() => esp06.savePrefs(prefsBody(data!.prefs)), t('ntf.saved'))">{{ t('ntf.save') }}</button>
      </section>
    </template>
  </DataState>
</template>

<style scoped>
.row { display: flex; flex-wrap: wrap; gap: var(--sp-2); align-items: center; }
.between { justify-content: space-between; }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr)); gap: var(--sp-2); }
.cards { list-style: none; padding: 0; margin: 0; display: grid; gap: var(--sp-2); }
.item { border-block-end: 1px solid var(--border); padding-block: var(--sp-2); }
.unread { border-inline-start: 3px solid var(--info); padding-inline-start: var(--sp-2); }
.block { margin-block-start: var(--sp-4); }
fieldset { border: 0; padding: 0; margin: 0; }
.small { font-size: var(--fs-xs); }
.ok { color: var(--ok); }
h2, p { margin: 0; }
</style>
