<script setup lang="ts">
import { RouterLink } from 'vue-router';
import DataState from '../components/DataState.vue';
import PageHeader from '../components/PageHeader.vue';
import { t } from '../i18n';
</script>

<template>
  <PageHeader :title="t('forbidden.title')" />
  <DataState forbidden />
  <p class="muted">{{ t('forbidden.hint') }}</p>
  <RouterLink to="/" class="btn">{{ t('common.home') }}</RouterLink>
</template>
