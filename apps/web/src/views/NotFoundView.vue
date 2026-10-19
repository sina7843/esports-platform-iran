<script setup lang="ts">
import { RouterLink } from 'vue-router';
import PageHeader from '../components/PageHeader.vue';
import { t } from '../i18n';
</script>

<template>
  <PageHeader :title="t('notfound.title')" />
  <p>{{ t('err.NOT_FOUND') }}</p>
  <RouterLink to="/" class="btn">{{ t('common.home') }}</RouterLink>
</template>
