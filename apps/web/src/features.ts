/**
 * Regions waiting on a P0 backend item (docs/redesign/06-docs/api-backlog.md). A page gates the region with
 * v-if="isOn('2.7')" and shows the spec's `later` state otherwise. Flip a flag only when the backend ships the item
 * and the client method exists in src/api/*.ts. Never mock the data.
 */
const FLAGS: Readonly<Record<string, boolean>> = Object.freeze({});

export function isOn(id: string): boolean {
  return FLAGS[id] === true;
}
