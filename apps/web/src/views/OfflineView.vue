<script setup lang="ts">
import { useRouter } from 'vue-router';
import DataState from '../components/DataState.vue';
import PageHeader from '../components/PageHeader.vue';
import { t } from '../i18n';

const router = useRouter();
</script>

<template>
  <PageHeader :title="t('offline.title')" />
  <DataState offline @retry="router.back()" />
</template>
