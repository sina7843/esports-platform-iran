import { computed, getCurrentScope, onScopeDispose, ref, watch, type ComputedRef } from 'vue';

/** Ticking clock in epoch ms (DS `useNow`); a fixed `now` freezes it (previews, tests, SSR). The interval is cleared on unmount. */
export function useNow(fixed: () => string | number | Date | null | undefined, step: number): ComputedRef<number> {
  const tick = ref(Date.now());
  let t: ReturnType<typeof setInterval> | undefined;
  const stop = () => { if (t !== undefined) { clearInterval(t); t = undefined; } };
  watch(() => fixed() == null, (run) => {
    stop();
    if (run && typeof window !== 'undefined') { tick.value = Date.now(); t = setInterval(() => { tick.value = Date.now(); }, step); }
  }, { immediate: true });
  if (getCurrentScope()) onScopeDispose(stop);
  return computed(() => { const f = fixed(); return f != null ? +new Date(f) : tick.value; });
}
