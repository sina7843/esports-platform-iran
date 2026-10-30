import { nextTick, onBeforeUnmount, watch, type Ref } from 'vue';
import { focusables } from './navigation-dom';

/**
 * Modal behaviour shared by Dialog and Drawer (bundle.js `useOverlay`): while `modal()` is true, focus moves into `panel`
 * ([data-autofocus], else the first control, else the panel), body scroll is locked, and on release focus returns to the
 * opener. The returned keydown handler (bind it on the panel) closes on Escape and wraps Tab / Shift+Tab inside the panel.
 */
export function useFocusTrap(panel: Ref<HTMLElement | null>, modal: () => boolean, onEscape?: () => void) {
  let prev: Element | null = null;
  let overflow = '';
  let held = false;

  const release = () => {
    if (!held) return;
    held = false;
    document.body.style.overflow = overflow;
    if (prev instanceof HTMLElement) prev.focus();
    prev = null;
  };

  watch(modal, (on) => {
    if (!on) { release(); return; }
    if (held) return;
    held = true;
    prev = document.activeElement;
    overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    void nextTick(() => {
      const el = panel.value;
      if (!el) return;
      (el.querySelector<HTMLElement>('[data-autofocus]') ?? focusables(el)[0] ?? el).focus();
    });
  }, { immediate: true });
  onBeforeUnmount(release);

  return (e: KeyboardEvent) => {
    if (e.key === 'Escape' && onEscape) { e.stopPropagation(); onEscape(); return; }
    if (e.key !== 'Tab') return;
    const f = focusables(panel.value);
    if (!f.length) { e.preventDefault(); return; }
    const first = f[0]!, last = f[f.length - 1]!, a = document.activeElement;
    if (e.shiftKey && (a === first || a === panel.value)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (a === last || a === panel.value)) { e.preventDefault(); first.focus(); }
  };
}
