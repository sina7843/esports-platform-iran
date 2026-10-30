import { getCurrentInstance } from 'vue';
import { isRtl } from '../locale';

/** DOM helpers shared by the navigation components (bundle.js 03-navigation local helpers). */

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function focusables(root: Element | null | undefined): HTMLElement[] {
  if (!root) return [];
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.getClientRects().length > 0);
}

/** Direction of a rendered element (falls back to the locale before mount). */
export function elIsRtl(el: Element | null | undefined): boolean {
  return el ? window.getComputedStyle(el).direction === 'rtl' : isRtl();
}

/** Arrow-key step for a horizontal group, mirrored in RTL: +1 / -1 / 0. */
export function hStep(key: string, rtl: boolean): number {
  if (key === 'ArrowRight') return rtl ? -1 : 1;
  if (key === 'ArrowLeft') return rtl ? 1 : -1;
  return 0;
}

/**
 * Whether the parent bound a listener (`@menu`, `@close`, `v-model:open`). The DS changes its output when a callback is
 * passed (TopBar inline sheet vs onMenu, Dialog/Drawer close button); call in setup, read at render time.
 */
export function useListenerCheck(): (...names: string[]) => boolean {
  const inst = getCurrentInstance();
  return (...names) => names.some((n) => !!inst?.vnode.props?.[n]);
}
