import { reactive, readonly } from 'vue';
import type { QToastRegionItem } from '../components/QToastRegion.vue';

/**
 * App-wide toast store for the one QToastRegion in the shell:
 *   const { toasts, push, dismiss } = useToast();
 *   <QToastRegion :toasts="toasts" @dismiss="dismiss" />
 *   push({ tone: 'success', message: t('reg.withdrawn'), duration: 5000 });
 * Toasts with an action or a failure should not get a duration (DS Toast README).
 */
type ToastInput = Omit<QToastRegionItem, 'id' | 'onClose'> & { id?: string | number };

const list = reactive<QToastRegionItem[]>([]);
let seq = 0;

export function pushToast(t: ToastInput): string | number {
  const id = t.id ?? `t${++seq}`;
  const i = list.findIndex((x) => x.id === id);
  const item = { ...t, id } as QToastRegionItem;
  if (i >= 0) list.splice(i, 1, item); else list.push(item);
  return id;
}
export function dismissToast(id: string | number): void {
  const i = list.findIndex((x) => x.id === id);
  if (i >= 0) list.splice(i, 1);
}
export function clearToasts(): void {
  list.splice(0, list.length);
}

export function useToast() {
  return { toasts: readonly(list) as readonly QToastRegionItem[], push: pushToast, dismiss: dismissToast, clear: clearToasts };
}
