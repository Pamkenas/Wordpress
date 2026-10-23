import { mkdir, readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { loadAgency, type AgencyConfig } from "../agency.ts";
import { ConfigError, type SiteConfig } from "../config.ts";
import { isValidPeriod } from "../dates.ts";
import { errorMessage, writeFileAtomic } from "../files.ts";
import { loadLicenses } from "../licenses.ts";
import { loadMaintenanceLog } from "../maintenance-log.ts";
import {
  buildSiteReport,
  summarizeReport,
  type ReportProblem,
  type SiteReport,
  type SiteSummary,
} from "../report-model.ts";
import { listSnapshotDates, pickSnapshots, writeJsonAtomic } from "../snapshot.ts";
import { imageDataUrl, writePdf } from "./pdf.ts";
import { buildR1Csv, buildR1Pdf } from "./r1.ts";
import { buildR2Pdf } from "./r2.ts";
import { buildR3Pdf } from "./r3.ts";

export interface ReportPaths {
  agency: string;
  licenses: string;
  log: string;
  snapshots: string;
  reports: string;
}

export interface ReportOptions {
  period?: string;
  generatedAt: Date;
  mode: "live" | "sample";
}

export interface ReportResult {
  period: string;
  dir: string;
  files: string[];
  warnings: string[];
  problems: ReportProblem[];
  sites: SiteSummary[];
}

export interface PreparedReports {
  agency: AgencyConfig;
  period: string;
  reports: SiteReport[];
  warnings: string[];
  problems: ReportProblem[];
}

const OWN_FILE = /^(r1|r2|r3)-.+\.(pdf|csv)$/;

async function leftoverFiles(dir: string, written: string[]): Promise<string[]> {
  const writtenNames = written.map((file) => basename(file));
  const existing = await readdir(dir);
  return existing.filter((name) => OWN_FILE.test(name) && !writtenNames.includes(name));
}

function choosePeriod(periodOption: string | undefined, dates: string[], snapshotsPath: string): string {
  let period = periodOption;
  if (period === undefined) {
    const newest = dates[dates.length - 1];
    if (!newest) throw new ConfigError(snapshotsPath, ["no snapshots found; run the collector first"]);
    period = newest.slice(0, 7);
  }

  if (!isValidPeriod(period)) {
    throw new ConfigError("command line", [`--period "${period}" must look like 2026-10`]);
  }
  return period;
}

export async function prepareReports(
  sites: readonly SiteConfig[],
  paths: ReportPaths,
  periodOption?: string,
): Promise<PreparedReports> {
  const agency = await loadAgency(paths.agency);
  const siteIds = new Set(sites.map((site) => site.siteId));
  const licenses = await loadLicenses(paths.licenses, siteIds);
  const log = await loadMaintenanceLog(paths.log, siteIds);
  const dates = await listSnapshotDates(paths.snapshots);
  const period = choosePeriod(periodOption, dates, paths.snapshots);

  const warnings = [...licenses.warnings, ...log.warnings];
  if (!dates.some((date) => date.startsWith(`${period}-`))) {
    warnings.push(`no snapshots in ${period}: every site is reported as not collected`);
  }

  const problems: ReportProblem[] = [];
  const reports: SiteReport[] = [];
  for (const site of sites) {
    try {
      const pair = await pickSnapshots(paths.snapshots, dates, site.siteId, period);
      reports.push(buildSiteReport(site, period, pair, licenses.records, log.entries));
    } catch (error) {
      problems.push({ siteId: site.siteId, message: errorMessage(error) });
    }
  }

  return { agency, period, reports, warnings, problems };
}

export async function generateReports(
  sites: readonly SiteConfig[],
  paths: ReportPaths,
  options: ReportOptions,
): Promise<ReportResult> {
  const { agency, period, reports, warnings, problems } = await prepareReports(sites, paths, options.period);

  const dir = join(paths.reports, period);
  await mkdir(dir, { recursive: true });
  const files: string[] = [];
  const logo = agency.logo ? await imageDataUrl(agency.logo) : null;

  const csvFile = join(dir, `r1-inventory-${period}.csv`);
  await writeFileAtomic(csvFile, buildR1Csv(reports, agency));
  files.push(csvFile);

  for (const report of reports) {
    const siteId = report.site.siteId;
    try {
      const r2File = join(dir, `r2-internal-${siteId}-${period}.pdf`);
      await writePdf(r2File, buildR2Pdf(report, agency, options.generatedAt));
      files.push(r2File);

      const r3File = join(dir, `r3-client-${siteId}-${period}.pdf`);
      await writePdf(r3File, buildR3Pdf(report, agency, logo));
      files.push(r3File);
    } catch (error) {
      problems.push({ siteId, message: `PDF could not be written: ${errorMessage(error)}` });
    }
  }

  const r1File = join(dir, `r1-consolidated-${period}.pdf`);
  await writePdf(r1File, buildR1Pdf(period, reports, agency, options.generatedAt, problems));
  files.push(r1File);

  for (const name of await leftoverFiles(dir, files)) {
    warnings.push(`${join(dir, name)} is from an earlier run and was not regenerated (site removed?); do not send it`);
  }

  files.sort();
  const sitesSummary = reports.map(summarizeReport);

  await writeJsonAtomic(join(dir, "_report.json"), {
    schemaVersion: 1,
    mode: options.mode,
    generatedAt: options.generatedAt.toISOString(),
    period,
    files: files.map((file) => basename(file)),
    warnings,
    problems,
    sites: sitesSummary,
  });

  return { period, dir, files, warnings, problems, sites: sitesSummary };
}
