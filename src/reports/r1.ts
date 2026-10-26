import type { Content, Size, TableCell, TDocumentDefinitions } from "pdfmake/interfaces.js";
import type { AgencyConfig } from "../agency.ts";
import { toCsv } from "../csv.ts";
import { formatPeriod, localDateTime } from "../dates.ts";
import {
  licenseProblems,
  pendingUpdates,
  summarizeReport,
  type ComponentLine,
  type ReportProblem,
  type SiteReport,
  type SiteSummary,
} from "../report-model.ts";
import type { VerificationStatus } from "../types.ts";
import { ARROW, baseDocument, COLORS, heading, muted, nameWithId, pageFooter, statusColor, table } from "./pdf.ts";

export const R1_COLUMNS = [
  "client_id",
  "site_id",
  "site_url",
  "checked_at",
  "fetch_status",
  "item_type",
  "identifier",
  "name",
  "installed_version",
  "status",
  "update_available",
  "offered_version",
  "license_status",
  "update_source",
  "last_check",
  "note",
];

const OVERVIEW_HEADERS = [
  "Sites",
  "Success",
  "Partial",
  "Failed",
  "Not collected",
  "Updates",
  "Unknown updates",
  "License issues",
  "License unknown",
];

const OVERVIEW_WIDTHS: Size[] = ["*", "*", "*", "*", "*", "*", "*", "*", "*"];

const SITE_HEADERS = [
  "Site",
  "Client",
  "Snapshot",
  "Status",
  "WordPress",
  "Plugins",
  "Themes",
  "Updates",
  "Unknown",
  "License issues",
  "Changes",
  "Work",
];

const SITE_WIDTHS: Size[] = ["*", 90, 52, 46, 70, 36, 36, 38, 40, 40, 40, 62];

interface UpdateGroup {
  name: string;
  identifier: string;
  type: string;
  sites: string[];
  offered: string[];
}

interface Totals {
  updates: number;
  unknownUpdates: number;
  licenseIssues: number;
  licenseUnknown: number;
}

function csvUpdateWord(state: VerificationStatus): string {
  if (state === "yes") return "true";
  if (state === "no") return "false";
  return "unknown";
}

function csvRow(values: Record<string, string | null>): string[] {
  const row: string[] = [];
  for (const column of R1_COLUMNS) row.push(values[column] ?? "");
  return row;
}

function siteProblem(report: SiteReport): string {
  if (report.status === "not-collected") return `no snapshot in ${report.period}`;
  return report.current?.error ?? "no inventory";
}

function componentCsvRow(siteValues: Record<string, string>, component: ComponentLine): string[] {
  return csvRow({
    ...siteValues,
    item_type: component.itemType === "plugin" ? component.kind : component.itemType,
    identifier: component.identifier,
    name: component.name,
    installed_version: component.installedVersion,
    status: component.status,
    update_available: csvUpdateWord(component.updateAvailable),
    offered_version: component.offeredVersion,
    license_status: component.license,
    update_source: component.source,
    last_check: component.lastCheck,
    note: component.updateNote,
  });
}

export function buildR1Csv(reports: readonly SiteReport[], agency: AgencyConfig): string {
  const rows: string[][] = [R1_COLUMNS];

  for (const report of reports) {
    const siteValues = {
      client_id: report.site.clientId,
      site_id: report.site.siteId,
      site_url: report.current?.siteUrl ?? report.site.url,
      checked_at: report.current?.checkedAt ?? "",
      fetch_status: report.status,
    };

    if (report.components.length === 0) {
      rows.push(csvRow({ ...siteValues, item_type: "site", note: siteProblem(report) }));
      continue;
    }

    for (const component of report.components) {
      rows.push(componentCsvRow(siteValues, component));
    }
  }

  return toCsv(rows, agency.csvDelimiter);
}

function coreCell(report: SiteReport): TableCell {
  const core = report.components.find((component) => component.itemType === "core");
  if (!core) return "—";

  const installed = core.installedVersion ?? "unknown";
  if (core.updateAvailable !== "yes") return installed;
  return { text: `${installed} ${ARROW} ${core.offeredVersion ?? "?"}`, color: COLORS.warning, bold: true };
}

function countText(hasInventory: boolean, value: number): string {
  return hasInventory ? String(value) : "—";
}

function workText(summary: SiteSummary): string {
  if (summary.unconfirmedWork === 0) return String(summary.confirmedWork);
  return `${summary.confirmedWork} (+${summary.unconfirmedWork} unconfirmed)`;
}

function siteRow(report: SiteReport): TableCell[] {
  const summary = summarizeReport(report);
  const hasInventory = report.components.length > 0;
  const updatesColor = summary.updatesAvailable > 0 ? COLORS.warning : COLORS.text;
  const licenseColor = summary.licenseIssues > 0 ? COLORS.bad : COLORS.text;

  return [
    nameWithId(report.site.siteId, report.current?.siteUrl ?? report.site.url),
    report.clientName,
    report.currentDate ?? "—",
    { text: report.status, color: statusColor(report.status), bold: true },
    coreCell(report),
    countText(hasInventory, summary.plugins),
    report.themesCollected ? String(summary.themes) : "—",
    { text: countText(hasInventory, summary.updatesAvailable), color: updatesColor },
    countText(hasInventory, summary.unknownUpdateStates),
    { text: countText(hasInventory, summary.licenseIssues), color: licenseColor },
    summary.changes === null ? "—" : String(summary.changes),
    workText(summary),
  ];
}

function byMostSitesThenName(a: UpdateGroup, b: UpdateGroup): number {
  if (a.sites.length !== b.sites.length) return b.sites.length - a.sites.length;
  return a.name.localeCompare(b.name);
}

function pendingUpdateRows(reports: readonly SiteReport[]): TableCell[][] {
  const groups = new Map<string, UpdateGroup>();

  for (const report of reports) {
    for (const component of pendingUpdates(report)) {
      const key = `${component.itemType}|${component.identifier}`;
      let group = groups.get(key);
      if (!group) {
        group = {
          name: component.name,
          identifier: component.identifier,
          type: component.kind,
          sites: [],
          offered: [],
        };
        groups.set(key, group);
      }
      group.sites.push(report.site.siteId);
      if (component.offeredVersion && !group.offered.includes(component.offeredVersion)) {
        group.offered.push(component.offeredVersion);
      }
    }
  }

  const sorted = [...groups.values()].sort(byMostSitesThenName);
  return sorted.map((group) => [
    nameWithId(group.name, group.identifier),
    group.type,
    `${group.sites.length}: ${group.sites.join(", ")}`,
    group.offered.join(", "),
  ]);
}

function licenseRows(reports: readonly SiteReport[]): TableCell[][] {
  const rows: TableCell[][] = [];
  for (const report of reports) {
    for (const component of licenseProblems(report)) {
      rows.push([
        report.site.siteId,
        nameWithId(component.name, component.identifier),
        { text: component.license, color: statusColor(component.license), bold: true },
        component.licenseRecord?.expiryDate ?? "—",
        component.licenseRecord?.owner || "—",
      ]);
    }
  }
  return rows;
}

function problemRows(reports: readonly SiteReport[]): TableCell[][] {
  const rows: TableCell[][] = [];
  for (const report of reports) {
    if (report.status === "success") continue;
    rows.push([
      report.site.siteId,
      { text: report.status, color: statusColor(report.status), bold: true },
      { text: siteProblem(report), wordBreak: "break-all" },
    ]);
  }
  return rows;
}

function countStatus(summaries: SiteSummary[], status: string): number {
  return summaries.filter((summary) => summary.status === status).length;
}

function totalsOf(summaries: SiteSummary[]): Totals {
  const totals: Totals = { updates: 0, unknownUpdates: 0, licenseIssues: 0, licenseUnknown: 0 };
  for (const summary of summaries) {
    totals.updates += summary.updatesAvailable;
    totals.unknownUpdates += summary.unknownUpdateStates;
    totals.licenseIssues += summary.licenseIssues;
    totals.licenseUnknown += summary.licenseUnknown;
  }
  return totals;
}

function countCell(value: number, color: string): TableCell {
  return { text: String(value), color: value > 0 ? color : COLORS.text };
}

function overviewRow(reports: readonly SiteReport[], summaries: SiteSummary[], totals: Totals): TableCell[] {
  return [
    String(reports.length),
    countCell(countStatus(summaries, "success"), COLORS.good),
    countCell(countStatus(summaries, "partial"), COLORS.warning),
    countCell(countStatus(summaries, "failed"), COLORS.bad),
    countCell(countStatus(summaries, "not-collected"), COLORS.bad),
    String(totals.updates),
    String(totals.unknownUpdates),
    String(totals.licenseIssues),
    String(totals.licenseUnknown),
  ];
}

export function buildR1Pdf(
  period: string,
  reports: readonly SiteReport[],
  agency: AgencyConfig,
  generatedAt: Date,
  problems: readonly ReportProblem[],
): TDocumentDefinitions {
  const summaries = reports.map(summarizeReport);
  const totals = totalsOf(summaries);
  const overview = [overviewRow(reports, summaries, totals)];

  const content: Content[] = [
    { text: "Consolidated maintenance report", fontSize: 18, bold: true },
    { text: `${formatPeriod(period, "en")} · ${agency.agencyName}`, color: COLORS.muted, margin: [0, 2, 0, 4] },
    muted(`Generated ${localDateTime(generatedAt)}. Internal report with client data: do not send to clients.`),

    heading("Overview"),
    table(OVERVIEW_HEADERS, overview, OVERVIEW_WIDTHS, "No sites configured."),

    heading("Sites"),
    table(SITE_HEADERS, reports.map(siteRow), SITE_WIDTHS, "No sites configured."),
    muted(
      "Updates and unknown counts include WordPress core. Changes are observations between snapshots, not confirmed work.",
    ),

    heading("Collection problems"),
    table(["Site", "Status", "Problem"], problemRows(reports), [110, 60, "*"], "Every site was collected completely."),

    heading("Pending updates across sites"),
    table(
      ["Component", "Type", "Sites", "Offered version"],
      pendingUpdateRows(reports),
      ["*", 60, 220, 90],
      "No pending updates.",
    ),

    heading("License attention"),
    table(
      ["Site", "Component", "Status", "Expiry", "Owner"],
      licenseRows(reports),
      [110, "*", 60, 70, 90],
      "No expired or missing licenses.",
    ),
    muted(
      `${totals.licenseUnknown} installed plugins and themes have no register entry or an unknown license status (shown as "unknown" in the CSV).`,
    ),
  ];

  if (problems.length > 0) {
    const problemTable = problems.map((problem) => [problem.siteId, problem.message]);
    content.push(heading("Report problems", COLORS.bad), table(["Site", "Problem"], problemTable, [110, "*"], ""));
  }

  const doc = baseDocument(`Consolidated maintenance report ${period}`, content, true);
  doc.footer = pageFooter(
    `${agency.agencyName} · Internal · R1 ${period}`,
    (page, count) => `Page ${page} of ${count}`,
  );
  return doc;
}
