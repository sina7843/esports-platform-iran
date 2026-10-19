import { reactive } from 'vue';
import { api } from './api/client';

export const connection = reactive({
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  mode: 'idle' as 'idle' | 'sse' | 'poll',
  reachable: true,
  lastUpdate: null as string | null,
  cursor: 0,
});

const POLL_MS = 15_000;

/**
 * Lightweight connection indicator: SSE first; when EventSource errors, poll /realtime/events and
 * retry SSE after each poll (`after` = last cursor seen). Returns a stop function.
 */
export function startRealtime(): () => void {
  let es: EventSource | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  const touch = (iso?: string) => {
    connection.lastUpdate = iso ?? new Date().toISOString();
  };
  const onOnline = () => {
    connection.online = true;
  };
  const onOffline = () => {
    connection.online = false;
  };
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);

  function schedulePoll() {
    if (!stopped) timer = setTimeout(() => void poll(), POLL_MS);
  }
  async function poll() {
    try {
      const r = await api.realtimeEvents(connection.cursor);
      connection.cursor = r.cursor;
      connection.reachable = true;
      touch(r.serverTime);
    } catch {
      connection.reachable = false;
    }
    if (!stopped) openSse();
  }
  function openSse() {
    if (typeof EventSource === 'undefined') {
      connection.mode = 'poll';
      schedulePoll();
      return;
    }
    es = new EventSource(api.realtimeStreamUrl(connection.cursor), { withCredentials: true });
    es.onopen = () => {
      connection.mode = 'sse';
      connection.reachable = true;
      touch();
    };
    // Named SSE events cannot be wildcard-listened; unnamed ones refresh the timestamp.
    es.onmessage = (m: MessageEvent<string>) => {
      const id = Number(m.lastEventId);
      if (Number.isFinite(id) && id > connection.cursor) connection.cursor = id;
      touch();
    };
    es.onerror = () => {
      es?.close();
      es = null;
      connection.mode = 'poll';
      schedulePoll();
    };
  }

  openSse();
  return () => {
    stopped = true;
    es?.close();
    clearTimeout(timer);
    window.removeEventListener('online', onOnline);
    window.removeEventListener('offline', onOffline);
    connection.mode = 'idle';
  };
}
