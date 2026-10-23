import type { Content, TableCell, TDocumentDefinitions } from "pdfmake/interfaces.js";
import type { AgencyConfig } from "../agency.ts";
import { formatDateTime, formatPeriod, localDateTime } from "../dates.ts";
import type { Change } from "../diff.ts";
import { effectiveLicenseStatus, type LicenseRecord } from "../licenses.ts";
import type { MaintenanceEntry } from "../maintenance-log.ts";
import { unregisteredComponents, type ComponentLine, type SiteReport } from "../report-model.ts";
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
  if (component.updateAvailable === "no") return { text: "current", color: COLORS.good };
  return {
    stack: [
      { text: "unknown", color: COLORS.warning, bold: true },
      { text: component.updateNote ?? "", color: COLORS.muted, fontSize: 6.5 },
    ],
  };
}

function licenseCell(component: ComponentLine): TableCell {
  if (component.license === "n/a") return { text: "n/a", color: COLORS.muted };
  const expiry = component.licenseRecord?.expiryDate;
  return {
    stack: [
      { text: component.license, color: statusColor(component.license), bold: true },
      ...(expiry ? [{ text: `expiry ${expiry}`, color: COLORS.muted, fontSize: 6.5 }] : []),
    ],
  };
}

function versionText(before: string | null, after: string | null): string {
  if (before && after) return `${before} ${ARROW} ${after}`;
  return after ?? before ?? "";
}

function componentRows(components: ComponentLine[], withType: boolean): TableCell[][] {
  return components.map((component) => {
    const row: TableCell[] = [nameWithId(component.name, component.identifier)];
    if (withType) row.push(component.kind);
    row.push(
      component.installedVersion ?? "unknown",
      { text: component.status, color: component.status === "active" ? COLORS.text : COLORS.muted },
      updateCell(component),
      licenseCell(component),
    );
    return row;
  });
}

function registerRows(report: SiteReport): TableCell[][] {
  return report.licenses.map((record: LicenseRecord) => {
    const effective = effectiveLicenseStatus(record, report.asOf);
    const statusText = effective === record.status ? effective : `${effective} (recorded: ${record.status})`;
    const verified = [record.verificationSource, record.verifiedAt].filter(Boolean).join(", ");
    return [
      nameWithId(report.knownNames.get(record.identifier) ?? record.identifier, record.identifier),
      { text: statusText, color: statusColor(effective), bold: true },
      record.expiryDate ?? "—",
      record.vendor || "—",
      record.owner || "—",
      verified || "—",
      record.notes,
    ];
  });
}

function changeRows(changes: Change[]): TableCell[][] {
  return changes.map((change) => [
    change.itemType,
    nameWithId(change.name, change.identifier),
    { text: change.kind, bold: true },
    change.before ?? "—",
    change.after ?? "—",
  ]);
}

function workRows(entries: MaintenanceEntry[], report: SiteReport, confirmed: boolean): TableCell[][] {
  return entries.map((entry) => {
    const name = report.knownNames.get(entry.component);
    const row: TableCell[] = [
      entry.date,
      entry.action,
      name ? nameWithId(name, entry.component) : { text: entry.component, wordBreak: "break-all" },
      versionText(entry.versionBefore, entry.versionAfter),
    ];
    if (confirmed) row.push(entry.confirmedBy ?? "", entry.confirmedAt ?? "");
    row.push(entry.notes);
    return row;
  });
}

function changesSection(report: SiteReport): Content[] {
  const intro = muted(
    "Differences between two snapshots show what changed on the site, not who changed it. They are never reported to the client as work performed.",
  );

  if (report.changes === null) {
    const reason =
      report.components.length === 0
        ? "No comparison: there is no current inventory for this period."
        : "No comparison: there is no earlier successful snapshot of this site.";
    return [intro, { text: reason, italics: true, color: COLORS.muted }];
  }

  return [
    intro,
    muted(`Compared ${report.baselineDate} with ${report.currentDate}.`),
    table(
      ["Type", "Component", "Change", "Before", "After"],
      changeRows(report.changes),
      [40, "*", 60, 60, 60],
      "No changes detected between the two snapshots.",
    ),
  ];
}

function inventorySections(report: SiteReport): Content[] {
  if (report.components.length === 0) {
    const text =
      report.status === "not-collected"
        ? `No snapshot of this site exists for ${report.period}. Run the collector before building reports.`
        : "The latest collection failed, so no inventory is available. See Collection problems above.";
    return [heading("Inventory"), { text, italics: true, color: COLORS.bad }];
  }

  const core = report.components.find((component) => component.itemType === "core");
  const plugins = report.components.filter((component) => component.itemType === "plugin");
  const themes = report.components.filter((component) => component.itemType === "theme");

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
      componentRows(plugins, true),
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
      componentRows(themes, false),
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
      registerRows(report),
      ["*", 62, 52, 58, 44, 70, 80],
      "This site has no entries in the license register.",
    ),
  ];

  const unregistered = unregisteredComponents(report);
  if (unregistered.length > 0) {
    sections.push(
      muted(
        `No register entry, license shown as unknown (${unregistered.length}): ${unregistered.map((c) => c.name).join(", ")}.`,
      ),
    );
  }

  if (report.orphanLicenses.length > 0) {
    sections.push(
      { text: "Register entries for components that are not installed", bold: true, margin: [0, 6, 0, 4] },
      table(
        ["Register entry", "Status", "Problem"],
        report.orphanLicenses.map((orphan) => [
          { text: orphan.record.identifier, wordBreak: "break-all" },
          orphan.record.status,
          orphan.suggestion
            ? `Not installed. Did you mean ${orphan.suggestion}?`
            : "Not installed on this site (removed, or a typo in plugin_identifier).",
        ]),
        [150, 60, "*"],
        "",
      ),
    );
  }
  return sections;
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
      [
        "Snapshot",
        current && report.currentDate
          ? `${report.currentDate} (checked ${formatDateTime(current.checkedAt, "en")})`
          : `none in ${report.period}`,
      ],
      ["Collection status", { text: report.status, color: statusColor(report.status), bold: true }],
      ["Compared with", report.baselineDate ?? "no earlier successful snapshot"],
    ]),
  ];

  if (current && current.errors.length > 0) {
    content.push(
      heading("Collection problems", COLORS.bad),
      table(
        ["Source", "Kind", "HTTP", "Message"],
        current.errors.map((error) => [
          error.source,
          error.kind,
          error.httpStatus === null ? "—" : String(error.httpStatus),
          { text: error.message, wordBreak: "break-all" },
        ]),
        [44, 60, 30, "*"],
        "",
      ),
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
      workRows(report.work, report, true),
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
        workRows(report.unconfirmedWork, report, false),
        [48, 44, "*", 56, 130],
        "",
      ),
    );
  }

  const doc = baseDocument(`Site maintenance report ${report.site.siteId} ${report.period}`, content);
  doc.footer = pageFooter(
    `${agency.agencyName} · Internal · R2 ${report.site.siteId} ${report.period}`,
    (page, count) => `Page ${page} of ${count}`,
  );
  return doc;
}
