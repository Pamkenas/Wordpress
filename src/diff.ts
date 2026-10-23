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

function isNumberPart(part: string): boolean {
  return /^\d+$/.test(part);
}

function compareParts(x: string, y: string): number {
  if (isNumberPart(x) && isNumberPart(y)) {
    if (Number(x) === Number(y)) return 0;
    return Number(x) < Number(y) ? -1 : 1;
  }
  if (x === y) return 0;
  if (isNumberPart(x)) return 1;
  if (isNumberPart(y)) return -1;
  return x < y ? -1 : 1;
}

export function compareVersions(a: string, b: string): number {
  const partsA = a.split(/[.\-+_]/);
  const partsB = b.split(/[.\-+_]/);
  const length = Math.max(partsA.length, partsB.length);

  for (let i = 0; i < length; i++) {
    const result = compareParts(partsA[i] ?? "0", partsB[i] ?? "0");
    if (result !== 0) return result;
  }
  return 0;
}

function hasError(inventory: SiteInventory, source: CollectionSource): boolean {
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
  if (before.status === after.status) return null;
  if (!known.includes(before.status) || !known.includes(after.status)) return null;

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

  const oldItems = new Map<string, ComparableItem>();
  for (const item of before) oldItems.set(item.identifier, item);

  const newIds = new Set<string>();
  for (const item of after) newIds.add(item.identifier);

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

function coreChange(before: SiteInventory, after: SiteInventory): Change | null {
  const oldVersion = before.core.installedVersion;
  const newVersion = after.core.installedVersion;
  if (oldVersion === null || newVersion === null) return null;

  const order = compareVersions(oldVersion, newVersion);
  if (order === 0) return null;

  return {
    itemType: "core",
    identifier: "wordpress",
    name: "WordPress",
    kind: order < 0 ? "updated" : "downgraded",
    before: oldVersion,
    after: newVersion,
  };
}

function comparablePlugins(inventory: SiteInventory, includeExtras: boolean): ComparableItem[] {
  const items: ComparableItem[] = [];
  for (const plugin of inventory.plugins) {
    if (includeExtras || plugin.kind === "plugin") items.push(plugin);
  }
  return items;
}

function comparableThemes(inventory: SiteInventory): ComparableItem[] {
  const items: ComparableItem[] = [];
  for (const theme of inventory.themes) {
    items.push({
      identifier: theme.slug,
      name: theme.name,
      installedVersion: theme.installedVersion,
      status: theme.status,
    });
  }
  return items;
}

function byTypeThenName(a: Change, b: Change): number {
  if (a.itemType !== b.itemType) return ITEM_ORDER[a.itemType] - ITEM_ORDER[b.itemType];
  return a.name.localeCompare(b.name);
}

export function diffInventories(before: SiteInventory, after: SiteInventory): Change[] | null {
  if (before.fetchStatus === "failed" || after.fetchStatus === "failed") return null;

  const changes: Change[] = [];

  const core = coreChange(before, after);
  if (core) changes.push(core);

  const includeExtras = !hasError(before, "status") && !hasError(after, "status");
  changes.push(
    ...compareLists("plugin", comparablePlugins(before, includeExtras), comparablePlugins(after, includeExtras)),
  );

  if (!hasError(before, "themes") && !hasError(after, "themes")) {
    changes.push(...compareLists("theme", comparableThemes(before), comparableThemes(after)));
  }

  changes.sort(byTypeThenName);
  return changes;
}
