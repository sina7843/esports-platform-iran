<script setup lang="ts">
import PageHeader from '../components/PageHeader.vue';
import { num, t } from '../i18n';

/** RANK-002/006, AWD-001/002: public explanation of the rating formulas, worked example and medal conditions. */
const example = [
  { r: 1400, rd: 30, s: 1 },
  { r: 1550, rd: 100, s: 0 },
  { r: 1700, rd: 300, s: 0 },
];
</script>

<template>
  <PageHeader :title="t('formula.title')" :lead="t('formula.lead')" />
  <article class="stack prose">
    <section class="card stack" aria-labelledby="g-h">
      <h2 id="g-h">{{ t('formula.glicko') }}</h2>
      <p>{{ t('formula.glickoText') }}</p>
      <ul class="list">
        <li>{{ t('formula.p1') }}</li>
        <li>{{ t('formula.p2') }}</li>
        <li>{{ t('formula.p3') }}</li>
        <li>{{ t('formula.p4') }}</li>
        <li>{{ t('formula.p5') }}</li>
      </ul>
      <h3>{{ t('formula.example') }}</h3>
      <p>{{ t('formula.exampleText') }}</p>
      <table class="table ltr-nums">
        <caption class="sr-only">{{ t('formula.example') }}</caption>
        <thead><tr><th scope="col">{{ t('formula.opponent') }}</th><th scope="col">{{ t('rank.rating') }}</th><th scope="col">RD</th><th scope="col">{{ t('formula.score') }}</th></tr></thead>
        <tbody><tr v-for="(o, i) in example" :key="i"><th scope="row">{{ num(i + 1) }}</th><td>{{ num(o.r) }}</td><td>{{ num(o.rd) }}</td><td>{{ num(o.s) }}</td></tr></tbody>
      </table>
      <p>{{ t('formula.exampleResult') }}</p>
    </section>
    <section class="card stack" aria-labelledby="l-h">
      <h2 id="l-h">{{ t('formula.lobby') }}</h2>
      <p>{{ t('formula.lobbyText') }}</p>
    </section>
    <section class="card stack" aria-labelledby="e-h">
      <h2 id="e-h">{{ t('formula.eligibility') }}</h2>
      <ul class="list"><li>{{ t('formula.e1') }}</li><li>{{ t('formula.e2') }}</li><li>{{ t('formula.e3') }}</li><li>{{ t('formula.e4') }}</li><li>{{ t('formula.e5') }}</li></ul>
    </section>
    <section class="card stack" aria-labelledby="m-h">
      <h2 id="m-h">{{ t('formula.medals') }}</h2>
      <ul class="list"><li>{{ t('formula.m1') }}</li><li>{{ t('formula.m2') }}</li><li>{{ t('formula.m3') }}</li><li>{{ t('formula.m4') }}</li><li>{{ t('formula.m5') }}</li></ul>
    </section>
  </article>
</template>

<style scoped>
.prose { gap: var(--sp-4); }
.list { margin: 0; padding-inline-start: var(--sp-5); }
.table { border-collapse: collapse; }
.table th, .table td { padding: var(--sp-1) var(--sp-3); border-block-end: 1px solid var(--border); text-align: start; }
h2, h3, p { margin: 0; }
</style>
