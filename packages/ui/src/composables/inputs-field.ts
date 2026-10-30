import { computed, useId, type ComputedRef } from 'vue';

/** DS useUid: the given id, else `<prefix>-<vue useId>` (sanitised). Call in setup. */
export function useUid(prefix: string, given: () => string | undefined): ComputedRef<string> {
  const raw = (useId() ?? '').replace(/[^a-zA-Z0-9_-]/g, '');
  return computed(() => given() || `${prefix}-${raw}`);
}

/**
 * DS useControlled over defineModel: a bound (non-null) v-model wins; unbound, defineModel keeps local state and `seed`
 * (defaultValue) shows until the first change. Write through `model.value = v`. Boolean models are declared
 * `defineModel<boolean | null>({ default: null })` so Vue's boolean casting does not turn "unbound" into `false`.
 */
export function useControlled<T>(model: { readonly value: T | null | undefined }, seed: T): ComputedRef<T> {
  return computed(() => (model.value != null ? model.value : seed));
}

/** Drop undefined entries so optional props can be spread onto components under exactOptionalPropertyTypes. */
export function defined<T extends Record<string, unknown>>(o: T): { [K in keyof T]?: Exclude<T[K], undefined> } {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(o)) if (o[k] !== undefined) out[k] = o[k];
  return out as { [K in keyof T]?: Exclude<T[K], undefined> };
}
