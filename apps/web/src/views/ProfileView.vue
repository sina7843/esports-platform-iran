<script setup lang="ts">
import { ref, watch } from 'vue';
import type { ApiClientError } from '../api/client';
import { esp02, type GameIdentity, type GameProfile, type MyProfile, type Privacy } from '../api/esp02';
import DataState from '../components/DataState.vue';
import ErrorNote from '../components/ErrorNote.vue';
import FormField from '../components/FormField.vue';
import PageHeader from '../components/PageHeader.vue';
import { toClientError } from '../errors';
import { t, type MessageKey } from '../i18n';
import { useLoad } from '../useLoad';

/** USR-003/004/005/007, REC-002: own profile with per-field privacy, games, looking-for-team and game identities. */
const profile = useLoad(() => esp02.myProfile());
const ids = useLoad(() => esp02.gameIdentities());
const following = useLoad(() => esp02.following());
const blocks = useLoad(() => esp02.blocks());
async function unblock(principalId: string) {
  try {
    await esp02.unblock(principalId);
    await blocks.load();
  } catch (e) {
    gidFailure.value = toClientError(e);
  }
}
const form = ref<MyProfile | null>(null);
watch(() => profile.data.value, (p) => (form.value = p ? structuredClone(p) : null), { immediate: true });

const privacyFields = ['realName', 'bio', 'province', 'city', 'links', 'games', 'activityHours', 'equipment'] as const;
const levels: Privacy[] = ['public', 'followers', 'private'];
const policies = ['everyone', 'followers', 'teammates', 'nobody'] as const;

const saving = ref(false);
const notice = ref('');
const failure = ref<ApiClientError | null>(null);

function addGame() {
  form.value?.games.push({ gameId: '', roles: [], declaredLevel: null, verifiedLevel: null, equipment: null, activityHours: null });
}
function rolesText(g: GameProfile) {
  return g.roles.join('، ');
}
function setRoles(g: GameProfile, v: string) {
  g.roles = v.split(/[,،]/).map((x) => x.trim()).filter(Boolean);
}

async function save() {
  if (!form.value) return;
  saving.value = true;
  failure.value = null;
  notice.value = '';
  const f = form.value;
  try {
    const updated = await esp02.updateProfile({
      nickname: f.nickname,
      realName: f.realName || null,
      bio: f.bio || null,
      province: f.province || null,
      city: f.city || null,
      games: f.games.filter((g) => g.gameId.trim()).map(({ gameId, roles, declaredLevel, equipment, activityHours }) => ({ gameId: gameId.trim(), roles, declaredLevel: declaredLevel || null, equipment: equipment || null, activityHours: activityHours || null })),
      privacy: f.privacy,
      messagePolicy: f.messagePolicy,
      lookingForTeam: { active: f.lookingForTeam.active, resume: f.lookingForTeam.resume || null, gameIds: f.lookingForTeam.gameIds },
      expectedVersion: f.version,
    });
    profile.data.value = updated;
    notice.value = t('profile.saved');
  } catch (e) {
    failure.value = toClientError(e); // VERSION_CONFLICT / CONFLICT (nickname taken) are shown with their message
  } finally {
    saving.value = false;
  }
}

// game identities
const gid = ref({ gameId: '', platform: '', value: '', visibility: 'public' as Privacy });
const gidFailure = ref<ApiClientError | null>(null);
const lastDisputed = ref(false);
async function addIdentity() {
  if (!gid.value.gameId.trim() || !gid.value.platform.trim() || !gid.value.value.trim()) return;
  gidFailure.value = null;
  try {
    const r: GameIdentity = await esp02.addGameIdentity({ ...gid.value });
    lastDisputed.value = r.verification.state === 'disputed';
    gid.value = { gameId: '', platform: '', value: '', visibility: 'public' };
    await ids.load();
  } catch (e) {
    gidFailure.value = toClientError(e);
  }
}
</script>

<template>
  <PageHeader :title="t('profile.title')">
    <template v-if="form" #actions><RouterLink class="btn" :to="`/players/${encodeURIComponent(form.nickname)}`">{{ t('profile.viewPublic') }}</RouterLink></template>
  </PageHeader>
  <DataState :loading="profile.loading.value" :error="profile.error.value" @retry="profile.load">
    <form v-if="form" class="card stack form" novalidate @submit.prevent="save">
      <FormField id="nick" :label="t('profile.nickname')" required>
        <template #default="{ id, describedBy }"><input :id="id" v-model="form.nickname" class="input" dir="auto" :aria-describedby="describedBy" /></template>
      </FormField>
      <FormField id="rn" :label="t('profile.realName')">
        <template #default="{ id }"><input :id="id" v-model="form.realName" class="input" dir="auto" /></template>
      </FormField>
      <FormField id="bio" :label="t('profile.bio')">
        <template #default="{ id }"><textarea :id="id" v-model="form.bio" class="input" rows="3" dir="auto" /></template>
      </FormField>
      <div class="grid two">
        <FormField id="prov" :label="t('profile.province')"><template #default="{ id }"><input :id="id" v-model="form.province" class="input" dir="auto" /></template></FormField>
        <FormField id="city" :label="t('profile.city')"><template #default="{ id }"><input :id="id" v-model="form.city" class="input" dir="auto" /></template></FormField>
      </div>

      <fieldset class="stack">
        <legend>{{ t('profile.privacy') }}</legend>
        <div v-for="f in privacyFields" :key="f" class="row priv">
          <label :for="`pv-${f}`">{{ t(`profile.${f}` as MessageKey) }}</label>
          <select :id="`pv-${f}`" v-model="form.privacy[f]" class="input">
            <option v-for="l in levels" :key="l" :value="l">{{ t(`privacy.${l}` as MessageKey) }}</option>
          </select>
        </div>
      </fieldset>

      <FormField id="mp" :label="t('profile.messagePolicy')">
        <template #default="{ id }">
          <select :id="id" v-model="form.messagePolicy" class="input"><option v-for="p in policies" :key="p" :value="p">{{ t(`msg.${p}` as MessageKey) }}</option></select>
        </template>
      </FormField>

      <fieldset class="stack">
        <legend>{{ t('profile.games') }}</legend>
        <div v-for="(g, i) in form.games" :key="i" class="grid three game">
          <FormField :id="`g-${i}`" :label="t('profile.gameId')"><template #default="{ id }"><input :id="id" v-model="g.gameId" class="input ltr" /></template></FormField>
          <FormField :id="`gr-${i}`" :label="t('profile.roles')"><template #default="{ id }"><input :id="id" :value="rolesText(g)" class="input" dir="auto" @change="setRoles(g, ($event.target as HTMLInputElement).value)" /></template></FormField>
          <FormField :id="`gl-${i}`" :label="t('profile.declaredLevel')"><template #default="{ id }"><input :id="id" v-model="g.declaredLevel" class="input" dir="auto" /></template></FormField>
          <p v-if="g.verifiedLevel" class="muted">{{ t('profile.verifiedLevel') }}: <bdi>{{ g.verifiedLevel.value }}</bdi></p>
        </div>
        <button type="button" class="btn btn-sm" @click="addGame">{{ t('profile.addGame') }}</button>
      </fieldset>

      <fieldset class="stack">
        <legend>{{ t('profile.lft') }}</legend>
        <label class="row"><input v-model="form.lookingForTeam.active" type="checkbox" /> {{ t('profile.lft') }}</label>
        <FormField id="resume" :label="t('profile.resume')"><template #default="{ id }"><textarea :id="id" v-model="form.lookingForTeam.resume" class="input" rows="3" dir="auto" /></template></FormField>
      </fieldset>

      <ErrorNote :error="failure" />
      <p v-if="notice" class="ok" role="status">{{ notice }}</p>
      <button type="submit" class="btn btn-primary" :disabled="saving">{{ t('profile.save') }}</button>
    </form>
  </DataState>

  <section class="card stack block" aria-labelledby="gid-h">
    <h2 id="gid-h">{{ t('gid.title') }}</h2>
    <DataState :loading="ids.loading.value" :error="ids.error.value" :empty="!!ids.data.value && ids.data.value.items.length === 0" @retry="ids.load">
      <ul v-if="ids.data.value" class="list">
        <li v-for="g in ids.data.value.items" :key="g.id">
          <bdi class="ltr">{{ g.gameId }} · {{ g.platform }} · {{ g.value }}</bdi> — {{ t('gid.state') }}: <bdi class="ltr">{{ g.verification.state }}</bdi>
        </li>
      </ul>
    </DataState>
    <p v-if="lastDisputed" class="notice" role="status">{{ t('gid.disputedNote') }}</p>
    <form class="grid four" novalidate @submit.prevent="addIdentity">
      <FormField id="gid-game" :label="t('profile.gameId')"><template #default="{ id }"><input :id="id" v-model="gid.gameId" class="input ltr" /></template></FormField>
      <FormField id="gid-plat" :label="t('gid.platform')"><template #default="{ id }"><input :id="id" v-model="gid.platform" class="input ltr" /></template></FormField>
      <FormField id="gid-val" :label="t('gid.value')"><template #default="{ id }"><input :id="id" v-model="gid.value" class="input ltr" /></template></FormField>
      <FormField id="gid-vis" :label="t('profile.privacy')">
        <template #default="{ id }"><select :id="id" v-model="gid.visibility" class="input"><option v-for="l in levels" :key="l" :value="l">{{ t(`privacy.${l}` as MessageKey) }}</option></select></template>
      </FormField>
      <button type="submit" class="btn">{{ t('gid.add') }}</button>
    </form>
    <ErrorNote :error="gidFailure" />
  </section>

  <section class="card stack block" aria-labelledby="fo-h">
    <h2 id="fo-h">{{ t('adm.following') }}</h2>
    <DataState :loading="following.loading.value" :error="following.error.value" :empty="!!following.data.value && following.data.value.items.length === 0" @retry="following.load">
      <ul v-if="following.data.value" class="list"><li v-for="f in following.data.value.items" :key="f.targetType + f.targetId"><bdi class="ltr">{{ f.targetType }}</bdi> · <bdi>{{ f.label ?? f.targetId }}</bdi></li></ul>
    </DataState>
    <h2>{{ t('adm.blocks') }}</h2>
    <DataState :loading="blocks.loading.value" :error="blocks.error.value" :empty="!!blocks.data.value && blocks.data.value.items.length === 0" @retry="blocks.load">
      <ul v-if="blocks.data.value" class="list"><li v-for="b in blocks.data.value.items" :key="b.principalId"><bdi>{{ b.nickname ?? b.principalId }}</bdi> <button type="button" class="btn btn-sm" @click="unblock(b.principalId)">{{ t('adm.unblock') }}</button></li></ul>
    </DataState>
  </section>
</template>

<style scoped>
.form { max-inline-size: 48rem; }
.two { grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr)); }
.three { grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr)); align-items: end; }
.four { grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr)); align-items: end; gap: var(--sp-3); }
.priv { justify-content: space-between; gap: var(--sp-3); }
.priv select { max-inline-size: 12rem; }
fieldset { border: 1px solid var(--border); border-radius: var(--radius-md); padding: var(--sp-4); }
.block { margin-block-start: var(--sp-6); }
.list { margin: 0; padding-inline-start: var(--sp-5); }
.ok { color: var(--ok, var(--accent-strong)); margin: 0; }
.notice { margin: 0; padding: var(--sp-3); background: var(--warn-soft); color: var(--warn); border-radius: var(--radius-md); }
</style>
