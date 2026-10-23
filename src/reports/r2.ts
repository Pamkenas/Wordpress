import type { Content, TableCell, TDocumentDefinitions } from "pdfmake/interfaces.js";
import type { AgencyConfig } from "../agency.ts";
import { formatDateTime, formatPeriod, localDateTime } from "../dates.ts";
import type { Change } from "../diff.ts";
import { effectiveLicenseStatus, type LicenseRecord } from "../licenses.ts";
import type { MaintenanceEntry } from "../maintenance-log.ts";
import {
  componentsOfType,
  unregisteredComponents,
  type ComponentLine,
  type OrphanLicense,
  type SiteReport,
} from "../report-model.ts";
import type { SiteInventory } from "../types.ts";
import {
  ARROW,
  baseDocument,
  COLORS,
  heading,
  keyValues,
  muted,
  nameWithId,
  pageFooter,
  statusColor,
  table,
} from "./pdf.ts";

function updateCell(component: ComponentLine): TableCell {
  if (component.updateAvailable === "yes") {
    return { text: `${component.offeredVersion ?? "new version"} available`, color: COLORS.warning, bold: true };
  }
  if (component.updateAvailable === "no") {
    return { text: "current", color: COLORS.good };
  }
  return {
    stack: [
      { text: "unknown", color: COLORS.warning, bold: true },
      { text: component.updateNote ?? "", color: COLORS.muted, fontSize: 6.5 },
    ],
  };
}

function licenseCell(component: ComponentLine): TableCell {
  if (component.license === "n/a") return { text: "n/a", color: COLORS.muted };

  const lines: Content[] = [{ text: component.license, color: statusColor(component.license), bold: true }];
  const expiry = component.licenseRecord?.expiryDate;
  if (expiry) lines.push({ text: `expiry ${expiry}`, color: COLORS.muted, fontSize: 6.5 });
  return { stack: lines };
}

function versionText(before: string | null, after: string | null): string {
  if (before && after) return `${before} ${ARROW} ${after}`;
  return after ?? before ?? "";
}

function componentRow(component: ComponentLine, withType: boolean): TableCell[] {
  const row: TableCell[] = [nameWithId(component.name, component.identifier)];
  if (withType) row.push(component.kind);
  row.push(
    component.installedVersion ?? "unknown",
    { text: component.status, color: component.status === "active" ? COLORS.text : COLORS.muted },
    updateCell(component),
    licenseCell(component),
  );
  return row;
}

function verifiedText(record: LicenseRecord): string {
  const parts: string[] = [];
  if (record.verificationSource) parts.push(record.verificationSource);
  if (record.verifiedAt) parts.push(record.verifiedAt);
  return parts.length > 0 ? parts.join(", ") : "—";
}

function registerRow(record: LicenseRecord, report: SiteReport): TableCell[] {
  const effective = effectiveLicenseStatus(record, report.asOf);
  let statusText: string = effective;
  if (effective !== record.status) statusText = `${effective} (recorded: ${record.status})`;

  return [
    nameWithId(report.knownNames.get(record.identifier) ?? record.identifier, record.identifier),
    { text: statusText, color: statusColor(effective), bold: true },
    record.expiryDate ?? "—",
    record.vendor || "—",
    record.owner || "—",
    verifiedText(record),
    record.notes,
  ];
}

function changeRow(change: Change): TableCell[] {
  return [
    change.itemType,
    nameWithId(change.name, change.identifier),
    { text: change.kind, bold: true },
    change.before ?? "—",
    change.after ?? "—",
  ];
}

function workRow(entry: MaintenanceEntry, report: SiteReport, confirmed: boolean): TableCell[] {
  const name = report.knownNames.get(entry.component);
  const componentCell: TableCell = name
    ? nameWithId(name, entry.component)
    : { text: entry.component, wordBreak: "break-all" };

  const row: TableCell[] = [
    entry.date,
    entry.action,
    componentCell,
    versionText(entry.versionBefore, entry.versionAfter),
  ];
  if (confirmed) row.push(entry.confirmedBy ?? "", entry.confirmedAt ?? "");
  row.push(entry.notes);
  return row;
}

function orphanProblem(orphan: OrphanLicense): string {
  if (orphan.suggestion) return `Not installed. Did you mean ${orphan.suggestion}?`;
  return "Not installed on this site (removed, or a typo in plugin_identifier).";
}

function changesSection(report: SiteReport): Content[] {
  const intro = muted(
    "Differences between two snapshots show what changed on the site, not who changed it. They are never reported to the client as work performed.",
  );

  if (report.changes === null) {
    let reason = "No comparison: there is no earlier successful snapshot of this site.";
    if (report.components.length === 0) reason = "No comparison: there is no current inventory for this period.";
    return [intro, { text: reason, italics: true, color: COLORS.muted }];
  }

  return [
    intro,
    muted(`Compared ${report.baselineDate} with ${report.currentDate}.`),
    table(
      ["Type", "Component", "Change", "Before", "After"],
      report.changes.map(changeRow),
      [40, "*", 60, 60, 60],
      "No changes detected between the two snapshots.",
    ),
  ];
}

function noInventoryText(report: SiteReport): string {
  if (report.status === "not-collected") {
    return `No snapshot of this site exists for ${report.period}. Run the collector before building reports.`;
  }
  return "The latest collection failed, so no inventory is available. See Collection problems above.";
}

function inventorySections(report: SiteReport): Content[] {
  if (report.components.length === 0) {
    return [heading("Inventory"), { text: noInventoryText(report), italics: true, color: COLORS.bad }];
  }

  const core = componentsOfType(report, "core")[0];
  const plugins = componentsOfType(report, "plugin");
  const themes = componentsOfType(report, "theme");

  const sections: Content[] = [];
  if (core) {
    sections.push(
      heading("WordPress core"),
      keyValues([
        ["Installed", core.installedVersion ?? "unknown"],
        ["Update", updateCell(core) as Content],
        ["Last update check", core.lastCheck ? formatDateTime(core.lastCheck, "en") : "unknown"],
      ]),
    );
  }

  sections.push(
    heading(`Plugins (${plugins.length})`),
    table(
      ["Plugin", "Type", "Version", "Status", "Update", "License"],
      plugins.map((plugin) => componentRow(plugin, true)),
      ["*", 44, 50, 42, 92, 58],
      "No plugins installed.",
    ),
  );

  if (!report.themesCollected) {
    sections.push(heading("Themes"), {
      text: "Themes could not be read in this collection, so they are not listed. See Collection problems above.",
      italics: true,
      color: COLORS.bad,
    });
    return sections;
  }

  sections.push(
    heading(`Themes (${themes.length})`),
    table(
      ["Theme", "Version", "Status", "Update", "License"],
      themes.map((theme) => componentRow(theme, false)),
      ["*", 50, 42, 92, 58],
      "No themes installed.",
    ),
  );
  return sections;
}

function licenseSection(report: SiteReport): Content[] {
  const sections: Content[] = [
    heading("License register"),
    table(
      ["Component", "Status", "Expiry", "Vendor", "Owner", "Verified", "Notes"],
      report.licenses.map((record) => registerRow(record, report)),
      ["*", 62, 52, 58, 44, 70, 80],
      "This site has no entries in the license register.",
    ),
  ];

  const unregistered = unregisteredComponents(report);
  if (unregistered.length > 0) {
    const names = unregistered.map((component) => component.name).join(", ");
    sections.push(muted(`No register entry, license shown as unknown (${unregistered.length}): ${names}.`));
  }

  if (report.orphanLicenses.length > 0) {
    const rows: TableCell[][] = report.orphanLicenses.map((orphan) => [
      { text: orphan.record.identifier, wordBreak: "break-all" },
      orphan.record.status,
      orphanProblem(orphan),
    ]);
    sections.push(
      { text: "Register entries for components that are not installed", bold: true, margin: [0, 6, 0, 4] },
      table(["Register entry", "Status", "Problem"], rows, [150, 60, "*"], ""),
    );
  }
  return sections;
}

function snapshotText(report: SiteReport): string {
  if (!report.current || !report.currentDate) return `none in ${report.period}`;
  return `${report.currentDate} (checked ${formatDateTime(report.current.checkedAt, "en")})`;
}

function errorRows(inventory: SiteInventory): TableCell[][] {
  return inventory.errors.map((error) => [
    error.source,
    error.kind,
    error.httpStatus === null ? "—" : String(error.httpStatus),
    { text: error.message, wordBreak: "break-all" },
  ]);
}

export function buildR2Pdf(report: SiteReport, agency: AgencyConfig, generatedAt: Date): TDocumentDefinitions {
  const current = report.current;
  const content: Content[] = [
    { text: "Site maintenance report", fontSize: 18, bold: true },
    {
      text: `${report.site.siteId} · ${formatPeriod(report.period, "en")}`,
      color: COLORS.muted,
      margin: [0, 2, 0, 4],
    },
    muted(`Generated ${localDateTime(generatedAt)}. Internal report: do not send to the client.`),
    keyValues([
      ["Client", `${report.clientName} (${report.site.clientId})`],
      ["Website", { text: current?.siteUrl ?? report.site.url, wordBreak: "break-all" }],
      ["Snapshot", snapshotText(report)],
      ["Collection status", { text: report.status, color: statusColor(report.status), bold: true }],
      ["Compared with", report.baselineDate ?? "no earlier successful snapshot"],
    ]),
  ];

  if (current && current.errors.length > 0) {
    content.push(
      heading("Collection problems", COLORS.bad),
      table(["Source", "Kind", "HTTP", "Message"], errorRows(current), [44, 60, 30, "*"], ""),
    );
  }

  content.push(
    ...inventorySections(report),
    ...licenseSection(report),
    heading("Detected changes (observations)"),
    ...changesSection(report),
    heading("Confirmed maintenance work"),
    table(
      ["Date", "Action", "Component", "Versions", "Confirmed by", "Confirmed at", "Notes"],
      report.work.map((entry) => workRow(entry, report, true)),
      [48, 44, "*", 56, 54, 56, 74],
      `No confirmed work in ${report.period}.`,
    ),
  );

  if (report.unconfirmedWork.length > 0) {
    content.push(
      heading("Unconfirmed log entries", COLORS.warning),
      muted(
        "These rows have no confirmation_by / confirmation_at yet. They are not shown in the client report until a person confirms them.",
      ),
      table(
        ["Date", "Action", "Component", "Versions", "Notes"],
        report.unconfirmedWork.map((entry) => workRow(entry, report, false)),
        [48, 44, "*", 56, 130],
        "",
      ),
    );
  }

  const doc = baseDocument(`Site maintenance report ${report.site.siteId} ${report.period}`, content);
  const footerText = `${agency.agencyName} · Internal · R2 ${report.site.siteId} ${report.period}`;
  doc.footer = pageFooter(footerText, (page, count) => `Page ${page} of ${count}`);
  return doc;
}
