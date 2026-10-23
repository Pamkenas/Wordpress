import type { Content, TableCell, TDocumentDefinitions } from "pdfmake/interfaces.js";
import type { AgencyConfig } from "../agency.ts";
import { formatDate, formatDateTime, formatPeriod } from "../dates.ts";
import type { MaintenanceEntry } from "../maintenance-log.ts";
import {
  displayName,
  licenseProblems,
  pendingUpdates,
  unknownUpdates,
  type ComponentLine,
  type SiteReport,
} from "../report-model.ts";
import { ARROW, baseDocument, COLORS, keyValues, pageFooter, table } from "./pdf.ts";
import { CLIENT_TEXT, type ClientText } from "./text.ts";

const MAX_NAMES = 8;

function describeWork(entry: MaintenanceEntry, report: SiteReport, text: ClientText): string {
  const name = displayName(report, entry.component);
  let versions = "";
  if (entry.versionBefore && entry.versionAfter) {
    versions = ` (${entry.versionBefore} ${ARROW} ${entry.versionAfter})`;
  } else if (entry.versionAfter || entry.versionBefore) {
    versions = ` (${entry.versionAfter ?? entry.versionBefore})`;
  }
  return `${text.actions[entry.action]}: ${name}${versions}`;
}

function nameList(components: ComponentLine[], text: ClientText): string {
  const names = components.map((component) => component.name);
  const shown = names.slice(0, MAX_NAMES).join(", ");
  const rest = names.length - MAX_NAMES;
  return rest > 0 ? `${shown}, ${text.andMore(rest)}` : shown;
}

function issues(report: SiteReport, text: ClientText): string[] {
  if (report.components.length === 0) return [text.checkFailed];

  const list: string[] = [];
  const pending = pendingUpdates(report);
  const core = pending.find((component) => component.itemType === "core");
  const others = pending.filter((component) => component.itemType !== "core");

  if (core) list.push(text.coreUpdate(core.offeredVersion ?? "?"));
  if (others.length > 0) list.push(text.pendingUpdates(others.length, nameList(others, text)));

  const unknown = unknownUpdates(report);
  if (unknown.length > 0) list.push(text.manualItems(unknown.length));

  for (const component of licenseProblems(report)) {
    const status = component.license === "expired" ? text.licenseStatus.expired : text.licenseStatus.missing;
    list.push(text.license(component.name, status));
  }
  return list;
}

function statusSection(report: SiteReport, text: ClientText, agency: AgencyConfig): Content[] {
  const current = report.current;
  if (report.components.length === 0 || !current) {
    return [{ text: text.statusUnavailable, margin: [0, 0, 0, 4] }];
  }

  const core = report.components.find((component) => component.itemType === "core");
  const plugins = report.components.filter((component) => component.itemType === "plugin");
  const themes = report.components.filter((component) => component.itemType === "theme");
  const activePlugins = plugins.filter((plugin) => plugin.status === "active").length;

  const section: Content[] = [
    keyValues([
      [text.checkedOn, formatDateTime(current.checkedAt, agency.language)],
      [text.wordpress, core?.installedVersion ?? "—"],
      [text.plugins, `${plugins.length} (${text.active}: ${activePlugins})`],
      [text.themes, report.themesCollected ? String(themes.length) : "—"],
      [text.updates, String(pendingUpdates(report).length)],
      [text.manualCheck, String(unknownUpdates(report).length)],
    ]),
  ];
  if (report.status === "partial") section.push({ text: text.partialNote, italics: true, color: COLORS.muted });
  return section;
}

export function buildR3Pdf(report: SiteReport, agency: AgencyConfig, logo: string | null): TDocumentDefinitions {
  const text = CLIENT_TEXT[agency.language];
  const language = agency.language;
  const brand = agency.primaryColor;
  const period = formatPeriod(report.period, language);
  const sectionTitle = (title: string): Content => ({
    text: title,
    fontSize: 12,
    bold: true,
    color: brand,
    margin: [0, 16, 0, 6],
    headlineLevel: 1,
  });

  const workRows: TableCell[][] = report.work.map((entry) => [
    formatDate(entry.date, language),
    describeWork(entry, report, text),
  ]);

  const issueList = issues(report, text);

  const content: Content[] = [
    {
      columns: [
        logo ? { image: "logo", fit: [150, 46] } : { text: agency.agencyName, fontSize: 15, bold: true, color: brand },
        { text: period, alignment: "right", color: COLORS.muted, margin: [0, 6, 0, 0] },
      ],
    },
    { text: text.title, fontSize: 20, bold: true, color: brand, margin: [0, 20, 0, 10] },
    keyValues([
      [text.client, report.clientName],
      [text.website, { text: report.site.url, wordBreak: "break-all" }],
      [text.period, period],
    ]),
    { text: text.intro, margin: [0, 2, 0, 0] },

    sectionTitle(text.workTitle),
    table([text.workDate, text.workDone], workRows, [80, "*"], text.noWork),

    sectionTitle(text.statusTitle),
    ...statusSection(report, text, agency),

    sectionTitle(text.issuesTitle),
    issueList.length > 0 ? { ul: issueList, margin: [0, 0, 0, 4] } : { text: text.noIssues },
  ];

  if (agency.contactEmail) {
    content.push({ text: text.contact(agency.contactEmail), margin: [0, 20, 0, 0], color: COLORS.muted });
  }

  const doc = baseDocument(`${text.title} ${report.site.siteId} ${report.period}`, content);
  doc.background = (_page, size) => ({
    canvas: [{ type: "rect", x: 0, y: 0, w: size.width, h: 6, color: brand }],
  });
  doc.footer = pageFooter(agency.website ? `${agency.agencyName} · ${agency.website}` : agency.agencyName, text.page);
  if (logo) doc.images = { logo };
  return doc;
}
