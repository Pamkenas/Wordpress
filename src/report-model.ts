import type { SiteConfig } from "./config.ts";
import { isInPeriod, periodEnd } from "./dates.ts";
import { diffInventories, type Change, type ItemType } from "./diff.ts";
import { effectiveLicenseStatus, type LicenseRecord, type LicenseStatus } from "./licenses.ts";
import { isConfirmed, type MaintenanceEntry } from "./maintenance-log.ts";
import type { SnapshotPair } from "./snapshot.ts";
import type { FetchStatus, SiteInventory, VerificationStatus } from "./types.ts";

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

function buildComponents(
  inventory: SiteInventory,
  licenses: Map<string, LicenseRecord>,
  asOf: string,
): ComponentLine[] {
  const { core } = inventory;
  const lines: ComponentLine[] = [
    {
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
    },
  ];

  for (const plugin of inventory.plugins) {
    const record = licenses.get(plugin.identifier);
    lines.push({
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
    });
  }

  for (const theme of inventory.themes) {
    const record = licenses.get(theme.slug);
    lines.push({
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
    });
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

function namesOf(inventory: SiteInventory | null, names: Map<string, string>): void {
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
  const licenseMap = new Map(siteLicenses.map((record) => [record.identifier, record]));

  const inventory = pair.current && pair.current.fetchStatus !== "failed" ? pair.current : null;
  const components = inventory ? buildComponents(inventory, licenseMap, asOf) : [];

  const installed = new Set(components.map((component) => component.identifier));
  const orphanLicenses: OrphanLicense[] = [];
  if (inventory) {
    for (const record of siteLicenses) {
      if (installed.has(record.identifier)) continue;
      orphanLicenses.push({ record, suggestion: suggestIdentifier(record.identifier, components) });
    }
  }

  const knownNames = new Map<string, string>();
  namesOf(pair.baseline, knownNames);
  namesOf(pair.current, knownNames);

  const siteLog = log.filter((entry) => entry.siteId === site.siteId && isInPeriod(entry.date, period));

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
    themesCollected: inventory !== null && !inventory.errors.some((error) => error.source === "themes"),
    changes: pair.current && pair.baseline ? diffInventories(pair.baseline, pair.current) : null,
    licenses: siteLicenses,
    orphanLicenses,
    work: siteLog.filter((entry) => isConfirmed(entry)),
    unconfirmedWork: siteLog.filter((entry) => !isConfirmed(entry)),
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

export function displayName(report: SiteReport, component: string): string {
  const key = component.trim();
  if (["core", "wordpress", "wordpress core"].includes(key.toLowerCase())) return "WordPress";
  return report.knownNames.get(key) ?? key;
}

export function summarizeReport(report: SiteReport): SiteSummary {
  return {
    siteId: report.site.siteId,
    clientId: report.site.clientId,
    status: report.status,
    snapshotDate: report.currentDate,
    baselineDate: report.baselineDate,
    plugins: report.components.filter((component) => component.itemType === "plugin").length,
    themes: report.components.filter((component) => component.itemType === "theme").length,
    updatesAvailable: pendingUpdates(report).length,
    unknownUpdateStates: unknownUpdates(report).length,
    licenseIssues: licenseProblems(report).length,
    licenseUnknown: report.components.filter((component) => component.license === "unknown").length,
    changes: report.changes ? report.changes.length : null,
    confirmedWork: report.work.length,
    unconfirmedWork: report.unconfirmedWork.length,
  };
}
