import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { SNAPSHOT_SCHEMA_VERSION, type SiteInventory } from "./types.ts";

export interface RunSummary {
  schemaVersion: typeof SNAPSHOT_SCHEMA_VERSION;
  mode: "live" | "sample";
  startedAt: string;
  finishedAt: string;
  options: { concurrency: number; timeoutMs: number; retries: number };
  sites: Array<{
    siteId: string;
    clientId: string;
    fetchStatus: SiteInventory["fetchStatus"];
    plugins: number;
    themes: number;
    updatesAvailable: number;
    unknownUpdateStates: number;
    error: string | null;
  }>;
}

export function snapshotDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function summarize(inventory: SiteInventory): RunSummary["sites"][number] {
  const items = [inventory.core, ...inventory.plugins, ...inventory.themes];
  return {
    siteId: inventory.siteId,
    clientId: inventory.clientId,
    fetchStatus: inventory.fetchStatus,
    plugins: inventory.plugins.length,
    themes: inventory.themes.length,
    updatesAvailable: items.filter((i) => i.updateAvailable === "yes").length,
    unknownUpdateStates: items.filter((i) => i.updateAvailable === "unknown").length,
    error: inventory.error,
  };
}

async function writeJsonAtomic(path: string, data: unknown): Promise<void> {
  const tmp = `${path}.tmp`;
  await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  await rename(tmp, path);
}

export async function writeSnapshots(
  root: string,
  date: Date,
  inventories: readonly SiteInventory[],
  run: Omit<RunSummary, "schemaVersion" | "sites">,
): Promise<{ dir: string; files: string[] }> {
  const dir = join(root, snapshotDate(date));
  await mkdir(dir, { recursive: true });

  const files: string[] = [];
  for (const inventory of inventories) {
    const file = join(dir, `${inventory.siteId}.json`);
    await writeJsonAtomic(file, inventory);
    files.push(file);
  }

  const summary: RunSummary = { schemaVersion: SNAPSHOT_SCHEMA_VERSION, ...run, sites: inventories.map(summarize) };
  const summaryFile = join(dir, "_run.json");
  await writeJsonAtomic(summaryFile, summary);
  files.push(summaryFile);

  return { dir, files };
}
