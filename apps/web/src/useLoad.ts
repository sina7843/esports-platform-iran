import { onMounted, ref, type Ref } from 'vue';
import type { ApiClientError } from './api/client';
import { toClientError } from './errors';

/** Loads async data with loading/error state; `load()` doubles as the retry handler. */
export function useLoad<T>(fn: () => Promise<T>, immediate = true) {
  const data = ref(null) as Ref<T | null>;
  const loading = ref(false);
  const error = ref<ApiClientError | null>(null);
  async function load(): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      data.value = await fn();
    } catch (e) {
      error.value = toClientError(e);
    } finally {
      loading.value = false;
    }
  }
  if (immediate) onMounted(() => void load());
  return { data, loading, error, load };
}
