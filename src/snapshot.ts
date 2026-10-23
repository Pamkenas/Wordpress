import { mkdir, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { localDate, periodStart } from "./dates.ts";
import { writeFileAtomic } from "./files.ts";
import { SNAPSHOT_SCHEMA_VERSION, type SiteInventory } from "./types.ts";

export interface SnapshotPair {
  current: SiteInventory | null;
  currentDate: string | null;
  baseline: SiteInventory | null;
  baselineDate: string | null;
}

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
  return localDate(date);
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

export async function writeJsonAtomic(path: string, data: unknown): Promise<void> {
  await writeFileAtomic(path, `${JSON.stringify(data, null, 2)}\n`);
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

export async function listSnapshotDates(root: string): Promise<string[]> {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(entry.name))
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

function isSnapshot(data: unknown, siteId: string): data is SiteInventory {
  if (typeof data !== "object" || data === null) return false;
  const snapshot = data as Record<string, unknown>;
  return (
    snapshot.schemaVersion === SNAPSHOT_SCHEMA_VERSION &&
    snapshot.siteId === siteId &&
    typeof snapshot.checkedAt === "string" &&
    ["success", "partial", "failed"].includes(snapshot.fetchStatus as string) &&
    typeof snapshot.core === "object" &&
    snapshot.core !== null &&
    Array.isArray(snapshot.plugins) &&
    Array.isArray(snapshot.themes) &&
    Array.isArray(snapshot.errors)
  );
}

export async function readSnapshot(root: string, date: string, siteId: string): Promise<SiteInventory | null> {
  const file = join(root, date, `${siteId}.json`);
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`${file} is not valid JSON`);
  }
  if (!isSnapshot(data, siteId)) {
    throw new Error(`${file} is not a schema ${SNAPSHOT_SCHEMA_VERSION} snapshot of ${siteId}`);
  }
  return data;
}

export async function pickSnapshots(
  root: string,
  dates: readonly string[],
  siteId: string,
  period: string,
): Promise<SnapshotPair> {
  const pair: SnapshotPair = { current: null, currentDate: null, baseline: null, baselineDate: null };
  const inPeriod = dates.filter((date) => date.startsWith(`${period}-`));

  for (const date of [...inPeriod].reverse()) {
    const snapshot = await readSnapshot(root, date, siteId);
    if (snapshot) {
      pair.current = snapshot;
      pair.currentDate = date;
      break;
    }
  }

  const currentDate = pair.currentDate;
  if (!pair.current || !currentDate || pair.current.fetchStatus === "failed") return pair;

  const beforePeriod = dates.filter((date) => date < periodStart(period)).reverse();
  const earlierInPeriod = inPeriod.filter((date) => date < currentDate);
  for (const date of [...beforePeriod, ...earlierInPeriod]) {
    const snapshot = await readSnapshot(root, date, siteId);
    if (snapshot && snapshot.fetchStatus !== "failed") {
      pair.baseline = snapshot;
      pair.baselineDate = date;
      break;
    }
  }

  return pair;
}
