import { getCurrentScope, onScopeDispose, ref, watch, type Ref } from 'vue';

/** Ticks a seconds counter down once per second while `run()` is true (DS `useCountdown`). Resets when `seconds()` changes. */
export function useCountdown(seconds: () => number, run: () => boolean): Ref<number> {
  const v = ref(seconds());
  let t: ReturnType<typeof setInterval> | undefined;
  const stop = () => { if (t !== undefined) { clearInterval(t); t = undefined; } };
  watch(seconds, (s) => { v.value = s; });
  watch(run, (on) => {
    stop();
    if (on) t = setInterval(() => { v.value = v.value > 0 ? v.value - 1 : 0; }, 1000);
  }, { immediate: true });
  if (getCurrentScope()) onScopeDispose(stop);
  return v;
}
