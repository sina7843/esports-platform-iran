import { api } from './api/client';

/**
 * Follows realtime channels by cursor polling of the durable, gap-free event feed (the documented fallback of the SSE
 * stream). Calls `onChange` whenever anything arrives; pauses while the tab is hidden. Returns a stop function.
 * Timers shown on screen always come from server deadlines, so missing a beat never shifts them.
 */
export function watchChannels(channels: string[], onChange: () => void, intervalMs = 2500): () => void {
  let cursor = 0;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let primed = false;
  const tick = async () => {
    if (stopped) return;
    if (typeof document === 'undefined' || document.visibilityState !== 'hidden') {
      try {
        const r = await api.realtimeEvents(cursor, channels.join(','));
        if (primed && r.events.length) onChange();
        cursor = r.cursor;
        primed = true;
      } catch {
        /* offline: keep trying; the page shows its own offline state */
      }
    }
    timer = setTimeout(() => void tick(), intervalMs);
  };
  void tick();
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}

/** Seconds left until a server deadline, corrected by the server/client clock offset. */
export function secondsLeft(deadline: string | null, serverTime: string, receivedAt: number, now = Date.now()): number | null {
  if (!deadline) return null;
  const offset = Date.parse(serverTime) - receivedAt;
  return Math.max(0, Math.round((Date.parse(deadline) - (now + offset)) / 1000));
}
