import { ConfigError } from "./config.ts";
import { normalizeKeyword, readCsvFile, type CsvRow } from "./csv.ts";
import { parseDateInput, parseDateTimeInput } from "./dates.ts";

export type MaintenanceAction =
  | "update"
  | "install"
  | "remove"
  | "activate"
  | "deactivate"
  | "configure"
  | "backup"
  | "security-check"
  | "other";

export const MAINTENANCE_ACTIONS: MaintenanceAction[] = [
  "update",
  "install",
  "remove",
  "activate",
  "deactivate",
  "configure",
  "backup",
  "security-check",
  "other",
];

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

export interface LogFile {
  found: boolean;
  entries: MaintenanceEntry[];
  warnings: string[];
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

function toAction(text: string): MaintenanceAction | null {
  const value = normalizeKeyword(text);
  for (const action of MAINTENANCE_ACTIONS) {
    if (action === value) return action;
  }
  return null;
}

export function isConfirmed(entry: MaintenanceEntry): boolean {
  return entry.confirmedBy !== null && entry.confirmedAt !== null;
}

function parseLogRow(csvRow: CsvRow, problems: string[]): MaintenanceEntry | null {
  const { row, values } = csvRow;
  const at = `row ${row}`;
  const problemsBefore = problems.length;

  const siteId = values.site_id ?? "";
  const dateText = values.date ?? "";
  const actionText = values.action ?? "";
  const component = values.component ?? "";
  const confirmedBy = values.confirmation_by || null;
  const confirmedAtText = values.confirmation_at ?? "";

  if (!siteId) problems.push(`${at}: site_id is required`);

  const date = parseDateInput(dateText);
  if (!date) problems.push(`${at}: date "${dateText}" is not a date (use YYYY-MM-DD)`);

  const action = toAction(actionText);
  if (!action) problems.push(`${at}: action "${actionText}" must be one of ${MAINTENANCE_ACTIONS.join(", ")}`);

  if (!component) problems.push(`${at}: component is required`);

  const hasConfirmedBy = confirmedBy !== null;
  const hasConfirmedAt = confirmedAtText !== "";
  if (hasConfirmedBy !== hasConfirmedAt) {
    problems.push(`${at}: fill both confirmation_by and confirmation_at to confirm the work, or leave both empty`);
  }

  const confirmedAt = hasConfirmedAt ? parseDateTimeInput(confirmedAtText) : null;
  if (hasConfirmedAt && !confirmedAt) {
    problems.push(`${at}: confirmation_at "${confirmedAtText}" is not a date (use YYYY-MM-DD HH:MM)`);
  }
  if (date && confirmedAt && confirmedAt.slice(0, 10) < date) {
    problems.push(`${at}: confirmation_at is before the work date`);
  }

  if (problems.length > problemsBefore || !date || !action) return null;

  return {
    row,
    siteId,
    date,
    action,
    component,
    versionBefore: values.version_before || null,
    versionAfter: values.version_after || null,
    confirmedBy,
    confirmedAt,
    notes: values.notes ?? "",
  };
}

function byDateThenRow(a: MaintenanceEntry, b: MaintenanceEntry): number {
  if (a.date < b.date) return -1;
  if (a.date > b.date) return 1;
  return a.row - b.row;
}

export function parseLogRows(
  rows: CsvRow[],
  source: string,
  siteIds: ReadonlySet<string>,
): { entries: MaintenanceEntry[]; warnings: string[] } {
  const entries: MaintenanceEntry[] = [];
  const problems: string[] = [];
  const warnings: string[] = [];

  for (const csvRow of rows) {
    const entry = parseLogRow(csvRow, problems);
    if (!entry) continue;

    if (!siteIds.has(entry.siteId)) {
      warnings.push(`${source} row ${entry.row}: site "${entry.siteId}" is not in clients.json; row ignored`);
      continue;
    }
    entries.push(entry);
  }

  if (problems.length > 0) throw new ConfigError(source, problems);

  entries.sort(byDateThenRow);
  return { entries, warnings };
}

export async function loadMaintenanceLog(path: string, siteIds: ReadonlySet<string>): Promise<LogFile> {
  const csv = await readCsvFile(path, LOG_COLUMNS, REQUIRED_COLUMNS);
  if (!csv) {
    return {
      found: false,
      entries: [],
      warnings: [`${path} not found: no confirmed maintenance work will be reported`],
    };
  }

  const result = parseLogRows(csv.rows, path, siteIds);
  return { found: true, entries: result.entries, warnings: [...csv.warnings, ...result.warnings] };
}
