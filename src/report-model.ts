import type { SiteConfig } from "./config.ts";
import { isInPeriod, periodEnd } from "./dates.ts";
import { diffInventories, type Change, type ItemType } from "./diff.ts";
import { effectiveLicenseStatus, type LicenseRecord, type LicenseStatus } from "./licenses.ts";
import { isConfirmed, type MaintenanceEntry } from "./maintenance-log.ts";
import type { SnapshotPair } from "./snapshot.ts";
import type { FetchStatus, PluginInventory, SiteInventory, ThemeInventory, VerificationStatus } from "./types.ts";

export type SiteStatus = FetchStatus | "not-collected";

export interface ComponentLine {
  itemType: ItemType;
  identifier: string;
  name: string;
  kind: string;
  installedVersion: string | null;
  status: string;
  updateAvailable: VerificationStatus;
  offeredVersion: string | null;
  updateNote: string | null;
  source: string;
  lastCheck: string | null;
  license: LicenseStatus | "n/a";
  licenseRecord: LicenseRecord | null;
}

export interface OrphanLicense {
  record: LicenseRecord;
  suggestion: string | null;
}

export interface ReportProblem {
  siteId: string;
  message: string;
}

export interface SiteReport {
  site: SiteConfig;
  clientName: string;
  period: string;
  status: SiteStatus;
  asOf: string;
  current: SiteInventory | null;
  currentDate: string | null;
  baselineDate: string | null;
  components: ComponentLine[];
  themesCollected: boolean;
  changes: Change[] | null;
  licenses: LicenseRecord[];
  orphanLicenses: OrphanLicense[];
  work: MaintenanceEntry[];
  unconfirmedWork: MaintenanceEntry[];
  knownNames: Map<string, string>;
}

export interface SiteSummary {
  siteId: string;
  clientId: string;
  status: SiteStatus;
  snapshotDate: string | null;
  baselineDate: string | null;
  plugins: number;
  themes: number;
  updatesAvailable: number;
  unknownUpdateStates: number;
  licenseIssues: number;
  licenseUnknown: number;
  changes: number | null;
  confirmedWork: number;
  unconfirmedWork: number;
}

function coreLine(inventory: SiteInventory): ComponentLine {
  const core = inventory.core;
  return {
    itemType: "core",
    identifier: "wordpress",
    name: "WordPress",
    kind: "core",
    installedVersion: core.installedVersion,
    status: "active",
    updateAvailable: core.updateAvailable,
    offeredVersion: core.availableVersion,
    updateNote: core.updateNote,
    source: core.source,
    lastCheck: core.lastCheck,
    license: "n/a",
    licenseRecord: null,
  };
}

function pluginLine(plugin: PluginInventory, record: LicenseRecord | undefined, asOf: string): ComponentLine {
  return {
    itemType: "plugin",
    identifier: plugin.identifier,
    name: plugin.name,
    kind: plugin.kind,
    installedVersion: plugin.installedVersion,
    status: plugin.status,
    updateAvailable: plugin.updateAvailable,
    offeredVersion: plugin.offeredVersion,
    updateNote: plugin.updateNote,
    source: plugin.source,
    lastCheck: plugin.lastCheck,
    license: effectiveLicenseStatus(record, asOf),
    licenseRecord: record ?? null,
  };
}

function themeLine(theme: ThemeInventory, record: LicenseRecord | undefined, asOf: string): ComponentLine {
  return {
    itemType: "theme",
    identifier: theme.slug,
    name: theme.name,
    kind: "theme",
    installedVersion: theme.installedVersion,
    status: theme.status,
    updateAvailable: theme.updateAvailable,
    offeredVersion: theme.offeredVersion,
    updateNote: theme.updateNote,
    source: theme.source,
    lastCheck: theme.lastCheck,
    license: effectiveLicenseStatus(record, asOf),
    licenseRecord: record ?? null,
  };
}

function buildComponents(
  inventory: SiteInventory,
  licenses: Map<string, LicenseRecord>,
  asOf: string,
): ComponentLine[] {
  const lines: ComponentLine[] = [coreLine(inventory)];
  for (const plugin of inventory.plugins) {
    lines.push(pluginLine(plugin, licenses.get(plugin.identifier), asOf));
  }
  for (const theme of inventory.themes) {
    lines.push(themeLine(theme, licenses.get(theme.slug), asOf));
  }
  return lines;
}

function suggestIdentifier(identifier: string, components: ComponentLine[]): string | null {
  for (const component of components) {
    if (component.identifier.startsWith(`${identifier}/`) || component.identifier === `${identifier}.php`) {
      return component.identifier;
    }
  }
  return null;
}

function findOrphans(records: LicenseRecord[], components: ComponentLine[]): OrphanLicense[] {
  const installed = new Set<string>();
  for (const component of components) installed.add(component.identifier);

  const orphans: OrphanLicense[] = [];
  for (const record of records) {
    if (installed.has(record.identifier)) continue;
    orphans.push({ record, suggestion: suggestIdentifier(record.identifier, components) });
  }
  return orphans;
}

function addNames(inventory: SiteInventory | null, names: Map<string, string>): void {
  if (!inventory) return;
  for (const plugin of inventory.plugins) names.set(plugin.identifier, plugin.name);
  for (const theme of inventory.themes) names.set(theme.slug, theme.name);
}

export function buildSiteReport(
  site: SiteConfig,
  period: string,
  pair: SnapshotPair,
  licenses: readonly LicenseRecord[],
  log: readonly MaintenanceEntry[],
): SiteReport {
  const asOf = pair.currentDate ?? periodEnd(period);

  const siteLicenses = licenses.filter((record) => record.siteId === site.siteId);
  const licenseMap = new Map<string, LicenseRecord>();
  for (const record of siteLicenses) licenseMap.set(record.identifier, record);

  let inventory: SiteInventory | null = null;
  if (pair.current && pair.current.fetchStatus !== "failed") inventory = pair.current;

  const components = inventory ? buildComponents(inventory, licenseMap, asOf) : [];
  const orphanLicenses = inventory ? findOrphans(siteLicenses, components) : [];
  const themesCollected = inventory !== null && !inventory.errors.some((error) => error.source === "themes");

  const knownNames = new Map<string, string>();
  addNames(pair.baseline, knownNames);
  addNames(pair.current, knownNames);

  const work: MaintenanceEntry[] = [];
  const unconfirmedWork: MaintenanceEntry[] = [];
  for (const entry of log) {
    if (entry.siteId !== site.siteId || !isInPeriod(entry.date, period)) continue;
    if (isConfirmed(entry)) work.push(entry);
    else unconfirmedWork.push(entry);
  }

  let changes: Change[] | null = null;
  if (pair.current && pair.baseline) changes = diffInventories(pair.baseline, pair.current);

  return {
    site,
    clientName: site.clientName ?? site.clientId,
    period,
    status: pair.current ? pair.current.fetchStatus : "not-collected",
    asOf,
    current: pair.current,
    currentDate: pair.currentDate,
    baselineDate: pair.baselineDate,
    components,
    themesCollected,
    changes,
    licenses: siteLicenses,
    orphanLicenses,
    work,
    unconfirmedWork,
    knownNames,
  };
}

export function pendingUpdates(report: SiteReport): ComponentLine[] {
  return report.components.filter((component) => component.updateAvailable === "yes");
}

export function unknownUpdates(report: SiteReport): ComponentLine[] {
  return report.components.filter((component) => component.updateAvailable === "unknown");
}

export function licenseProblems(report: SiteReport): ComponentLine[] {
  return report.components.filter((component) => component.license === "expired" || component.license === "missing");
}

export function unregisteredComponents(report: SiteReport): ComponentLine[] {
  return report.components.filter((component) => component.itemType !== "core" && component.licenseRecord === null);
}

export function componentsOfType(report: SiteReport, itemType: ItemType): ComponentLine[] {
  return report.components.filter((component) => component.itemType === itemType);
}

export function displayName(report: SiteReport, component: string): string {
  const key = component.trim();
  const lower = key.toLowerCase();
  if (lower === "core" || lower === "wordpress" || lower === "wordpress core") return "WordPress";
  return report.knownNames.get(key) ?? key;
}

export function summarizeReport(report: SiteReport): SiteSummary {
  const unknownLicenses = report.components.filter((component) => component.license === "unknown");
  return {
    siteId: report.site.siteId,
    clientId: report.site.clientId,
    status: report.status,
    snapshotDate: report.currentDate,
    baselineDate: report.baselineDate,
    plugins: componentsOfType(report, "plugin").length,
    themes: componentsOfType(report, "theme").length,
    updatesAvailable: pendingUpdates(report).length,
    unknownUpdateStates: unknownUpdates(report).length,
    licenseIssues: licenseProblems(report).length,
    licenseUnknown: unknownLicenses.length,
    changes: report.changes ? report.changes.length : null,
    confirmedWork: report.work.length,
    unconfirmedWork: report.unconfirmedWork.length,
  };
}
