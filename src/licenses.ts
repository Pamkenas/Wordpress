import { ConfigError } from "./config.ts";
import { readCsvFile, type CsvRow } from "./csv.ts";
import { parseDateInput, parseDateTimeInput } from "./dates.ts";

export const LICENSE_STATUSES = ["valid", "expired", "missing", "not-required", "unknown"] as const;

export type LicenseStatus = (typeof LICENSE_STATUSES)[number];

export interface LicenseRecord {
  row: number;
  siteId: string;
  identifier: string;
  status: LicenseStatus;
  expiryDate: string | null;
  vendor: string;
  owner: string;
  verificationSource: string;
  verifiedAt: string | null;
  notes: string;
}

export interface LoadedFile<T> {
  found: boolean;
  items: T[];
  warnings: string[];
}

export const LICENSE_COLUMNS = [
  "site_id",
  "plugin_identifier",
  "license_status",
  "expiry_date",
  "vendor",
  "owner",
  "verification_source",
  "verified_at",
  "notes",
];

const REQUIRED_COLUMNS = ["site_id", "plugin_identifier", "license_status"];

export function normalizeKeyword(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-");
}

function isLicenseStatus(value: string): value is LicenseStatus {
  return (LICENSE_STATUSES as readonly string[]).includes(value);
}

export function parseLicenseRows(
  rows: CsvRow[],
  source: string,
  siteIds: ReadonlySet<string>,
): { records: LicenseRecord[]; warnings: string[] } {
  const records: LicenseRecord[] = [];
  const problems: string[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();

  for (const { row, values } of rows) {
    const at = `row ${row}`;
    const before = problems.length;

    const siteId = values.site_id ?? "";
    const identifier = values.plugin_identifier ?? "";
    const statusText = values.license_status ?? "";
    const status = normalizeKeyword(statusText);
    const expiryText = values.expiry_date ?? "";
    const verifiedText = values.verified_at ?? "";

    if (!siteId) problems.push(`${at}: site_id is required`);
    if (!identifier) problems.push(`${at}: plugin_identifier is required`);
    if (!isLicenseStatus(status)) {
      problems.push(`${at}: license_status "${statusText}" must be one of ${LICENSE_STATUSES.join(", ")}`);
    }

    const expiryDate = expiryText ? parseDateInput(expiryText) : null;
    if (expiryText && !expiryDate) problems.push(`${at}: expiry_date "${expiryText}" is not a date (use YYYY-MM-DD)`);

    const verifiedAt = verifiedText ? parseDateTimeInput(verifiedText) : null;
    if (verifiedText && !verifiedAt)
      problems.push(`${at}: verified_at "${verifiedText}" is not a date (use YYYY-MM-DD)`);

    const key = `${siteId}|${identifier}`;
    if (siteId && identifier && seen.has(key)) problems.push(`${at}: duplicate entry for ${siteId} / ${identifier}`);
    seen.add(key);

    if (problems.length > before) continue;
    if (!siteIds.has(siteId)) {
      warnings.push(`${source} ${at}: site "${siteId}" is not in clients.json; row ignored`);
      continue;
    }

    records.push({
      row,
      siteId,
      identifier,
      status: status as LicenseStatus,
      expiryDate,
      vendor: values.vendor ?? "",
      owner: values.owner ?? "",
      verificationSource: values.verification_source ?? "",
      verifiedAt,
      notes: values.notes ?? "",
    });
  }

  if (problems.length > 0) throw new ConfigError(source, problems);
  return { records, warnings };
}

export async function loadLicenses(path: string, siteIds: ReadonlySet<string>): Promise<LoadedFile<LicenseRecord>> {
  const csv = await readCsvFile(path, LICENSE_COLUMNS, REQUIRED_COLUMNS);
  if (!csv) {
    return { found: false, items: [], warnings: [`${path} not found: every license is reported as unknown`] };
  }

  const { records, warnings } = parseLicenseRows(csv.rows, path, siteIds);
  return { found: true, items: records, warnings: [...csv.warnings, ...warnings] };
}

export function effectiveLicenseStatus(record: LicenseRecord | undefined, asOf: string): LicenseStatus {
  if (!record) return "unknown";
  if (record.status === "valid" && record.expiryDate !== null && record.expiryDate < asOf) return "expired";
  return record.status;
}
