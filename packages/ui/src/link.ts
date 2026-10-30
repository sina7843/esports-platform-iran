import type { Component, InjectionKey } from 'vue';

/** The app provides its router link component (RouterLink) under this key; QLink then navigates internal hrefs in-app. */
export const QLinkKey: InjectionKey<Component> = Symbol('QLink');
