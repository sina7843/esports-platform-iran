<script setup lang="ts">
import { computed } from 'vue';
import { dateTag, tr } from '../locale';
import { appArena, appName } from '../maps/navigation';
import QIcon from './QIcon.vue';
import QLink from './QLink.vue';
import QLogo from './QLogo.vue';
import QTricolor from './QTricolor.vue';

export interface FooterLink { label: string; href?: string }
export interface FooterGroup { title: string; links: FooterLink[] }
/** Footer — site footer: brand, link groups, the eNAMAD trust-seal slot (always at the inline end), tricolour and copyright. */
export interface QFooterProps {
  groups?: FooterGroup[];
  title?: string;
  subtitle?: string;
  description?: string;
  /** eNAMAD trust seal. Without src an empty bordered slot «نماد اعتماد الکترونیکی» is shown. */
  seal?: { src?: string; href?: string; alt?: string; width?: number };
  copyright?: string;
  legalLinks?: FooterLink[];
}
const p = withDefaults(defineProps<QFooterProps>(), { groups: () => [] });

// Current year in the locale's calendar and digits (Jalali «۱۴۰۵» in fa, Gregorian «2026» in en).
const year = computed(() => new Intl.DateTimeFormat(dateTag(), { year: 'numeric', timeZone: 'Asia/Tehran' }).format(new Date()));
const seal = computed(() => p.seal ?? {});
</script>

<template>
  <footer class="q-footer">
    <div class="q-footer__inner">
      <div class="q-footer__top">
        <div class="q-footer__brand">
          <div class="q-footer__brand-row">
            <QLogo :size="44" alt="" />
            <div class="q-footer__brand-copy">
              <strong>{{ title || appName() }}</strong>
              <small>{{ subtitle || appArena() }}</small>
            </div>
          </div>
          <p v-if="description" class="q-footer__desc">{{ description }}</p>
        </div>
        <div class="q-footer__groups">
          <nav v-for="(g, gi) in groups" :key="gi" class="q-footer__group" :aria-label="g.title">
            <h2 class="q-footer__heading">{{ g.title }}</h2>
            <ul class="q-footer__list">
              <li v-for="(l, li) in g.links ?? []" :key="li"><QLink :href="l.href || '#'" class="q-footer__link">{{ l.label }}</QLink></li>
            </ul>
          </nav>
        </div>
        <div class="q-footer__seal">
          <a v-if="seal.src" :href="seal.href" target="_blank" rel="noopener" referrerpolicy="origin" class="q-footer__seal-link">
            <img :src="seal.src" :alt="seal.alt || tr('نماد اعتماد الکترونیکی', 'eNAMAD trust seal')" :width="seal.width || 96" referrerpolicy="origin" />
          </a>
          <div v-else class="q-footer__seal-slot" role="img" :aria-label="tr('جای نماد اعتماد الکترونیکی', 'eNAMAD trust seal placeholder')">
            <QIcon name="shield" :size="24" />
            <span>{{ tr('نماد اعتماد الکترونیکی', 'eNAMAD trust seal') }}</span>
          </div>
        </div>
      </div>
      <div class="q-footer__bottom">
        <QTricolor />
        <span class="q-footer__copy">{{ copyright || `© ${year} ${appName()}` }}</span>
        <span v-if="legalLinks" class="q-footer__legal">
          <QLink v-for="(l, i) in legalLinks" :key="i" :href="l.href || '#'" class="q-footer__link q-footer__link--inline">{{ l.label }}</QLink>
        </span>
      </div>
    </div>
  </footer>
</template>
