import type { CollectionSource, SiteInventory } from "./types.ts";

export type ChangeKind = "added" | "removed" | "updated" | "downgraded" | "activated" | "deactivated";

export type ItemType = "core" | "plugin" | "theme";

export interface Change {
  itemType: ItemType;
  identifier: string;
  name: string;
  kind: ChangeKind;
  before: string | null;
  after: string | null;
}

interface ComparableItem {
  identifier: string;
  name: string;
  installedVersion: string | null;
  status: string;
}

const ITEM_ORDER: Record<ItemType, number> = { core: 0, plugin: 1, theme: 2 };

export function compareVersions(a: string, b: string): number {
  const partsA = a.split(/[.\-+_]/);
  const partsB = b.split(/[.\-+_]/);
  const length = Math.max(partsA.length, partsB.length);

  for (let i = 0; i < length; i++) {
    const x = partsA[i];
    const y = partsB[i];

    if (x === undefined || y === undefined) {
      const extra = (x ?? y) as string;
      if (/^\d+$/.test(extra)) {
        if (Number(extra) === 0) continue;
        return x === undefined ? -1 : 1;
      }
      return x === undefined ? 1 : -1;
    }

    const isNumberX = /^\d+$/.test(x);
    const isNumberY = /^\d+$/.test(y);
    if (isNumberX && isNumberY) {
      if (Number(x) !== Number(y)) return Number(x) < Number(y) ? -1 : 1;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

function failed(inventory: SiteInventory, source: CollectionSource): boolean {
  return inventory.errors.some((error) => error.source === source);
}

function versionChange(itemType: ItemType, before: ComparableItem, after: ComparableItem): Change | null {
  if (before.installedVersion === null || after.installedVersion === null) return null;
  const order = compareVersions(before.installedVersion, after.installedVersion);
  if (order === 0) return null;
  return {
    itemType,
    identifier: after.identifier,
    name: after.name,
    kind: order < 0 ? "updated" : "downgraded",
    before: before.installedVersion,
    after: after.installedVersion,
  };
}

function statusChange(itemType: ItemType, before: ComparableItem, after: ComparableItem): Change | null {
  const known = ["active", "inactive"];
  if (before.status === after.status || !known.includes(before.status) || !known.includes(after.status)) return null;
  return {
    itemType,
    identifier: after.identifier,
    name: after.name,
    kind: after.status === "active" ? "activated" : "deactivated",
    before: before.status,
    after: after.status,
  };
}

function compareLists(itemType: ItemType, before: ComparableItem[], after: ComparableItem[]): Change[] {
  const changes: Change[] = [];
  const oldItems = new Map(before.map((item) => [item.identifier, item]));
  const newIds = new Set(after.map((item) => item.identifier));

  for (const item of after) {
    const previous = oldItems.get(item.identifier);
    if (!previous) {
      changes.push({
        itemType,
        identifier: item.identifier,
        name: item.name,
        kind: "added",
        before: null,
        after: item.installedVersion,
      });
      continue;
    }

    const version = versionChange(itemType, previous, item);
    if (version) changes.push(version);
    const status = statusChange(itemType, previous, item);
    if (status) changes.push(status);
  }

  for (const item of before) {
    if (newIds.has(item.identifier)) continue;
    changes.push({
      itemType,
      identifier: item.identifier,
      name: item.name,
      kind: "removed",
      before: item.installedVersion,
      after: null,
    });
  }

  return changes;
}

export function diffInventories(before: SiteInventory, after: SiteInventory): Change[] | null {
  if (before.fetchStatus === "failed" || after.fetchStatus === "failed") return null;

  const changes: Change[] = [];

  const oldCore = before.core.installedVersion;
  const newCore = after.core.installedVersion;
  if (oldCore !== null && newCore !== null && compareVersions(oldCore, newCore) !== 0) {
    changes.push({
      itemType: "core",
      identifier: "wordpress",
      name: "WordPress",
      kind: compareVersions(oldCore, newCore) < 0 ? "updated" : "downgraded",
      before: oldCore,
      after: newCore,
    });
  }

  const extrasComparable = !failed(before, "status") && !failed(after, "status");
  const pluginsOf = (inventory: SiteInventory): ComparableItem[] =>
    inventory.plugins.filter((plugin) => extrasComparable || plugin.kind === "plugin");
  changes.push(...compareLists("plugin", pluginsOf(before), pluginsOf(after)));

  if (!failed(before, "themes") && !failed(after, "themes")) {
    const themesOf = (inventory: SiteInventory): ComparableItem[] =>
      inventory.themes.map((theme) => ({
        identifier: theme.slug,
        name: theme.name,
        installedVersion: theme.installedVersion,
        status: theme.status,
      }));
    changes.push(...compareLists("theme", themesOf(before), themesOf(after)));
  }

  return changes.sort((a, b) => ITEM_ORDER[a.itemType] - ITEM_ORDER[b.itemType] || a.name.localeCompare(b.name));
}
