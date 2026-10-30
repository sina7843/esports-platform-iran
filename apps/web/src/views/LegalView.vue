<script setup lang="ts">
import { computed, watch } from 'vue';
import { useRoute } from 'vue-router';
import { QBadge, QCard, QContainer, QDataState, QPageHeader, QTabs, fa, formatJalali } from '@esp/ui';
import { esp07 } from '../api/esp07';
import { t, type MessageKey } from '../i18n';
import { useDataState } from '../useDataState';
import { useLoad } from '../useLoad';
import { useRouter } from 'vue-router';

/** Spec docs/redesign/03-specs/legal.md — public, versioned legal texts (terms, privacy, marketing consent, retention). Plain text only. */
const route = useRoute();
const router = useRouter();
const kind = computed(() => String(route.params['kind']));
const { data, loading, error, load } = useLoad(() => esp07.legal(kind.value));
watch(kind, () => void load());
const ds = useDataState({ loading: computed(() => loading.value && !data.value), error, empty: () => data.value === null && !loading.value });
const KINDS = ['terms', 'privacy', 'retention'] as const;
const tabs = computed(() => KINDS.map((k) => ({ key: k, label: t(`a7.legal.${k}` as MessageKey) })));
const tab = computed({ get: () => kind.value, set: (v: string) => void router.push(`/legal/${v}`) });
</script>

<template>
  <QContainer>
    <div class="k-stack p-legal">
      <QPageHeader :title="t(`a7.legal.${kind}` as MessageKey)" :breadcrumb="[{ label: t('shell.home'), href: '/' }, { label: t('shell.terms_privacy') }]" />
      <QTabs v-model="tab" :items="tabs" :aria-label="t('shell.terms_privacy')" overflow="scroll" />
      <QDataState v-if="ds.state.value !== 'content' || !data" v-bind="ds.props.value" icon="file" @retry="load" />
      <QCard v-else padding="lg">
        <article class="p-legal-doc">
          <h2 class="h3 p-legal-title"><bdi>{{ data.title }}</bdi></h2>
          <p class="p-legal-meta">
            <QBadge tone="neutral">{{ t('a7.legal.version', { v: fa(data.version) }) }}</QBadge>
            <span>{{ formatJalali(data.effectiveAt, 'date') }}</span>
          </p>
          <div class="p-legal-body" dir="auto">{{ data.body }}</div>
        </article>
      </QCard>
    </div>
  </QContainer>
</template>

<style scoped>
.p-legal { gap: var(--space-6); }
.p-legal-doc { display: flex; flex-direction: column; gap: var(--space-4); max-inline-size: 72ch; }
.p-legal-title { margin: 0; }
.p-legal-meta { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-3); margin: 0; font-size: 13px; color: var(--ink-subtle); }
.p-legal-body { white-space: pre-wrap; font-size: 16px; line-height: 30px; color: var(--ink); }
</style>
