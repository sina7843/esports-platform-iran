import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue';

/** Element width in px, tracked with ResizeObserver when available (DS `useWidth`; happy-dom has none → measured once). */
export function useWidth(el: Ref<HTMLElement | null>): Ref<number> {
  const w = ref(0);
  let ro: ResizeObserver | undefined;
  onMounted(() => {
    const e = el.value;
    if (!e) return;
    w.value = e.getBoundingClientRect().width;
    if (typeof window === 'undefined' || !window.ResizeObserver) return;
    ro = new ResizeObserver((en) => { w.value = en[0]?.contentRect.width ?? w.value; });
    ro.observe(e);
  });
  onBeforeUnmount(() => ro?.disconnect());
  return w;
}
