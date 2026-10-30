<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { QAlert, QBadge, QButton, QCard, QCheckbox, QContainer, QDataState, QGameIdentity, QPageHeader, QSection, QSelect, QTextField, useToast } from '@esp/ui';
import type { ApiClientError } from '../api/client';
import { esp02, type GameIdentity, type GameProfile, type MyProfile, type Privacy } from '../api/esp02';
import { toClientError } from '../errors';
import { t, type MessageKey } from '../i18n';
import { useDataState } from '../useDataState';
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
const { push } = useToast();
watch(notice, (n) => { if (n) push({ tone: 'success', message: n, duration: 4000 }); });
const ds = useDataState({ loading: computed(() => profile.loading.value && !profile.data.value), error: profile.error });
const levelOptions = computed(() => levels.map((l) => ({ value: l, label: t(`privacy.${l}` as MessageKey) })));
const policyOptions = computed(() => policies.map((p) => ({ value: p, label: t(`msg.${p}` as MessageKey) })));
const lft = computed({ get: () => !!form.value?.lookingForTeam.active, set: (v: boolean | null) => { if (form.value) form.value.lookingForTeam.active = !!v; } });
const str = (o: Record<string, unknown>, k: string) => computed({ get: () => String(o[k] ?? ''), set: (v: string) => { o[k] = v; } });
const gidState = (s: string) => (['verified', 'pending', 'unverified', 'rejected', 'disputed'].includes(s) ? s : 'unverified') as never;
</script>

<template>
  <QContainer>
    <div class="k-stack p-profile">
      <QPageHeader compact :title="t('profile.title')" :description="t('pf.desc')">
        <template v-if="form" #actions><QButton variant="secondary" icon="eye" :href="`/players/${encodeURIComponent(form.nickname)}`">{{ t('profile.viewPublic') }}</QButton></template>
      </QPageHeader>
      <QDataState v-if="ds.state.value !== 'content' || !form" v-bind="ds.props.value" @retry="profile.load" />
      <form v-else class="k-stack p-profile" novalidate @submit.prevent="save">
        <QSection id="identity" small :title="t('pf.identity')">
          <QCard>
            <div class="p-profile-grid">
              <QTextField id="nick" v-model="form.nickname" :label="t('profile.nickname')" required />
              <QTextField id="rn" v-model="str(form, 'realName').value" :label="t('profile.realName')" />
              <QTextField id="prov" v-model="str(form, 'province').value" :label="t('profile.province')" />
              <QTextField id="city" v-model="str(form, 'city').value" :label="t('profile.city')" />
              <div class="p-profile-span"><QTextField id="bio" v-model="str(form, 'bio').value" :label="t('profile.bio')" multiline :rows="3" /></div>
            </div>
          </QCard>
        </QSection>
        <QSection id="privacy" small :title="t('profile.privacy')" :description="t('pf.privacyDesc')">
          <QCard>
            <div class="p-profile-grid">
              <QSelect v-for="f in privacyFields" :id="`pv-${f}`" :key="f" v-model="form.privacy[f]" :label="t(`profile.${f}` as MessageKey)" :options="levelOptions" />
              <QSelect id="mp" v-model="form.messagePolicy" :label="t('profile.messagePolicy')" :options="policyOptions" />
            </div>
          </QCard>
        </QSection>
        <QSection id="games" small :title="t('profile.games')">
          <QCard>
            <div class="k-stack">
              <div v-for="(g, i) in form.games" :key="i" class="p-profile-game">
                <QTextField :id="`g-${i}`" v-model="g.gameId" :label="t('profile.gameId')" ltr />
                <QTextField :id="`gr-${i}`" :model-value="rolesText(g)" :label="t('profile.roles')" @update:model-value="(v) => setRoles(g, v ?? '')" />
                <QTextField :id="`gl-${i}`" v-model="str(g, 'declaredLevel').value" :label="t('profile.declaredLevel')" />
                <p v-if="g.verifiedLevel" class="p-profile-muted">{{ t('profile.verifiedLevel') }}: <bdi>{{ g.verifiedLevel.value }}</bdi></p>
              </div>
              <div><QButton variant="secondary" size="sm" icon="plus" @click="addGame">{{ t('profile.addGame') }}</QButton></div>
            </div>
          </QCard>
        </QSection>
        <QSection id="lft" small :title="t('profile.lft')">
          <QCard>
            <div class="k-stack">
              <QCheckbox v-model="lft" :label="t('profile.lft')" />
              <QTextField id="resume" v-model="str(form.lookingForTeam, 'resume').value" :label="t('profile.resume')" multiline :rows="3" />
            </div>
          </QCard>
        </QSection>
        <QAlert v-if="failure" tone="danger">{{ failure.message }}</QAlert>
        <div><QButton type="submit" variant="primary" icon="check" :loading="saving">{{ t('profile.save') }}</QButton></div>
      </form>

      <QSection id="gid" small :title="t('gid.title')">
        <QCard>
          <div class="k-stack">
            <QDataState v-if="ids.error.value" state="error" @retry="ids.load" />
            <div v-else-if="ids.data.value?.items.length" class="k-stack">
              <QGameIdentity v-for="g in ids.data.value.items" :key="g.id" :game="g.gameId" :platform="g.platform" :value="g.value" :state="gidState(g.verification.state)" :on-edit="false" />
            </div>
            <QAlert v-if="lastDisputed" tone="warning">{{ t('gid.disputedNote') }}</QAlert>
            <form class="p-profile-gid" novalidate @submit.prevent="addIdentity">
              <QTextField id="gid-game" v-model="gid.gameId" :label="t('profile.gameId')" ltr />
              <QTextField id="gid-plat" v-model="gid.platform" :label="t('gid.platform')" ltr />
              <QTextField id="gid-val" v-model="gid.value" :label="t('gid.value')" ltr />
              <QSelect id="gid-vis" v-model="gid.visibility" :label="t('profile.privacy')" :options="levelOptions" />
              <QButton type="submit" variant="green" icon="plus">{{ t('gid.add') }}</QButton>
            </form>
            <QAlert v-if="gidFailure" tone="danger">{{ gidFailure.message }}</QAlert>
          </div>
        </QCard>
      </QSection>

      <div class="p-profile-two">
        <QSection id="following" small :title="t('adm.following')">
          <QCard>
            <p v-if="!following.data.value?.items.length" class="p-profile-muted">—</p>
            <ul v-else class="p-profile-list"><li v-for="f in following.data.value.items" :key="f.targetType + f.targetId"><QBadge tone="neutral">{{ f.targetType }}</QBadge><bdi>{{ f.label ?? f.targetId }}</bdi></li></ul>
          </QCard>
        </QSection>
        <QSection id="blocks" small :title="t('adm.blocks')">
          <QCard>
            <p v-if="!blocks.data.value?.items.length" class="p-profile-muted">—</p>
            <ul v-else class="p-profile-list"><li v-for="b in blocks.data.value.items" :key="b.principalId"><bdi>{{ b.nickname ?? b.principalId }}</bdi><QButton variant="secondary" size="sm" @click="unblock(b.principalId)">{{ t('adm.unblock') }}</QButton></li></ul>
          </QCard>
        </QSection>
      </div>
    </div>
  </QContainer>
</template>

<style scoped>
.p-profile { gap: var(--space-7); }
.p-profile-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-4); }
.p-profile-span { grid-column: 1 / -1; }
.p-profile-game { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--space-3); padding-block-end: var(--space-4); border-block-end: 1px solid var(--line); }
.p-profile-gid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)) auto; gap: var(--space-3); align-items: end; }
.p-profile-muted { margin: 0; color: var(--ink-muted); font-size: 14px; }
.p-profile-list { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: var(--space-2); }
.p-profile-list li { display: flex; justify-content: space-between; align-items: center; gap: var(--space-3); }
.p-profile-two { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-6); align-items: start; }
@media (max-width: 900px) { .p-profile-grid, .p-profile-game, .p-profile-gid, .p-profile-two { grid-template-columns: minmax(0, 1fr); } }
</style>
