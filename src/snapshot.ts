import { mkdir, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { localDate, periodStart } from "./dates.ts";
import { writeFileAtomic } from "./files.ts";
import { SNAPSHOT_SCHEMA_VERSION, type FetchStatus, type SiteInventory } from "./types.ts";

export interface SnapshotPair {
  current: SiteInventory | null;
  currentDate: string | null;
  baseline: SiteInventory | null;
  baselineDate: string | null;
}

export interface RunOptions {
  concurrency: number;
  timeoutMs: number;
  retries: number;
}

export interface RunInfo {
  mode: "live" | "sample";
  startedAt: string;
  finishedAt: string;
  options: RunOptions;
}

export interface RunSiteSummary {
  siteId: string;
  clientId: string;
  fetchStatus: FetchStatus;
  plugins: number;
  themes: number;
  updatesAvailable: number;
  unknownUpdateStates: number;
  error: string | null;
}

export function snapshotDate(date: Date): string {
  return localDate(date);
}

export function summarize(inventory: SiteInventory): RunSiteSummary {
  const states = [inventory.core.updateAvailable];
  for (const plugin of inventory.plugins) states.push(plugin.updateAvailable);
  for (const theme of inventory.themes) states.push(theme.updateAvailable);

  return {
    siteId: inventory.siteId,
    clientId: inventory.clientId,
    fetchStatus: inventory.fetchStatus,
    plugins: inventory.plugins.length,
    themes: inventory.themes.length,
    updatesAvailable: states.filter((state) => state === "yes").length,
    unknownUpdateStates: states.filter((state) => state === "unknown").length,
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
  run: RunInfo,
): Promise<{ dir: string; files: string[] }> {
  const dir = join(root, snapshotDate(date));
  await mkdir(dir, { recursive: true });

  const files: string[] = [];
  for (const inventory of inventories) {
    const file = join(dir, `${inventory.siteId}.json`);
    await writeJsonAtomic(file, inventory);
    files.push(file);
  }

  const summary = {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    mode: run.mode,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    options: run.options,
    sites: inventories.map(summarize),
  };
  const summaryFile = join(dir, "_run.json");
  await writeJsonAtomic(summaryFile, summary);
  files.push(summaryFile);

  return { dir, files };
}

function isNotFound(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

export async function listSnapshotDates(root: string): Promise<string[]> {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    const dates: string[] = [];
    for (const entry of entries) {
      if (entry.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(entry.name)) dates.push(entry.name);
    }
    return dates.sort();
  } catch (error) {
    if (isNotFound(error)) return [];
    throw error;
  }
}

function isSnapshot(data: unknown, siteId: string): data is SiteInventory {
  if (typeof data !== "object" || data === null) return false;
  const snapshot = data as Record<string, unknown>;
  const validStatus = ["success", "partial", "failed"].includes(String(snapshot.fetchStatus));
  return (
    snapshot.schemaVersion === SNAPSHOT_SCHEMA_VERSION &&
    snapshot.siteId === siteId &&
    typeof snapshot.checkedAt === "string" &&
    validStatus &&
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
    if (isNotFound(error)) return null;
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

function baselineCandidates(dates: readonly string[], period: string, currentDate: string): string[] {
  const start = periodStart(period);
  const beforePeriod = dates.filter((date) => date < start).reverse();
  const earlierInPeriod = dates.filter((date) => date >= start && date < currentDate);
  return [...beforePeriod, ...earlierInPeriod];
}

export async function pickSnapshots(
  root: string,
  dates: readonly string[],
  siteId: string,
  period: string,
): Promise<SnapshotPair> {
  const pair: SnapshotPair = { current: null, currentDate: null, baseline: null, baselineDate: null };

  const datesInPeriod = dates.filter((date) => date.startsWith(`${period}-`));
  for (const date of [...datesInPeriod].reverse()) {
    const snapshot = await readSnapshot(root, date, siteId);
    if (snapshot) {
      pair.current = snapshot;
      pair.currentDate = date;
      break;
    }
  }

  if (!pair.current || !pair.currentDate || pair.current.fetchStatus === "failed") return pair;

  for (const date of baselineCandidates(dates, period, pair.currentDate)) {
    const snapshot = await readSnapshot(root, date, siteId);
    if (snapshot && snapshot.fetchStatus !== "failed") {
      pair.baseline = snapshot;
      pair.baselineDate = date;
      break;
    }
  }

  return pair;
}
