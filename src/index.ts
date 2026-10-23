import { config as loadEnv } from "dotenv";
import { parseArgs } from "node:util";
import { loadAgency } from "./agency.ts";
import type { CollectOptions } from "./collect.ts";
import { ConfigError, loadSites, type SiteConfig } from "./config.ts";
import { isValidPeriod } from "./dates.ts";
import { errorMessage } from "./files.ts";
import { loadLicenses } from "./licenses.ts";
import { isConfirmed, loadMaintenanceLog } from "./maintenance-log.ts";
import type { SiteSummary } from "./report-model.ts";
import { generateReports, type ReportOptions, type ReportPaths } from "./reports/generate.ts";
import { SAMPLE_DATES, SAMPLE_FILES, SAMPLE_OUTPUT, sampleSiteConfigs } from "./sample/fixtures.ts";
import { listSnapshotDates, summarize } from "./snapshot.ts";
import type { SiteInventory, VerificationStatus } from "./types.ts";
import { DEFAULT_CLIENT_OPTIONS } from "./wordpress-client.ts";
import { collectLive, collectSample, type CollectionRun } from "./workflow.ts";

const USAGE = `Usage: node src/index.ts <command> [options]      (or: yarn wpm <command> [options])

Commands:
  check      Validate clients.json, passwords in .env, agency.json, licenses.csv and
             maintenance_log.csv. Sends no requests.
  collect    Read core, plugins and themes from every site into snapshots/<YYYY-MM-DD>/
  report     Build the R1, R2 and R3 reports for one month into reports/<YYYY-MM>/
  run        collect, then report (the monthly workflow)

Options:
  --period <YYYY-MM>   Month for report and run (default: month of the newest snapshot)
  --site <siteId>      Only this site (repeatable)
  --config <file>      Site list (default: clients.json)
  --concurrency <n>    Sites collected in parallel (default: 2)
  --timeout <ms>       Per-request timeout (default: ${DEFAULT_CLIENT_OPTIONS.timeoutMs})
  --retries <n>        Retries after timeouts, 429 and 502-504 (default: ${DEFAULT_CLIENT_OPTIONS.retries})
  --details            Print every plugin and theme after collecting
  --sample             Use the built-in demo sites and sample files; output goes to sample-output/
  -h, --help           Show this help

Exit codes: 0 done, 1 usage or configuration error, 2 a site failed or a report could not be written.`;

const COMMANDS = ["check", "collect", "report", "run"];

interface Paths extends ReportPaths {
  clients: string;
}

class UsageError extends Error {}

function livePaths(config: string): Paths {
  return {
    clients: config,
    agency: "agency.json",
    licenses: "licenses.csv",
    log: "maintenance_log.csv",
    snapshots: "snapshots",
    reports: "reports",
  };
}

const SAMPLE_PATHS: Paths = {
  clients: "built-in demo sites",
  agency: SAMPLE_FILES.agency,
  licenses: SAMPLE_FILES.licenses,
  log: SAMPLE_FILES.log,
  snapshots: SAMPLE_OUTPUT.snapshots,
  reports: SAMPLE_OUTPUT.reports,
};

function readArguments() {
  try {
    return parseArgs({
      allowPositionals: true,
      options: {
        period: { type: "string" },
        site: { type: "string", multiple: true },
        config: { type: "string", default: "clients.json" },
        concurrency: { type: "string" },
        timeout: { type: "string" },
        retries: { type: "string" },
        details: { type: "boolean", default: false },
        sample: { type: "boolean", default: false },
        "dry-run": { type: "boolean", default: false },
        help: { type: "boolean", short: "h", default: false },
      },
    });
  } catch (error) {
    throw new UsageError(errorMessage(error));
  }
}

function readCommand(positionals: string[], dryRun: boolean): string {
  const command = positionals[0] ?? "";
  if (!command) throw new UsageError("missing command");
  if (!COMMANDS.includes(command)) throw new UsageError(`unknown command "${command}"`);
  if (positionals.length > 1) throw new UsageError(`unexpected argument "${positionals[1]}"`);
  if (command === "collect" && dryRun) return "check";
  return command;
}

function positiveInt(value: string | undefined, fallback: number, name: string, min = 1): number {
  if (value === undefined) return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < min) throw new UsageError(`--${name} must be an integer >= ${min}`);
  return number;
}

function selectSites(sites: SiteConfig[], wanted: string[] | undefined): SiteConfig[] {
  if (!wanted || wanted.length === 0) return sites;

  const knownIds = sites.map((site) => site.siteId);
  const unknownIds = wanted.filter((id) => !knownIds.includes(id));
  if (unknownIds.length > 0) throw new UsageError(`unknown --site: ${unknownIds.join(", ")}`);

  return sites.filter((site) => wanted.includes(site.siteId));
}

function statusLabel(status: string): string {
  if (status === "success") return "OK     ";
  if (status === "partial") return "PARTIAL";
  if (status === "failed") return "FAILED ";
  return "MISSING";
}

function collectLine(inventory: SiteInventory): string {
  const summary = summarize(inventory);
  let line = `  ${statusLabel(summary.fetchStatus)} ${summary.siteId.padEnd(24)} `;
  if (summary.fetchStatus !== "failed") {
    line += `${summary.plugins} plugins, ${summary.themes} themes, `;
    line += `${summary.updatesAvailable} updates, ${summary.unknownUpdateStates} unknown`;
  }
  if (summary.error) line += `\n          ${summary.error}`;
  return line;
}

function updateText(state: VerificationStatus, offeredVersion: string | null, note: string | null): string {
  if (state === "yes") return `UPDATE -> ${offeredVersion ?? "?"}`;
  if (state === "no") return "current";
  return `unknown (${note})`;
}

function detailRow(type: string, id: string, version: string | null, status: string, update: string): string {
  return `    ${type.padEnd(9)}${id.padEnd(56)} ${(version ?? "-").padEnd(11)} ${status.padEnd(9)} ${update}`;
}

function detailsTable(inventory: SiteInventory): string {
  const core = inventory.core;
  const lines = [
    `\n  ${inventory.siteId} (${inventory.siteUrl})`,
    detailRow("TYPE", "IDENTIFIER", "VERSION", "STATUS", "UPDATE"),
    detailRow(
      "core",
      "wordpress",
      core.installedVersion,
      "-",
      updateText(core.updateAvailable, core.availableVersion, core.updateNote),
    ),
  ];

  for (const plugin of inventory.plugins) {
    const update = updateText(plugin.updateAvailable, plugin.offeredVersion, plugin.updateNote);
    lines.push(detailRow(plugin.kind, plugin.identifier, plugin.installedVersion, plugin.status, update));
  }
  for (const theme of inventory.themes) {
    const update = updateText(theme.updateAvailable, theme.offeredVersion, theme.updateNote);
    lines.push(detailRow("theme", theme.slug, theme.installedVersion, theme.status, update));
  }
  return lines.join("\n");
}

function reportLine(summary: SiteSummary): string {
  const changes = summary.changes === null ? "no comparison" : `${summary.changes} changes`;
  let work = `${summary.confirmedWork} confirmed work`;
  if (summary.unconfirmedWork > 0) work += `, ${summary.unconfirmedWork} UNCONFIRMED`;

  const counts = `${summary.updatesAvailable} updates, ${summary.unknownUpdateStates} unknown, ${summary.licenseIssues} license issues`;
  return `  ${statusLabel(summary.status)} ${summary.siteId.padEnd(24)} ${counts}, ${changes}, ${work}`;
}

function printFailure(error: unknown): void {
  const message = errorMessage(error).replace(/\n/g, "\n          ");
  console.log(`  FAILED  ${message}`);
}

function checkSites(sites: SiteConfig[], sample: boolean): number {
  let problems = 0;
  for (const site of sites) {
    const hasPassword = sample || Boolean(process.env[site.passwordEnv]);
    if (!hasPassword) problems++;

    const transport = site.url.startsWith("https://") ? "https" : "HTTP (local test only)";
    let password = `${site.passwordEnv} ${hasPassword ? "(set)" : "(NOT SET)"}`;
    if (sample) password = "created at run time";

    console.log(`  ${hasPassword ? "OK     " : "MISSING"} ${site.siteId.padEnd(24)} ${site.url}`);
    console.log(`          client=${site.clientId} user=${site.username} transport=${transport} password=${password}`);
  }
  return problems;
}

async function checkReportInputs(sites: SiteConfig[], paths: Paths): Promise<number> {
  let problems = 0;
  const siteIds = new Set(sites.map((site) => site.siteId));
  const notes: string[] = [];

  try {
    const agency = await loadAgency(paths.agency);
    console.log(`  OK      ${paths.agency}: "${agency.agencyName}", client report language ${agency.language}`);
  } catch (error) {
    problems++;
    printFailure(error);
  }

  try {
    const licenses = await loadLicenses(paths.licenses, siteIds);
    notes.push(...licenses.warnings);
    if (licenses.found) console.log(`  OK      ${paths.licenses}: ${licenses.records.length} entries`);
  } catch (error) {
    problems++;
    printFailure(error);
  }

  try {
    const log = await loadMaintenanceLog(paths.log, siteIds);
    notes.push(...log.warnings);
    if (log.found) {
      const confirmed = log.entries.filter(isConfirmed).length;
      const unconfirmed = log.entries.length - confirmed;
      console.log(
        `  OK      ${paths.log}: ${log.entries.length} entries, ${confirmed} confirmed, ${unconfirmed} unconfirmed`,
      );
    }
  } catch (error) {
    problems++;
    printFailure(error);
  }

  const dates = await listSnapshotDates(paths.snapshots);
  if (dates.length > 0) {
    console.log(`  OK      ${paths.snapshots}: ${dates.length} snapshot date(s), newest ${dates[dates.length - 1]}`);
  } else {
    console.log(`  NONE    ${paths.snapshots}: no snapshots yet (run collect)`);
  }

  for (const note of notes) console.log(`  NOTE    ${note}`);
  return problems;
}

async function check(sites: SiteConfig[], paths: Paths, sample: boolean): Promise<number> {
  console.log(`Check: ${sites.length} site(s) from ${paths.clients}. No requests are sent.\n`);
  let problems = checkSites(sites, sample);

  console.log("\nReport inputs:");
  problems += await checkReportInputs(sites, paths);

  if (problems > 0) {
    console.log(`\n${problems} problem(s) found.`);
    return 1;
  }
  console.log("\nEverything looks ready.");
  return 0;
}

async function collect(
  sites: SiteConfig[],
  options: CollectOptions,
  paths: Paths,
  sample: boolean,
  details: boolean,
): Promise<number> {
  const source = sample ? " from the built-in demo sites" : "";
  console.log(`Collecting ${sites.length} site(s)${source} (concurrency ${options.concurrency})...`);

  let run: CollectionRun;
  if (sample) {
    const siteIds = new Set(sites.map((site) => site.siteId));
    run = await collectSample(siteIds, options);
  } else {
    run = await collectLive(sites, options, paths.snapshots);
  }

  if (details) {
    const tables: string[] = [];
    for (const inventory of run.inventories) {
      if (inventory.fetchStatus !== "failed") tables.push(detailsTable(inventory));
    }
    console.log(tables.join("\n"));
  }

  const lines = run.inventories.map(collectLine);
  console.log(`\n${lines.join("\n")}\n\nSnapshots written to ${run.dir}`);
  if (sample) console.log("Demo: an earlier snapshot of the same sites was written too, so reports can show changes.");

  const anyFailed = run.inventories.some((inventory) => inventory.fetchStatus === "failed");
  return anyFailed ? 2 : 0;
}

async function report(sites: SiteConfig[], paths: Paths, sample: boolean, period: string | undefined): Promise<number> {
  const options: ReportOptions = {
    generatedAt: sample ? SAMPLE_DATES.current : new Date(),
    mode: sample ? "sample" : "live",
  };
  if (period) options.period = period;

  const result = await generateReports(sites, paths, options);

  console.log(`\nReports for ${result.period}:`);
  for (const summary of result.sites) console.log(reportLine(summary));
  for (const warning of result.warnings) console.log(`  NOTE    ${warning}`);
  for (const problem of result.problems) console.log(`  PROBLEM ${problem.siteId}: ${problem.message}`);
  console.log(`\n${result.files.length} file(s) written to ${result.dir}`);

  return result.problems.length > 0 ? 2 : 0;
}

async function main(): Promise<number> {
  loadEnv({ quiet: true });

  const { values, positionals } = readArguments();
  if (values.help) {
    console.log(USAGE);
    return 0;
  }

  const command = readCommand(positionals, values["dry-run"]);
  if (values.period !== undefined && !isValidPeriod(values.period)) {
    throw new UsageError("--period must look like 2026-10");
  }
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0" && !values.sample) {
    throw new ConfigError("environment", ["NODE_TLS_REJECT_UNAUTHORIZED=0 disables certificate checks; unset it"]);
  }

  const options: CollectOptions = {
    concurrency: positiveInt(values.concurrency, 2, "concurrency"),
    timeoutMs: positiveInt(values.timeout, DEFAULT_CLIENT_OPTIONS.timeoutMs, "timeout", 100),
    retries: positiveInt(values.retries, DEFAULT_CLIENT_OPTIONS.retries, "retries", 0),
    retryDelayMs: DEFAULT_CLIENT_OPTIONS.retryDelayMs,
  };

  const sample = values.sample;
  const paths = sample ? SAMPLE_PATHS : livePaths(values.config);
  const allSites = sample ? sampleSiteConfigs() : await loadSites(paths.clients);
  const sites = selectSites(allSites, values.site);

  if (command === "check") return check(sites, paths, sample);

  let exitCode = 0;
  if (command === "collect" || command === "run") {
    exitCode = await collect(sites, options, paths, sample, values.details);
  }
  if (command === "report" || command === "run") {
    const reportCode = await report(sites, paths, sample, values.period);
    exitCode = Math.max(exitCode, reportCode);
  }
  return exitCode;
}

function printError(error: unknown): void {
  if (error instanceof UsageError) {
    console.error(`${error.message}\n\n${USAGE}`);
  } else if (error instanceof ConfigError) {
    console.error(error.message);
  } else {
    console.error(`Failed: ${errorMessage(error)}`);
  }
}

try {
  process.exitCode = await main();
} catch (error) {
  printError(error);
  process.exitCode = 1;
}
