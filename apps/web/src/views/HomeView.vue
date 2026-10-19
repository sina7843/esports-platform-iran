<script setup lang="ts">
import { RouterLink } from 'vue-router';
import { api } from '../api/client';
import DataState from '../components/DataState.vue';
import JalaliDate from '../components/JalaliDate.vue';
import StatusBadge from '../components/StatusBadge.vue';
import { t } from '../i18n';
import { useLoad } from '../useLoad';

const { data, loading, error, load } = useLoad(() => api.health());
</script>

<template>
  <section class="hero">
    <h1>{{ t('home.title') }}</h1>
    <p class="lead">{{ t('home.lead') }}</p>
    <RouterLink to="/events" class="btn btn-primary">{{ t('home.browseEvents') }}</RouterLink>
  </section>

  <section class="card status" aria-labelledby="status-h">
    <h2 id="status-h">{{ t('home.status') }}</h2>
    <DataState :loading="loading" :error="error" @retry="load">
      <template v-if="data">
        <p class="row">
          <StatusBadge :state="data.status" />
          <span class="muted">{{ t('home.version') }}: <bdi class="ltr">{{ data.version }}</bdi></span>
          <JalaliDate :iso="data.serverTime" />
        </p>
        <ul class="checks">
          <li v-for="(c, name) in data.checks" :key="name">
            <bdi class="ltr">{{ name }}</bdi> <StatusBadge :state="c.status" />
          </li>
        </ul>
      </template>
    </DataState>
  </section>
</template>

<style scoped>
.hero { padding: var(--sp-7) 0 var(--sp-6); }
.hero h1 { font-size: var(--fs-2xl); margin-block-end: var(--sp-3); }
.lead { font-size: var(--fs-lg); color: var(--text-muted); max-inline-size: 40ch; }
.status { max-inline-size: 40rem; }
.checks { list-style: none; padding: 0; display: grid; gap: var(--sp-2); }
</style>
