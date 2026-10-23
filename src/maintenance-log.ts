import { ConfigError } from "./config.ts";
import { readCsvFile, type CsvRow } from "./csv.ts";
import { parseDateInput, parseDateTimeInput } from "./dates.ts";
import { normalizeKeyword, type LoadedFile } from "./licenses.ts";

export const MAINTENANCE_ACTIONS = [
  "update",
  "install",
  "remove",
  "activate",
  "deactivate",
  "configure",
  "backup",
  "security-check",
  "other",
] as const;

export type MaintenanceAction = (typeof MAINTENANCE_ACTIONS)[number];

export interface MaintenanceEntry {
  row: number;
  siteId: string;
  date: string;
  action: MaintenanceAction;
  component: string;
  versionBefore: string | null;
  versionAfter: string | null;
  confirmedBy: string | null;
  confirmedAt: string | null;
  notes: string;
}

export const LOG_COLUMNS = [
  "site_id",
  "date",
  "action",
  "component",
  "version_before",
  "version_after",
  "confirmation_by",
  "confirmation_at",
  "notes",
];

const REQUIRED_COLUMNS = ["site_id", "date", "action", "component", "confirmation_by", "confirmation_at"];

function isAction(value: string): value is MaintenanceAction {
  return (MAINTENANCE_ACTIONS as readonly string[]).includes(value);
}

export function isConfirmed(entry: MaintenanceEntry): boolean {
  return entry.confirmedBy !== null && entry.confirmedAt !== null;
}

export function parseLogRows(
  rows: CsvRow[],
  source: string,
  siteIds: ReadonlySet<string>,
): { entries: MaintenanceEntry[]; warnings: string[] } {
  const entries: MaintenanceEntry[] = [];
  const problems: string[] = [];
  const warnings: string[] = [];

  for (const { row, values } of rows) {
    const at = `row ${row}`;
    const before = problems.length;

    const siteId = values.site_id ?? "";
    const dateText = values.date ?? "";
    const actionText = values.action ?? "";
    const action = normalizeKeyword(actionText);
    const component = values.component ?? "";
    const confirmedBy = values.confirmation_by || null;
    const confirmedAtText = values.confirmation_at ?? "";

    if (!siteId) problems.push(`${at}: site_id is required`);

    const date = parseDateInput(dateText);
    if (!date) problems.push(`${at}: date "${dateText}" is not a date (use YYYY-MM-DD)`);

    if (!isAction(action)) {
      problems.push(`${at}: action "${actionText}" must be one of ${MAINTENANCE_ACTIONS.join(", ")}`);
    }
    if (!component) problems.push(`${at}: component is required`);

    if (Boolean(confirmedBy) !== Boolean(confirmedAtText)) {
      problems.push(`${at}: fill both confirmation_by and confirmation_at to confirm the work, or leave both empty`);
    }

    const confirmedAt = confirmedAtText ? parseDateTimeInput(confirmedAtText) : null;
    if (confirmedAtText && !confirmedAt) {
      problems.push(`${at}: confirmation_at "${confirmedAtText}" is not a date (use YYYY-MM-DD HH:MM)`);
    }
    if (date && confirmedAt && confirmedAt.slice(0, 10) < date) {
      problems.push(`${at}: confirmation_at is before the work date`);
    }

    if (problems.length > before) continue;
    if (!siteIds.has(siteId)) {
      warnings.push(`${source} ${at}: site "${siteId}" is not in clients.json; row ignored`);
      continue;
    }

    entries.push({
      row,
      siteId,
      date: date as string,
      action: action as MaintenanceAction,
      component,
      versionBefore: values.version_before || null,
      versionAfter: values.version_after || null,
      confirmedBy,
      confirmedAt,
      notes: values.notes ?? "",
    });
  }

  if (problems.length > 0) throw new ConfigError(source, problems);

  entries.sort((a, b) => (a.date === b.date ? a.row - b.row : a.date < b.date ? -1 : 1));
  return { entries, warnings };
}

export async function loadMaintenanceLog(
  path: string,
  siteIds: ReadonlySet<string>,
): Promise<LoadedFile<MaintenanceEntry>> {
  const csv = await readCsvFile(path, LOG_COLUMNS, REQUIRED_COLUMNS);
  if (!csv) {
    return { found: false, items: [], warnings: [`${path} not found: no confirmed maintenance work will be reported`] };
  }

  const { entries, warnings } = parseLogRows(csv.rows, path, siteIds);
  return { found: true, items: entries, warnings: [...csv.warnings, ...warnings] };
}
