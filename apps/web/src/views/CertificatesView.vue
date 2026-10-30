<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { normalizeDigits } from '@esp/contracts';
import { QAlert, QBadge, QButton, QCard, QCertificateCard, QCode, QContainer, QDataState, QDialog, QEmptyState, QPageHeader, QSection, QTextField, fa, formatJalali } from '@esp/ui';
import { esp05, type Certificate } from '../api/esp05';
import { toClientError } from '../errors';
import { honorLabel, t } from '../i18n';
import { session } from '../session';
import { useDataState } from '../useDataState';
import { useLoad } from '../useLoad';

/** Spec docs/redesign/03-specs/certificates.md — END-004 / AWD-004: certificates with public codes; declared achievements reviewed apart. */
const me = () => session.me?.principal.id ?? '';
const { data, loading, error, load } = useLoad(async () => ({ certs: (await esp05.myCertificates()).items, honors: await esp05.playerHonors(me()) }));
const ds = useDataState({ loading, error });
const certs = computed(() => data.value?.certs ?? []);
const honours = computed(() => data.value?.honors.verified ?? []);
const declared = computed(() => data.value?.honors.declared ?? []);

const f = reactive({ title: '', event: '', year: '' });
const touched = ref(false);
const ok = ref(false);
const submitError = ref('');
const YEAR_MIN = 1990;
const YEAR_MAX = new Date().getFullYear();
const errs = computed(() => {
  const e: Record<string, string> = {};
  const y = normalizeDigits(f.year).trim();
  if (f.title.trim().length < 3) e.title = t('ct.errTitle');
  if (f.event.trim().length < 3) e.event = t('ct.errEvent');
  if (y && (!/^\d{4}$/.test(y) || +y < YEAR_MIN || +y > YEAR_MAX)) e.year = t('ct.errYear', { from: fa(YEAR_MIN), to: fa(YEAR_MAX) });
  return e;
});
const shown = (k: string) => (touched.value ? errs.value[k] : undefined);
async function declare() {
  touched.value = true;
  ok.value = false;
  submitError.value = '';
  if (Object.keys(errs.value).length) return;
  try {
    const y = normalizeDigits(f.year).trim();
    await esp05.declare({ owner: { kind: 'principal', ref: me() }, title: f.title.trim(), eventName: f.event.trim(), year: y ? Number(y) : null, evidenceFileIds: [] });
    Object.assign(f, { title: '', event: '', year: '' });
    touched.value = false;
    ok.value = true;
    await load();
  } catch (e) {
    submitError.value = toClientError(e).message;
  }
}

const share = ref<Certificate | null>(null);
const verifyUrl = (code: string) => `${location.origin}/verify/${code}`;
const certTitle = (c: Certificate) => (c.kind === 'attendance' ? t('ct.attendance') : c.place ? `${t('ct.placement')} · ${t('ct.place', { n: fa(c.place) })}` : t('ct.placement'));
const rank = (p: number | null) => (p === 1 || p === 2 || p === 3 ? p : undefined);
const grouped = (code: string) => code.match(/.{1,4}/g)?.join(' ') ?? code;
</script>

<template>
  <QContainer>
    <div class="k-stack p-certificates">
      <QPageHeader compact :title="t('ct.title')" :description="t('ct.desc')">
        <template #actions><QButton variant="secondary" icon="shield" href="/verify">{{ t('ct.verify') }}</QButton></template>
      </QPageHeader>
      <QDataState v-if="ds.state.value !== 'content'" v-bind="ds.props.value" skeleton="cards" :min-height="360" @retry="load" />
      <template v-else>
        <QEmptyState v-if="!certs.length && !honours.length" icon="award" :title="t('ct.emptyTitle')" :body="t('ct.emptyBody')">
          <template #action><QButton variant="primary" href="/events">{{ t('ct.discover') }}</QButton></template>
        </QEmptyState>
        <QSection v-else-if="certs.length" id="certs" small :title="t('ct.mine')" :description="t('ct.mineDesc', { n: fa(certs.length) })">
          <div class="p-certificates-grid">
            <div v-for="x in certs" :key="x.id" class="p-certificates-item">
              <QCertificateCard
                :title="certTitle(x)" :kind="x.kind === 'attendance' ? 'attendance' : 'placement'" :kind-label="x.kind === 'attendance' ? t('ct.attendance') : t('ct.placement')"
                :rank="rank(x.place)" :recipient="x.displayName" :event="x.eventName" :date="formatJalali(x.issuedAt, 'date')" :code="x.code" verify-href="/verify"
                :state="x.state === 'revoked' ? 'revoked' : 'valid'"
              />
              <div v-if="x.state !== 'revoked'" class="p-certificates-share">
                <QButton variant="secondary" size="sm" icon="link" @click="share = x">{{ t('ct.share') }}</QButton>
              </div>
            </div>
          </div>
        </QSection>
        <div class="p-certificates-two">
          <QSection id="honours" small :title="t('ct.honours')" :description="t('ct.honoursDesc')">
            <QCard padding="none">
              <ul v-if="honours.length" class="p-certificates-honours" :aria-label="t('ct.honours')">
                <li v-for="x in honours" :key="x.id" class="p-certificates-honour">
                  <span :class="['p-certificates-medal', x.place ? `p-certificates-medal--${x.place}` : '']" role="img" :aria-label="x.place ? t('ct.place', { n: fa(x.place) }) : honorLabel(x.label)">{{ x.place ? fa(x.place) : '★' }}</span>
                  <span class="p-certificates-honour__body">
                    <strong>{{ honorLabel(x.label) }} · <bdi>{{ x.eventName }}</bdi></strong>
                    <span>{{ x.team ? `${t('ct.with', { team: x.team.nameAtTime })} · ` : '' }}{{ formatJalali(x.issuedAt, 'date') }}</span>
                    <span class="p-certificates-honour__code q-ltr">{{ grouped(x.verifyCode) }}</span>
                  </span>
                  <span class="p-certificates-share">
                    <QButton variant="secondary" size="sm" icon="image" :href="esp05.cardUrl(x.id)" target="_blank" rel="noopener">{{ t('ct.card') }}</QButton>
                    <QButton variant="ghost" size="sm" icon="shield" :href="`/verify/${x.verifyCode}`">{{ t('ct.verifyBtn') }}</QButton>
                  </span>
                </li>
              </ul>
              <p v-else class="p-certificates-none">{{ t('ct.noHonours') }}</p>
            </QCard>
          </QSection>
          <QSection id="declared" small :title="t('ct.declared')">
            <QCard>
              <div class="k-stack">
                <QAlert tone="info">{{ t('ct.declaredNote') }}</QAlert>
                <ul v-if="declared.length" class="p-certificates-declared">
                  <li v-for="d in declared" :key="d.id">
                    <span><bdi>{{ d.title }}</bdi><small><bdi>{{ d.eventName }}</bdi>{{ d.year ? ` · ${fa(d.year)}` : '' }}</small></span>
                    <QBadge :tone="d.state === 'declared_verified' ? 'info' : 'neutral'">{{ d.state === 'declared_verified' ? t('ct.reviewed') : t('ct.unreviewed') }}</QBadge>
                  </li>
                </ul>
                <QAlert v-if="ok" tone="success" :on-dismiss="() => (ok = false)" :dismiss-label="t('ct.dismiss')">{{ t('ct.saved') }}</QAlert>
                <QAlert v-if="submitError" tone="danger">{{ submitError }}</QAlert>
                <form class="p-certificates-form" novalidate @submit.prevent="declare">
                  <QTextField id="dc-t" v-model="f.title" :label="t('ct.achievement')" required :max-length="120" :error="shown('title')" />
                  <QTextField id="dc-e" v-model="f.event" :label="t('ct.competition')" required :max-length="120" :error="shown('event')" />
                  <QTextField id="dc-y" v-model="f.year" :label="t('ct.year')" input-mode="numeric" ltr :max-length="4" :placeholder="fa(YEAR_MAX - 2)" :error="shown('year')" />
                  <div class="p-certificates-span"><QButton variant="secondary" type="submit" icon="send">{{ t('ct.submit') }}</QButton></div>
                </form>
              </div>
            </QCard>
          </QSection>
        </div>
      </template>
    </div>
    <QDialog :open="!!share" size="md" icon="link" :title="t('ct.shareTitle')" :close-label="t('ct.close')" @close="share = null">
      <div v-if="share" class="k-stack">
        <p class="caption p-certificates-note">{{ t('ct.shareNote') }}</p>
        <QCode block copy :label="t('ct.link')" :copy-label="t('ct.copy')">{{ verifyUrl(share.code) }}</QCode>
        <QCode copy :label="t('ct.code')" :copy-label="t('ct.copy')">{{ share.code }}</QCode>
        <div class="k-row"><QButton variant="ghost" size="sm" icon="external" :href="`/verify/${share.code}`">{{ t('ct.open') }}</QButton></div>
      </div>
      <template #footer><QButton variant="secondary" @click="share = null">{{ t('ct.close') }}</QButton></template>
    </QDialog>
  </QContainer>
</template>

<style scoped>
.p-certificates { gap: var(--space-7); }
.p-certificates-grid { display: grid; gap: var(--space-5); grid-template-columns: repeat(auto-fill, minmax(min(100%, 340px), 1fr)); align-items: start; }
.p-certificates-item { display: flex; flex-direction: column; gap: var(--space-2); min-width: 0; }
.p-certificates-share { display: flex; flex-wrap: wrap; gap: var(--space-2); }
.p-certificates-honours { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; }
.p-certificates-honour { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: var(--space-4); align-items: center; padding: var(--space-4) var(--space-5); border-block-start: 1px solid var(--line); }
.p-certificates-honour:first-child { border-block-start: 0; }
.p-certificates-medal { display: grid; place-items: center; width: 48px; height: 48px; border-radius: var(--radius-pill); border: 2px solid currentColor; font-weight: 900; font-size: 18px; color: var(--ink-muted); }
.p-certificates-medal--1 { color: var(--rank-gold); }
.p-certificates-medal--2 { color: var(--rank-silver); }
.p-certificates-medal--3 { color: var(--rank-bronze); }
.p-certificates-honour__body { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.p-certificates-honour__body strong { font-weight: 800; font-size: 15px; }
.p-certificates-honour__body span { font-size: 13px; color: var(--ink-muted); }
.p-certificates-honour__code { font-family: var(--font-mono); font-size: 12px; color: var(--ink-subtle); }
.p-certificates-none { margin: 0; padding: var(--space-5); color: var(--ink-muted); font-size: 14px; }
.p-certificates-note { margin: 0; color: var(--ink-muted); }
.p-certificates-declared { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: var(--space-2); }
.p-certificates-declared li { display: flex; justify-content: space-between; align-items: center; gap: var(--space-3); padding: var(--space-3) var(--space-4); background: var(--surface-sunken); border-radius: var(--radius-md); font-size: 14px; }
.p-certificates-declared small { display: block; color: var(--ink-subtle); font-size: 12px; }
.p-certificates-form { display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 2fr) minmax(0, 1fr); gap: var(--space-4); align-items: start; }
.p-certificates-span { grid-column: 1 / -1; }
.p-certificates-two { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: var(--space-6); align-items: start; }
@media (max-width: 1100px) { .p-certificates-two { grid-template-columns: minmax(0, 1fr); } }
@media (max-width: 560px) {
  .p-certificates-form { grid-template-columns: minmax(0, 1fr); }
  .p-certificates-honour { grid-template-columns: auto minmax(0, 1fr); }
  .p-certificates-honour > .p-certificates-share { grid-column: 1 / -1; }
}
</style>
