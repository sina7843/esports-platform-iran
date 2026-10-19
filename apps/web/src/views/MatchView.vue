<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { api, type ApiClientError, type Lobby } from '../api/client';
import DataState from '../components/DataState.vue';
import JalaliDate from '../components/JalaliDate.vue';
import PageHeader from '../components/PageHeader.vue';
import StatusBadge from '../components/StatusBadge.vue';
import { toClientError } from '../errors';
import { num, t } from '../i18n';
import { useLoad } from '../useLoad';

const route = useRoute();
const id = computed(() => String(route.params.id));
const { data, loading, error, load } = useLoad(() => api.match(id.value));

// Private lobby panel: never auto-loaded, never part of the public projection.
const lobby = ref<Lobby | null>(null);
const lobbyLoading = ref(false);
const lobbyError = ref<ApiClientError | null>(null);
async function loadLobby() {
  lobbyLoading.value = true;
  lobbyError.value = null;
  try {
    lobby.value = await api.lobby(id.value);
  } catch (e) {
    lobby.value = null;
    lobbyError.value = toClientError(e);
  } finally {
    lobbyLoading.value = false;
  }
}
watch(id, () => {
  lobby.value = null;
  lobbyError.value = null;
  void load();
});
</script>

<template>
  <DataState :loading="loading" :error="error" @retry="load">
    <template v-if="data">
      <PageHeader :title="t('match.title')">
        <template #actions><StatusBadge :state="data.state" /></template>
      </PageHeader>
      <dl class="meta">
        <div><dt>{{ t('match.kind') }}</dt><dd><bdi>{{ data.kind }}</bdi></dd></div>
        <div>
          <dt>{{ data.estimated ? t('match.estimated') : t('match.scheduledAt') }}</dt>
          <dd><JalaliDate :iso="data.scheduledAt" /></dd>
        </div>
        <div><dt>{{ t('match.version') }}</dt><dd class="num">{{ num(data.resultVersion) }}</dd></div>
      </dl>

      <h2>{{ t('match.sides') }}</h2>
      <p v-if="data.sides.length === 0" class="muted">{{ t('match.noSides') }}</p>
      <div class="grid">
        <section v-for="(s, i) in data.sides" :key="i" class="card">
          <h3><bdi>{{ s.displayName }}</bdi></h3>
          <ul>
            <li v-for="(p, j) in s.roster" :key="j"><bdi>{{ p.displayName }}</bdi> <span class="muted"><bdi>{{ p.role }}</bdi></span></li>
          </ul>
        </section>
      </div>

      <section class="card lobby" aria-labelledby="lobby-h">
        <h2 id="lobby-h">{{ t('match.lobbyTitle') }}</h2>
        <p class="muted">{{ t('match.lobbyHint') }}</p>
        <DataState :loading="lobbyLoading" :error="lobbyError" @retry="loadLobby">
          <dl v-if="lobby" class="meta">
            <div><dt>{{ t('match.lobbyHost') }}</dt><dd><code>{{ lobby.host }}</code></dd></div>
            <div><dt>{{ t('match.lobbyPassword') }}</dt><dd><code>{{ lobby.password }}</code></dd></div>
            <div><dt>{{ t('match.lobbyReleased') }}</dt><dd><JalaliDate :iso="lobby.releasedAt" /></dd></div>
          </dl>
          <button v-else type="button" class="btn" @click="loadLobby">{{ t('match.lobbyLoad') }}</button>
        </DataState>
      </section>
    </template>
  </DataState>
</template>

<style scoped>
.meta { display: grid; grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr)); gap: var(--sp-4); margin: 0 0 var(--sp-5); }
dt { color: var(--text-muted); font-size: var(--fs-sm); }
dd { margin: 0; font-weight: 600; }
.lobby { margin-block-start: var(--sp-6); }
</style>
