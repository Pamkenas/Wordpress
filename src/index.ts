import { config as loadEnv } from "dotenv";
import { parseArgs } from "node:util";
import { collectSites, type CollectOptions } from "./collect.ts";
import { ConfigError, loadSites, type SiteConfig } from "./config.ts";
import { startSampleSites } from "./sample/fixtures.ts";
import { summarize, writeSnapshots } from "./snapshot.ts";
import type { SiteInventory } from "./types.ts";
import { DEFAULT_CLIENT_OPTIONS } from "./wordpress-client.ts";

const USAGE = `Usage: node src/index.ts [options]

Collects a read-only maintenance inventory (core, all plugins, all themes) from
every site in clients.json and writes snapshots/<YYYY-MM-DD>/<siteId>.json.

Options:
  --config <file>      Site list (default: clients.json)
  --out <dir>          Snapshot root folder (default: snapshots, or sample-output/snapshots with --sample)
  --site <siteId>      Only collect this site (repeatable)
  --concurrency <n>    Sites collected in parallel (default: 2)
  --timeout <ms>       Per-request timeout (default: ${DEFAULT_CLIENT_OPTIONS.timeoutMs})
  --retries <n>        Retries after timeouts, 429 and 502-504 (default: ${DEFAULT_CLIENT_OPTIONS.retries})
  --dry-run            Validate clients.json and .env only; no network requests, no files written
  --sample             Collect from built-in demo sites (no real sites, no credentials)
  --details            Also print every plugin and theme per site
  -h, --help           Show this help

Exit codes: 0 all sites collected (some may be partial), 1 usage/config error, 2 at least one site failed.`;

function positiveInt(value: string | undefined, fallback: number, name: string, min = 1): number {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min)
    throw new ConfigError("command line", [`--${name} must be an integer >= ${min}`]);
  return n;
}

function line(inventory: SiteInventory): string {
  const s = summarize(inventory);
  const label = { success: "OK     ", partial: "PARTIAL", failed: "FAILED " }[s.fetchStatus];
  const counts = `${s.plugins} plugins, ${s.themes} themes, ${s.updatesAvailable} updates, ${s.unknownUpdateStates} unknown`;
  return `  ${label} ${s.siteId.padEnd(24)} ${s.fetchStatus === "failed" ? "" : counts}${s.error ? `\n          ${s.error}` : ""}`;
}

function details(inventory: SiteInventory): string {
  const update = (i: { updateAvailable: string; offeredVersion?: string | null; updateNote: string | null }) =>
    i.updateAvailable === "yes"
      ? `UPDATE -> ${i.offeredVersion ?? "?"}`
      : i.updateAvailable === "no"
        ? "current"
        : `unknown (${i.updateNote})`;
  const row = (type: string, id: string, version: string | null, status: string, upd: string) =>
    `    ${type.padEnd(9)}${id.padEnd(52)}${(version ?? "-").padEnd(12)}${status.padEnd(10)}${upd}`;

  const { core } = inventory;
  return [
    `\n  ${inventory.siteId} (${inventory.siteUrl})`,
    row("TYPE", "IDENTIFIER", "VERSION", "STATUS", "UPDATE"),
    row("core", "wordpress", core.installedVersion, "-", update({ ...core, offeredVersion: core.availableVersion })),
    ...inventory.plugins.map((p) => row(p.kind, p.identifier, p.installedVersion, p.status, update(p))),
    ...inventory.themes.map((t) => row("theme", t.slug, t.installedVersion, t.status, update(t))),
  ].join("\n");
}

function dryRun(sites: SiteConfig[]): number {
  let problems = 0;
  console.log(`Dry run: ${sites.length} site(s), no requests sent.\n`);
  for (const site of sites) {
    const hasPassword = Boolean(process.env[site.passwordEnv]);
    if (!hasPassword) problems++;
    const transport = site.url.startsWith("https://") ? "https" : "HTTP (local test only)";
    console.log(`  ${hasPassword ? "OK     " : "MISSING"} ${site.siteId.padEnd(24)} ${site.url}`);
    console.log(
      `          client=${site.clientId} user=${site.username} transport=${transport} password=${site.passwordEnv} ${hasPassword ? "(set)" : "(NOT SET)"}`,
    );
  }
  console.log(
    problems ? `\n${problems} site(s) have no password in the environment.` : "\nConfiguration looks complete.",
  );
  return problems ? 1 : 0;
}

async function main(): Promise<number> {
  loadEnv({ quiet: true });

  const { values } = parseArgs({
    options: {
      config: { type: "string", default: "clients.json" },
      out: { type: "string" },
      site: { type: "string", multiple: true },
      concurrency: { type: "string" },
      timeout: { type: "string" },
      retries: { type: "string" },
      "dry-run": { type: "boolean", default: false },
      sample: { type: "boolean", default: false },
      details: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });

  if (values.help) {
    console.log(USAGE);
    return 0;
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

  const sample = values.sample ? await startSampleSites() : null;
  try {
    let sites = sample ? sample.sites : await loadSites(values.config);
    if (values.site?.length) {
      const wanted = new Set(values.site);
      const unknownIds = [...wanted].filter((id) => !sites.some((s) => s.siteId === id));
      if (unknownIds.length) throw new ConfigError("command line", [`unknown --site: ${unknownIds.join(", ")}`]);
      sites = sites.filter((s) => wanted.has(s.siteId));
    }

    if (values["dry-run"]) return dryRun(sites);

    const startedAt = new Date();
    console.log(
      `Collecting ${sites.length} site(s)${sample ? " from built-in demo data" : ""} (concurrency ${options.concurrency})...`,
    );
    const inventories = await collectSites(sites, options);

    const root = values.out ?? (sample ? "sample-output/snapshots" : "snapshots");
    const { dir } = await writeSnapshots(root, startedAt, inventories, {
      mode: sample ? "sample" : "live",
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      options: { concurrency: options.concurrency, timeoutMs: options.timeoutMs, retries: options.retries },
    });

    if (values.details)
      console.log(
        inventories
          .filter((i) => i.fetchStatus !== "failed")
          .map(details)
          .join("\n"),
      );
    console.log(`\n${inventories.map(line).join("\n")}\n\nSnapshots written to ${dir}`);
    return inventories.some((i) => i.fetchStatus === "failed") ? 2 : 0;
  } finally {
    await sample?.close();
  }
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(
      error instanceof ConfigError
        ? error.message
        : `Collection failed: ${error instanceof Error ? error.message : error}`,
    );
    if (String((error as { code?: unknown }).code).startsWith("ERR_PARSE_ARGS")) console.error(`\n${USAGE}`);
    process.exitCode = 1;
  },
);
