<script setup lang="ts">
import { QAlert, QButton, QCard, QContainer, QDataTable, QPageHeader, QSection, fa, isRtl, type QDataTableColumn } from '@esp/ui';
import { t } from '../i18n';

/**
 * Spec docs/redesign/03-specs/formula.md — RANK-002/006, AWD-001/002: public explanation of the rating formulas, worked
 * example and medal conditions. Published system parameters per game need backlog 12.4; the general text is shown.
 */
type Row = { id: number; r: number; rd: number; s: number };
const example: Row[] = [
  { id: 1, r: 1400, rd: 30, s: 1 },
  { id: 2, r: 1550, rd: 100, s: 0 },
  { id: 3, r: 1700, rd: 300, s: 0 },
];
const cols: QDataTableColumn<Row>[] = [
  { key: 'id', header: t('formula.opponent') }, { key: 'r', header: t('rank.rating'), numeric: true },
  { key: 'rd', header: 'RD', numeric: true }, { key: 's', header: t('formula.score'), numeric: true },
];
const toc = [
  { id: 'glicko', label: 'formula.glicko' }, { id: 'lobby', label: 'formula.lobby' },
  { id: 'eligibility', label: 'formula.eligibility' }, { id: 'medals', label: 'formula.medals' },
] as const;
</script>

<template>
  <QContainer>
    <div class="k-stack p-formula">
      <QPageHeader :title="t('formula.title')" :description="t('formula.lead')" :breadcrumb="[{ label: t('shell.home'), href: '/' }, { label: t('shell.rankings'), href: '/rankings' }, { label: t('formula.title') }]">
        <template #actions><QButton variant="secondary" :icon="isRtl() ? 'arrow-right' : 'arrow-left'" href="/rankings">{{ t('shell.rankings') }}</QButton></template>
      </QPageHeader>
      <div class="p-formula-grid">
        <nav class="p-formula-toc" :aria-label="t('formula.title')">
          <QCard>
            <ol><li v-for="x in toc" :key="x.id"><a :href="`#${x.id}`">{{ t(x.label) }}</a></li></ol>
          </QCard>
        </nav>
        <article class="p-formula-body">
          <QSection id="glicko" small :title="t('formula.glicko')">
            <QCard>
              <div class="p-formula-prose">
                <p>{{ t('formula.glickoText') }}</p>
                <ul><li>{{ t('formula.p1') }}</li><li>{{ t('formula.p2') }}</li><li>{{ t('formula.p3') }}</li><li>{{ t('formula.p4') }}</li><li>{{ t('formula.p5') }}</li></ul>
                <h3>{{ t('formula.example') }}</h3>
                <p>{{ t('formula.exampleText') }}</p>
                <QDataTable :caption="t('formula.example')" caption-hidden row-key="id" row-header="id" :columns="cols" :rows="example">
                  <template #cell-id="{ row }">{{ fa(row.id) }}</template>
                  <template #cell-r="{ row }">{{ fa(row.r) }}</template>
                  <template #cell-rd="{ row }">{{ fa(row.rd) }}</template>
                  <template #cell-s="{ row }">{{ fa(row.s) }}</template>
                </QDataTable>
                <QAlert tone="info">{{ t('formula.exampleResult') }}</QAlert>
              </div>
            </QCard>
          </QSection>
          <QSection id="lobby" small :title="t('formula.lobby')">
            <QCard><p class="p-formula-p">{{ t('formula.lobbyText') }}</p></QCard>
          </QSection>
          <QSection id="eligibility" small :title="t('formula.eligibility')">
            <QCard><ul class="p-formula-list"><li>{{ t('formula.e1') }}</li><li>{{ t('formula.e2') }}</li><li>{{ t('formula.e3') }}</li><li>{{ t('formula.e4') }}</li><li>{{ t('formula.e5') }}</li></ul></QCard>
          </QSection>
          <QSection id="medals" small :title="t('formula.medals')">
            <QCard><ul class="p-formula-list"><li>{{ t('formula.m1') }}</li><li>{{ t('formula.m2') }}</li><li>{{ t('formula.m3') }}</li><li>{{ t('formula.m4') }}</li><li>{{ t('formula.m5') }}</li></ul></QCard>
          </QSection>
        </article>
      </div>
    </div>
  </QContainer>
</template>

<style scoped>
.p-formula { gap: var(--space-7); }
.p-formula-grid { display: grid; grid-template-columns: 240px minmax(0, 1fr); gap: var(--space-6); align-items: start; }
.p-formula-toc { position: sticky; inset-block-start: var(--space-5); }
.p-formula-toc ol { margin: 0; padding-inline-start: var(--space-5); display: flex; flex-direction: column; gap: var(--space-2); font-size: 14px; }
.p-formula-toc a { color: var(--green-text); font-weight: 700; text-decoration: none; }
.p-formula-body { display: flex; flex-direction: column; gap: var(--space-7); min-width: 0; }
.p-formula-prose { display: flex; flex-direction: column; gap: var(--space-4); font-size: 15px; line-height: 28px; color: var(--ink-muted); }
.p-formula-prose p, .p-formula-prose h3, .p-formula-p { margin: 0; }
.p-formula-prose h3 { color: var(--ink); font-size: 16px; font-weight: 800; }
.p-formula-prose ul, .p-formula-list { margin: 0; padding-inline-start: var(--space-5); display: flex; flex-direction: column; gap: var(--space-2); font-size: 15px; line-height: 28px; color: var(--ink-muted); }
.p-formula-p { font-size: 15px; line-height: 28px; color: var(--ink-muted); }
@media (max-width: 960px) { .p-formula-grid { grid-template-columns: minmax(0, 1fr); } .p-formula-toc { position: static; } }
</style>
