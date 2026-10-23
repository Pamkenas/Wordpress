import { ConfigError } from "./config.ts";
import { normalizeKeyword, readCsvFile, type CsvRow } from "./csv.ts";
import { parseDateInput, parseDateTimeInput } from "./dates.ts";

export type LicenseStatus = "valid" | "expired" | "missing" | "not-required" | "unknown";

export const LICENSE_STATUSES: LicenseStatus[] = ["valid", "expired", "missing", "not-required", "unknown"];

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

export interface LicenseFile {
  found: boolean;
  records: LicenseRecord[];
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

function toLicenseStatus(text: string): LicenseStatus | null {
  const value = normalizeKeyword(text);
  for (const status of LICENSE_STATUSES) {
    if (status === value) return status;
  }
  return null;
}

function parseLicenseRow(csvRow: CsvRow, seenKeys: Set<string>, problems: string[]): LicenseRecord | null {
  const { row, values } = csvRow;
  const at = `row ${row}`;
  const problemsBefore = problems.length;

  const siteId = values.site_id ?? "";
  const identifier = values.plugin_identifier ?? "";
  const statusText = values.license_status ?? "";
  const expiryText = values.expiry_date ?? "";
  const verifiedText = values.verified_at ?? "";

  if (!siteId) problems.push(`${at}: site_id is required`);
  if (!identifier) problems.push(`${at}: plugin_identifier is required`);

  const status = toLicenseStatus(statusText);
  if (!status) {
    problems.push(`${at}: license_status "${statusText}" must be one of ${LICENSE_STATUSES.join(", ")}`);
  }

  const expiryDate = expiryText ? parseDateInput(expiryText) : null;
  if (expiryText && !expiryDate) {
    problems.push(`${at}: expiry_date "${expiryText}" is not a date (use YYYY-MM-DD)`);
  }

  const verifiedAt = verifiedText ? parseDateTimeInput(verifiedText) : null;
  if (verifiedText && !verifiedAt) {
    problems.push(`${at}: verified_at "${verifiedText}" is not a date (use YYYY-MM-DD)`);
  }

  const key = `${siteId}|${identifier}`;
  if (siteId && identifier && seenKeys.has(key)) {
    problems.push(`${at}: duplicate entry for ${siteId} / ${identifier}`);
  }
  seenKeys.add(key);

  if (problems.length > problemsBefore || !status) return null;

  return {
    row,
    siteId,
    identifier,
    status,
    expiryDate,
    vendor: values.vendor ?? "",
    owner: values.owner ?? "",
    verificationSource: values.verification_source ?? "",
    verifiedAt,
    notes: values.notes ?? "",
  };
}

export function parseLicenseRows(
  rows: CsvRow[],
  source: string,
  siteIds: ReadonlySet<string>,
): { records: LicenseRecord[]; warnings: string[] } {
  const records: LicenseRecord[] = [];
  const problems: string[] = [];
  const warnings: string[] = [];
  const seenKeys = new Set<string>();

  for (const csvRow of rows) {
    const record = parseLicenseRow(csvRow, seenKeys, problems);
    if (!record) continue;

    if (!siteIds.has(record.siteId)) {
      warnings.push(`${source} row ${record.row}: site "${record.siteId}" is not in clients.json; row ignored`);
      continue;
    }
    records.push(record);
  }

  if (problems.length > 0) throw new ConfigError(source, problems);
  return { records, warnings };
}

export async function loadLicenses(path: string, siteIds: ReadonlySet<string>): Promise<LicenseFile> {
  const csv = await readCsvFile(path, LICENSE_COLUMNS, REQUIRED_COLUMNS);
  if (!csv) {
    return { found: false, records: [], warnings: [`${path} not found: every license is reported as unknown`] };
  }

  const result = parseLicenseRows(csv.rows, path, siteIds);
  return { found: true, records: result.records, warnings: [...csv.warnings, ...result.warnings] };
}

export function effectiveLicenseStatus(record: LicenseRecord | undefined, asOf: string): LicenseStatus {
  if (!record) return "unknown";
  if (record.status === "valid" && record.expiryDate !== null && record.expiryDate < asOf) return "expired";
  return record.status;
}
