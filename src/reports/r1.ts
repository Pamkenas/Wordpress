import type { Content, TableCell, TDocumentDefinitions } from "pdfmake/interfaces.js";
import type { AgencyConfig } from "../agency.ts";
import { toCsv } from "../csv.ts";
import { formatPeriod, localDateTime } from "../dates.ts";
import { licenseProblems, pendingUpdates, summarizeReport, type SiteReport } from "../report-model.ts";
import { ARROW, baseDocument, COLORS, heading, muted, nameWithId, pageFooter, statusColor, table } from "./pdf.ts";

export interface ReportProblem {
  siteId: string;
  message: string;
}

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

const UPDATE_WORDS = { yes: "true", no: "false", unknown: "unknown" } as const;

function csvRow(values: Record<string, string | null>): string[] {
  return R1_COLUMNS.map((column) => values[column] ?? "");
}

function siteProblem(report: SiteReport): string {
  if (report.status === "not-collected") return `no snapshot in ${report.period}`;
  return report.current?.error ?? "no inventory";
}

export function buildR1Csv(reports: readonly SiteReport[], agency: AgencyConfig): string {
  const rows: string[][] = [R1_COLUMNS];

  for (const report of reports) {
    const site = {
      client_id: report.site.clientId,
      site_id: report.site.siteId,
      site_url: report.current?.siteUrl ?? report.site.url,
      checked_at: report.current?.checkedAt ?? "",
      fetch_status: report.status,
    };

    if (report.components.length === 0) {
      rows.push(csvRow({ ...site, item_type: "site", note: siteProblem(report) }));
      continue;
    }

    for (const component of report.components) {
      rows.push(
        csvRow({
          ...site,
          item_type: component.itemType === "plugin" ? component.kind : component.itemType,
          identifier: component.identifier,
          name: component.name,
          installed_version: component.installedVersion,
          status: component.status,
          update_available: UPDATE_WORDS[component.updateAvailable],
          offered_version: component.offeredVersion,
          license_status: component.license,
          update_source: component.source,
          last_check: component.lastCheck,
          note: component.updateNote,
        }),
      );
    }
  }

  return toCsv(rows, agency.csvDelimiter);
}

function coreCell(report: SiteReport): TableCell {
  const core = report.components.find((component) => component.itemType === "core");
  if (!core) return "—";
  const installed = core.installedVersion ?? "unknown";
  if (core.updateAvailable === "yes") {
    return { text: `${installed} ${ARROW} ${core.offeredVersion ?? "?"}`, color: COLORS.warning, bold: true };
  }
  return installed;
}

function siteRows(reports: readonly SiteReport[]): TableCell[][] {
  return reports.map((report) => {
    const summary = summarizeReport(report);
    const hasInventory = report.components.length > 0;
    const count = (value: number): string => (hasInventory ? String(value) : "—");
    const work =
      summary.unconfirmedWork > 0
        ? `${summary.confirmedWork} (+${summary.unconfirmedWork} unconfirmed)`
        : String(summary.confirmedWork);

    return [
      nameWithId(report.site.siteId, report.current?.siteUrl ?? report.site.url),
      report.clientName,
      report.currentDate ?? "—",
      { text: report.status, color: statusColor(report.status), bold: true },
      coreCell(report),
      count(summary.plugins),
      report.themesCollected ? String(summary.themes) : "—",
      { text: count(summary.updatesAvailable), color: summary.updatesAvailable > 0 ? COLORS.warning : COLORS.text },
      count(summary.unknownUpdateStates),
      { text: count(summary.licenseIssues), color: summary.licenseIssues > 0 ? COLORS.bad : COLORS.text },
      summary.changes === null ? "—" : String(summary.changes),
      work,
    ];
  });
}

function pendingUpdateRows(reports: readonly SiteReport[]): TableCell[][] {
  const groups = new Map<
    string,
    { name: string; identifier: string; type: string; sites: string[]; offered: Set<string> }
  >();

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
          offered: new Set(),
        };
        groups.set(key, group);
      }
      group.sites.push(report.site.siteId);
      if (component.offeredVersion) group.offered.add(component.offeredVersion);
    }
  }

  const sorted = [...groups.values()].sort((a, b) => b.sites.length - a.sites.length || a.name.localeCompare(b.name));
  return sorted.map((group) => [
    nameWithId(group.name, group.identifier),
    group.type,
    `${group.sites.length}: ${group.sites.join(", ")}`,
    [...group.offered].join(", "),
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
  return reports
    .filter((report) => report.status !== "success")
    .map((report) => [
      report.site.siteId,
      { text: report.status, color: statusColor(report.status), bold: true },
      { text: siteProblem(report), wordBreak: "break-all" },
    ]);
}

export function buildR1Pdf(
  period: string,
  reports: readonly SiteReport[],
  agency: AgencyConfig,
  generatedAt: Date,
  problems: readonly ReportProblem[],
): TDocumentDefinitions {
  const summaries = reports.map(summarizeReport);
  const statusCount = (status: string) => summaries.filter((summary) => summary.status === status).length;
  const total = (pick: (summary: (typeof summaries)[number]) => number) =>
    summaries.reduce((sum, summary) => sum + pick(summary), 0);

  const countCell = (value: number, color: string): TableCell => ({
    text: String(value),
    color: value > 0 ? color : COLORS.text,
  });

  const overview: TableCell[][] = [
    [
      String(reports.length),
      countCell(statusCount("success"), COLORS.good),
      countCell(statusCount("partial"), COLORS.warning),
      countCell(statusCount("failed"), COLORS.bad),
      countCell(statusCount("not-collected"), COLORS.bad),
      String(total((summary) => summary.updatesAvailable)),
      String(total((summary) => summary.unknownUpdateStates)),
      String(total((summary) => summary.licenseIssues)),
      String(total((summary) => summary.licenseUnknown)),
    ],
  ];

  const content: Content[] = [
    { text: "Consolidated maintenance report", fontSize: 18, bold: true },
    { text: `${formatPeriod(period, "en")} · ${agency.agencyName}`, color: COLORS.muted, margin: [0, 2, 0, 4] },
    muted(`Generated ${localDateTime(generatedAt)}. Internal report with client data: do not send to clients.`),

    heading("Overview"),
    table(
      [
        "Sites",
        "Success",
        "Partial",
        "Failed",
        "Not collected",
        "Updates",
        "Unknown updates",
        "License issues",
        "License unknown",
      ],
      overview,
      ["*", "*", "*", "*", "*", "*", "*", "*", "*"],
      "No sites configured.",
    ),

    heading("Sites"),
    table(
      [
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
      ],
      siteRows(reports),
      ["*", 90, 52, 46, 70, 36, 36, 38, 40, 40, 40, 62],
      "No sites configured.",
    ),
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
      `${total((summary) => summary.licenseUnknown)} installed plugins and themes have no register entry or an unknown license status (shown as "unknown" in the CSV).`,
    ),
  ];

  if (problems.length > 0) {
    content.push(
      heading("Report problems", COLORS.bad),
      table(
        ["Site", "Problem"],
        problems.map((problem) => [problem.siteId, problem.message]),
        [110, "*"],
        "",
      ),
    );
  }

  const doc = baseDocument(`Consolidated maintenance report ${period}`, content, true);
  doc.footer = pageFooter(
    `${agency.agencyName} · Internal · R1 ${period}`,
    (current, count) => `Page ${current} of ${count}`,
  );
  return doc;
}
