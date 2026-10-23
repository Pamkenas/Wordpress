import { collectSites, type CollectOptions } from "./collect.ts";
import type { SiteConfig } from "./config.ts";
import {
  SAMPLE_DATES,
  SAMPLE_OUTPUT,
  SAMPLE_PREVIOUS_SITES,
  SAMPLE_SITES,
  sampleDisplayUrl,
  startSampleSites,
  type FixtureSite,
} from "./sample/fixtures.ts";
import { writeSnapshots } from "./snapshot.ts";
import type { SiteInventory } from "./types.ts";

export interface CollectionRun {
  inventories: SiteInventory[];
  dir: string;
}

function runOptions(options: CollectOptions) {
  return { concurrency: options.concurrency, timeoutMs: options.timeoutMs, retries: options.retries };
}

export async function collectLive(
  sites: readonly SiteConfig[],
  options: CollectOptions,
  snapshotsRoot: string,
): Promise<CollectionRun> {
  const startedAt = new Date();
  const inventories = await collectSites(sites, options);
  const { dir } = await writeSnapshots(snapshotsRoot, startedAt, inventories, {
    mode: "live",
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    options: runOptions(options),
  });
  return { inventories, dir };
}

async function collectSampleRun(
  fixtures: readonly FixtureSite[],
  date: Date,
  options: CollectOptions,
  snapshotsRoot: string,
): Promise<CollectionRun> {
  const sample = await startSampleSites(fixtures, date);
  try {
    const inventories = await collectSites(sample.sites, { ...options, now: () => date });
    for (const inventory of inventories) inventory.siteUrl = sampleDisplayUrl(inventory.siteId);

    const { dir } = await writeSnapshots(snapshotsRoot, date, inventories, {
      mode: "sample",
      startedAt: date.toISOString(),
      finishedAt: date.toISOString(),
      options: runOptions(options),
    });
    return { inventories, dir };
  } finally {
    await sample.close();
  }
}

export async function collectSample(
  siteIds: ReadonlySet<string>,
  options: CollectOptions,
  snapshotsRoot: string = SAMPLE_OUTPUT.snapshots,
): Promise<CollectionRun> {
  const pick = (fixtures: readonly FixtureSite[]) => fixtures.filter((fixture) => siteIds.has(fixture.siteId));
  await collectSampleRun(pick(SAMPLE_PREVIOUS_SITES), SAMPLE_DATES.previous, options, snapshotsRoot);
  return collectSampleRun(pick(SAMPLE_SITES), SAMPLE_DATES.current, options, snapshotsRoot);
}
