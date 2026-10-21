<script setup lang="ts">
import { Menu, X, Sun, Moon, Globe, Hash, TriangleAlert, LockKeyhole, WifiOff, Inbox, LoaderCircle, UserRound, RefreshCw, ChevronRight, Trophy, House, Gamepad2, Newspaper, ChartNoAxesColumnIncreasing, UsersRound, CalendarDays, Search, Settings2, ShieldCheck, ArrowUpLeft, ArrowLeft, Bell, Swords, LayoutDashboard } from '@lucide/vue';
const icons = { menu: Menu, close: X, sun: Sun, moon: Moon, globe: Globe, hash: Hash, alert: TriangleAlert, lock: LockKeyhole, 'wifi-off': WifiOff, inbox: Inbox, loader: LoaderCircle, user: UserRound, refresh: RefreshCw, chevron: ChevronRight, trophy: Trophy, home: House, game: Gamepad2, news: Newspaper, chart: ChartNoAxesColumnIncreasing, users: UsersRound, calendar: CalendarDays, search: Search, settings: Settings2, shield: ShieldCheck, arrow: ArrowUpLeft, forward: ArrowLeft, bell: Bell, swords: Swords, dashboard: LayoutDashboard } as const;
export type IconName = keyof typeof icons;
defineProps<{ name: IconName; size?: number }>();
</script>
<template><component :is="icons[name]" :size="size ?? 20" :stroke-width="1.8" :class="['icon', { spin: name === 'loader', directional: name === 'forward' || name === 'arrow' }]" aria-hidden="true" focusable="false" /></template>
<style scoped>
.icon { flex: none; }
:global([dir='ltr'] .icon.directional) { transform: scaleX(-1); }
.spin { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>
