import assert from "node:assert/strict";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { collectSites } from "../src/collect.ts";
import { SAMPLE_SITES } from "../src/sample/fixtures.ts";
import {
  listSnapshotDates,
  pickSnapshots,
  readSnapshot,
  snapshotDate,
  writeSnapshots,
  type RunInfo,
} from "../src/snapshot.ts";
import { FAST, runCli, TEST_PASSWORD, tempDir, withMockSites } from "./helpers.ts";

const TEST_RUN: RunInfo = {
  mode: "sample",
  startedAt: "s",
  finishedAt: "f",
  options: { concurrency: 2, timeoutMs: 1, retries: 0 },
};

test("snapshot folder uses the local calendar date", () => {
  assert.equal(snapshotDate(new Date(2026, 0, 5, 0, 30)), "2026-01-05");
});

test("snapshots get deterministic names, are replaced on re-run, and contain no secrets", async () => {
  const root = await tempDir();
  try {
    await withMockSites([...SAMPLE_SITES], async (sites) => {
      const inventories = await collectSites(sites, { ...FAST, concurrency: 2 });
      const date = new Date(2026, 9, 21, 9, 0);
      const run = TEST_RUN;

      await writeSnapshots(root, date, inventories, run);
      const { dir } = await writeSnapshots(root, date, inventories, run);

      const files = (await readdir(dir)).sort();
      assert.deepEqual(files, [
        "_run.json",
        "demo-bakery.json",
        "demo-blog.json",
        "demo-portfolio.json",
        "demo-shop.json",
      ]);

      const all = (await Promise.all(files.map((f) => readFile(join(dir, f), "utf8")))).join("\n");
      assert.ok(!all.includes(TEST_PASSWORD.replace(/\s+/g, "")), "application password must not be written");
      assert.ok(!all.includes("auditor"), "username must not be written");
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("snapshots are read back, validated and paired with the right baseline", async () => {
  const root = await tempDir();
  try {
    await withMockSites([...SAMPLE_SITES], async (sites) => {
      const inventories = await collectSites(sites, { ...FAST, concurrency: 2 });
      const run = TEST_RUN;
      await writeSnapshots(root, new Date(2026, 8, 28), inventories, run);
      await writeSnapshots(root, new Date(2026, 9, 5), inventories, run);
      await writeSnapshots(root, new Date(2026, 9, 20), inventories, run);
    });
    await mkdir(join(root, "not-a-date"));

    const dates = await listSnapshotDates(root);
    assert.deepEqual(dates, ["2026-09-28", "2026-10-05", "2026-10-20"]);

    const pair = await pickSnapshots(root, dates, "demo-shop", "2026-10");
    assert.equal(pair.currentDate, "2026-10-20");
    assert.equal(pair.baselineDate, "2026-09-28");

    const failed = await pickSnapshots(root, dates, "demo-blog", "2026-10");
    assert.equal(failed.current?.fetchStatus, "failed");
    assert.equal(failed.baseline, null);

    assert.equal(await readSnapshot(root, "2026-10-20", "no-such-site"), null);
    await writeFile(join(root, "2026-10-20", "demo-shop.json"), '{"schemaVersion": 99}');
    await assert.rejects(readSnapshot(root, "2026-10-20", "demo-shop"), /not a schema 1 snapshot/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("CLI collect --sample writes two snapshot dates and exits 2 because one demo site fails", async () => {
  const cwd = await tempDir();
  try {
    const result = runCli(["collect", "--sample"], {}, cwd);
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stdout, /FAILED\s+demo-blog/);
    assert.match(result.stdout, /OK\s+demo-bakery\s+15 plugins/);
    const days = await readdir(join(cwd, "sample-output", "snapshots"));
    assert.deepEqual(days.sort(), ["2026-09-23", "2026-10-21"]);
    assert.equal(
      (await readdir(join(cwd, "sample-output", "snapshots", "2026-10-21"))).length,
      SAMPLE_SITES.length + 1,
    );
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("CLI run --sample builds every report file", async () => {
  const cwd = await tempDir();
  try {
    const result = runCli(["run", "--sample"], {}, cwd);
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stdout, /Reports for 2026-10/);
    assert.match(result.stdout, /1 UNCONFIRMED/);
    const files = await readdir(join(cwd, "sample-output", "reports", "2026-10"));
    assert.equal(files.filter((file) => file.endsWith(".pdf")).length, 1 + SAMPLE_SITES.length * 2);
    assert.ok(files.includes("r1-inventory-2026-10.csv"));
    assert.ok(files.includes("_report.json"));
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("CLI rejects unknown commands and malformed periods with usage help", () => {
  const unknown = runCli(["deploy"]);
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /unknown command "deploy"[\s\S]*Usage:/);

  const period = runCli(["report", "--period", "2026-13", "--sample"]);
  assert.equal(period.status, 1);
  assert.match(period.stderr, /--period must look like 2026-10/);
});

test("CLI check reports missing passwords without sending requests", async () => {
  const dir = await tempDir();
  try {
    const config = join(dir, "clients.json");
    await writeFile(
      config,
      JSON.stringify([
        { siteId: "a", clientId: "c", url: "https://a.example", username: "u", passwordEnv: "DRY_RUN_SET" },
        { siteId: "b", clientId: "c", url: "https://b.example", username: "u", passwordEnv: "DRY_RUN_UNSET" },
      ]),
    );
    const result = runCli(["check", "--config", config], { DRY_RUN_SET: "secret-value", DRY_RUN_UNSET: "" }, dir);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /OK\s+a\b/);
    assert.match(result.stdout, /MISSING\s+b\b/);
    assert.match(result.stdout, /agency\.json is invalid/);
    assert.ok(!result.stdout.includes("secret-value"), "check must never print a password");

    const legacy = runCli(["collect", "--dry-run", "--config", config], { DRY_RUN_SET: "x" }, dir);
    assert.match(legacy.stdout, /Check: 2 site\(s\)/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("CLI refuses to run with TLS verification disabled", () => {
  const result = runCli(["check", "--config", "clients.example.json"], { NODE_TLS_REJECT_UNAUTHORIZED: "0" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /NODE_TLS_REJECT_UNAUTHORIZED/);
});
