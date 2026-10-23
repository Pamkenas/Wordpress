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
import type { SiteInventory } from "./types.ts";
import { DEFAULT_CLIENT_OPTIONS } from "./wordpress-client.ts";
import { collectLive, collectSample } from "./workflow.ts";

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

function positiveInt(value: string | undefined, fallback: number, name: string, min = 1): number {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min) throw new UsageError(`--${name} must be an integer >= ${min}`);
  return n;
}

function selectSites(sites: SiteConfig[], wanted: string[] | undefined): SiteConfig[] {
  if (!wanted || wanted.length === 0) return sites;
  const unknownIds = wanted.filter((id) => !sites.some((site) => site.siteId === id));
  if (unknownIds.length > 0) throw new UsageError(`unknown --site: ${unknownIds.join(", ")}`);
  return sites.filter((site) => wanted.includes(site.siteId));
}

function collectLine(inventory: SiteInventory): string {
  const s = summarize(inventory);
  const label = { success: "OK     ", partial: "PARTIAL", failed: "FAILED " }[s.fetchStatus];
  const counts = `${s.plugins} plugins, ${s.themes} themes, ${s.updatesAvailable} updates, ${s.unknownUpdateStates} unknown`;
  return `  ${label} ${s.siteId.padEnd(24)} ${s.fetchStatus === "failed" ? "" : counts}${s.error ? `\n          ${s.error}` : ""}`;
}

function detailsTable(inventory: SiteInventory): string {
  const update = (i: { updateAvailable: string; offeredVersion?: string | null; updateNote: string | null }) =>
    i.updateAvailable === "yes"
      ? `UPDATE -> ${i.offeredVersion ?? "?"}`
      : i.updateAvailable === "no"
        ? "current"
        : `unknown (${i.updateNote})`;
  const row = (type: string, id: string, version: string | null, status: string, upd: string) =>
    `    ${type.padEnd(9)}${id.padEnd(56)} ${(version ?? "-").padEnd(11)} ${status.padEnd(9)} ${upd}`;

  const { core } = inventory;
  return [
    `\n  ${inventory.siteId} (${inventory.siteUrl})`,
    row("TYPE", "IDENTIFIER", "VERSION", "STATUS", "UPDATE"),
    row("core", "wordpress", core.installedVersion, "-", update({ ...core, offeredVersion: core.availableVersion })),
    ...inventory.plugins.map((p) => row(p.kind, p.identifier, p.installedVersion, p.status, update(p))),
    ...inventory.themes.map((t) => row("theme", t.slug, t.installedVersion, t.status, update(t))),
  ].join("\n");
}

function reportLine(summary: SiteSummary): string {
  const labels = { success: "OK     ", partial: "PARTIAL", failed: "FAILED ", "not-collected": "MISSING" };
  const changes = summary.changes === null ? "no comparison" : `${summary.changes} changes`;
  const work = `${summary.confirmedWork} confirmed work${summary.unconfirmedWork ? `, ${summary.unconfirmedWork} UNCONFIRMED` : ""}`;
  return `  ${labels[summary.status]} ${summary.siteId.padEnd(24)} ${summary.updatesAvailable} updates, ${summary.unknownUpdateStates} unknown, ${summary.licenseIssues} license issues, ${changes}, ${work}`;
}

function indent(text: string): string {
  return text.replace(/\n/g, "\n          ");
}

async function check(sites: SiteConfig[], paths: Paths, sample: boolean): Promise<number> {
  let problems = 0;
  console.log(`Check: ${sites.length} site(s) from ${paths.clients}. No requests are sent.\n`);

  for (const site of sites) {
    const hasPassword = sample || Boolean(process.env[site.passwordEnv]);
    if (!hasPassword) problems++;
    const transport = site.url.startsWith("https://") ? "https" : "HTTP (local test only)";
    const password = sample ? "created at run time" : `${site.passwordEnv} ${hasPassword ? "(set)" : "(NOT SET)"}`;
    console.log(`  ${hasPassword ? "OK     " : "MISSING"} ${site.siteId.padEnd(24)} ${site.url}`);
    console.log(`          client=${site.clientId} user=${site.username} transport=${transport} password=${password}`);
  }

  console.log("\nReport inputs:");
  try {
    const agency = await loadAgency(paths.agency);
    console.log(`  OK      ${paths.agency}: "${agency.agencyName}", client report language ${agency.language}`);
  } catch (error) {
    problems++;
    console.log(`  FAILED  ${indent(errorMessage(error))}`);
  }

  const siteIds = new Set(sites.map((site) => site.siteId));
  const warnings: string[] = [];
  try {
    const licenses = await loadLicenses(paths.licenses, siteIds);
    warnings.push(...licenses.warnings);
    if (licenses.found) console.log(`  OK      ${paths.licenses}: ${licenses.items.length} entries`);
  } catch (error) {
    problems++;
    console.log(`  FAILED  ${indent(errorMessage(error))}`);
  }

  try {
    const log = await loadMaintenanceLog(paths.log, siteIds);
    warnings.push(...log.warnings);
    if (log.found) {
      const confirmed = log.items.filter((entry) => isConfirmed(entry)).length;
      console.log(
        `  OK      ${paths.log}: ${log.items.length} entries, ${confirmed} confirmed, ${log.items.length - confirmed} unconfirmed`,
      );
    }
  } catch (error) {
    problems++;
    console.log(`  FAILED  ${indent(errorMessage(error))}`);
  }

  const dates = await listSnapshotDates(paths.snapshots);
  console.log(
    dates.length > 0
      ? `  OK      ${paths.snapshots}: ${dates.length} snapshot date(s), newest ${dates[dates.length - 1]}`
      : `  NONE    ${paths.snapshots}: no snapshots yet (run collect)`,
  );

  for (const warning of warnings) console.log(`  NOTE    ${warning}`);
  console.log(problems > 0 ? `\n${problems} problem(s) found.` : "\nEverything looks ready.");
  return problems > 0 ? 1 : 0;
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

  const run = sample
    ? await collectSample(new Set(sites.map((site) => site.siteId)), options)
    : await collectLive(sites, options, paths.snapshots);

  if (details) {
    const tables = run.inventories.filter((inventory) => inventory.fetchStatus !== "failed").map(detailsTable);
    console.log(tables.join("\n"));
  }
  console.log(`\n${run.inventories.map(collectLine).join("\n")}\n\nSnapshots written to ${run.dir}`);
  if (sample) console.log("Demo: an earlier snapshot of the same sites was written too, so reports can show changes.");
  return run.inventories.some((inventory) => inventory.fetchStatus === "failed") ? 2 : 0;
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

  let parsed;
  try {
    parsed = parseArgs({
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

  const { values, positionals } = parsed;
  if (values.help) {
    console.log(USAGE);
    return 0;
  }

  let command = positionals[0] ?? "";
  if (!command) throw new UsageError("missing command");
  if (!COMMANDS.includes(command)) throw new UsageError(`unknown command "${command}"`);
  if (positionals.length > 1) throw new UsageError(`unexpected argument "${positionals[1]}"`);
  if (command === "collect" && values["dry-run"]) command = "check";
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
  const sites = selectSites(sample ? sampleSiteConfigs() : await loadSites(paths.clients), values.site);

  if (command === "check") return check(sites, paths, sample);

  let exitCode = 0;
  if (command === "collect" || command === "run") {
    exitCode = await collect(sites, options, paths, sample, values.details);
  }
  if (command === "report" || command === "run") {
    exitCode = Math.max(exitCode, await report(sites, paths, sample, values.period));
  }
  return exitCode;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    if (error instanceof UsageError) {
      console.error(`${error.message}\n\n${USAGE}`);
    } else if (error instanceof ConfigError) {
      console.error(error.message);
    } else {
      console.error(`Failed: ${errorMessage(error)}`);
    }
    process.exitCode = 1;
  },
);
