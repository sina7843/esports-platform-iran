import { computed, ref } from 'vue';

/**
 * Controlled-or-uncontrolled boolean (DS `useBool`): when the prop is not null/undefined it is controlled (the parent
 * must update it, e.g. via `v-model:<name>`); otherwise local state seeded by the `default*` prop. Unlike `defineModel`,
 * a bound value without an update listener stays controlled, like the DS. Declare the prop with `default: undefined`
 * so Vue's boolean casting does not turn an absent prop into `false`.
 */
export function usePeopleBool(controlled: () => boolean | undefined, initial: () => boolean | undefined, onChange: (v: boolean) => void) {
  const local = ref(!!initial());
  const value = computed(() => { const c = controlled(); return c != null ? !!c : local.value; });
  function set(next?: boolean) {
    const n = typeof next === 'boolean' ? next : !value.value;
    if (controlled() == null) local.value = n;
    onChange(n);
  }
  return { value, set };
}
