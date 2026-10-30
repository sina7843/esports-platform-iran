import { describe, expect, it } from 'vitest';
import { ref } from 'vue';
import { ApiClientError } from './api/client';
import { useDataState } from './useDataState';

const err = (code: string) => new ApiClientError({ code: code as never, message: 'x', status: 0, requestId: 'req_1' } as never);

describe('useDataState', () => {
  it('follows offline > forbidden > error > loading > empty > content, plus later', () => {
    const loading = ref(false); const error = ref<ApiClientError | null>(null); const empty = ref(false); const later = ref(false);
    const { state, props } = useDataState({ loading, error, empty, later });
    expect(state.value).toBe('content');
    empty.value = true; expect(state.value).toBe('empty');
    loading.value = true; expect(state.value).toBe('loading');
    error.value = err('VALIDATION'); expect(state.value).toBe('error');
    expect(props.value.requestId).toBe('req_1');
    error.value = err('FORBIDDEN'); expect(state.value).toBe('forbidden');
    error.value = err('UNAUTHENTICATED'); expect(state.value).toBe('forbidden');
    error.value = err('NETWORK'); expect(state.value).toBe('offline');
    later.value = true; expect(state.value).toBe('later');
  });
});
