import { computed, type Ref } from 'vue';
import type { ApiClientError } from './api/client';
import { errorText, isForbidden } from './errors';

export type DataStateKind = 'content' | 'loading' | 'empty' | 'error' | 'forbidden' | 'offline' | 'later';

/**
 * Maps useLoad() refs to the QDataState props, with the product's order: offline > forbidden > error > loading > empty > content
 * (NETWORK → offline, FORBIDDEN / UNAUTHENTICATED → forbidden). `later` is for regions gated behind features.ts.
 * Usage: <QDataState v-bind="ds.props.value" @retry="load"> … </QDataState>
 */
export function useDataState(src: {
  loading: Ref<boolean>;
  error: Ref<ApiClientError | null>;
  empty?: Ref<boolean> | (() => boolean);
  later?: Ref<boolean> | (() => boolean);
}) {
  const read = (v?: Ref<boolean> | (() => boolean)) => (typeof v === 'function' ? v() : (v?.value ?? false));
  const state = computed<DataStateKind>(() => {
    if (read(src.later)) return 'later';
    const e = src.error.value;
    if (e?.code === 'NETWORK') return 'offline';
    if (isForbidden(e)) return 'forbidden';
    if (e) return 'error';
    if (src.loading.value) return 'loading';
    if (read(src.empty)) return 'empty';
    return 'content';
  });
  const props = computed(() => {
    const e = src.error.value;
    const p: { state: DataStateKind; requestId?: string; detail?: string } = { state: state.value };
    if (state.value === 'error' && e) {
      p.detail = errorText(e.code);
      if (e.requestId) p.requestId = e.requestId;
    }
    return p;
  });
  return { state, props };
}
