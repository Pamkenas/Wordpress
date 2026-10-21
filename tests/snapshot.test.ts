import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { collectSites } from "../src/collect.ts";
import { SAMPLE_SITES } from "../src/sample/fixtures.ts";
import { snapshotDate, writeSnapshots } from "../src/snapshot.ts";
import { FAST, TEST_PASSWORD, withMockSites } from "./helpers.ts";

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "wp-maint-"));
}

function runCli(args: string[], env: NodeJS.ProcessEnv = {}) {
  return spawnSync(process.execPath, ["src/index.ts", ...args], { encoding: "utf8", env: { ...process.env, ...env } });
}

test("snapshot folder uses the local calendar date", () => {
  assert.equal(snapshotDate(new Date(2026, 0, 5, 0, 30)), "2026-01-05");
});

test("snapshots get deterministic names, are replaced on re-run, and contain no secrets", async () => {
  const root = await tempDir();
  try {
    await withMockSites([...SAMPLE_SITES], async (sites) => {
      const inventories = await collectSites(sites, { ...FAST, concurrency: 2 });
      const date = new Date(2026, 9, 21, 9, 0);
      const run = {
        mode: "sample" as const,
        startedAt: "s",
        finishedAt: "f",
        options: { concurrency: 2, timeoutMs: 1, retries: 0 },
      };

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

test("CLI --sample writes snapshots for every demo site and exits 2 because one site failed", async () => {
  const out = await tempDir();
  try {
    const result = runCli(["--sample", "--out", out]);
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stdout, /FAILED\s+demo-blog/);
    assert.match(result.stdout, /OK\s+demo-bakery\s+15 plugins/);
    const [day] = await readdir(out);
    assert.equal((await readdir(join(out, day!))).length, SAMPLE_SITES.length + 1);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test("CLI --dry-run reports missing passwords without sending requests", async () => {
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
    const result = runCli(["--dry-run", "--config", config], { DRY_RUN_SET: "secret-value", DRY_RUN_UNSET: "" });
    assert.equal(result.status, 1);
    assert.match(result.stdout, /OK\s+a\b/);
    assert.match(result.stdout, /MISSING\s+b\b/);
    assert.ok(!result.stdout.includes("secret-value"), "dry run must never print a password");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("CLI refuses to run with TLS verification disabled", () => {
  const result = runCli(["--dry-run", "--config", "clients.example.json"], { NODE_TLS_REJECT_UNAUTHORIZED: "0" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /NODE_TLS_REJECT_UNAUTHORIZED/);
});
