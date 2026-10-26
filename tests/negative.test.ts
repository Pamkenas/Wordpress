import assert from "node:assert/strict";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { describe, test } from "node:test";
import { collectSite, collectSites, resolveUpdate } from "../src/collect.ts";
import { ConfigError } from "../src/config.ts";
import { loadLicenses } from "../src/licenses.ts";
import { generateReports } from "../src/reports/generate.ts";
import {
  SAMPLE_DATES,
  SAMPLE_FILES,
  sampleSiteConfigs,
  type FixtureItem,
  type FixtureSite,
} from "../src/sample/fixtures.ts";
import type { UpdateTransient } from "../src/wordpress-client.ts";
import { WordPressClient } from "../src/wordpress-client.ts";
import { collectSample } from "../src/workflow.ts";
import { expectApiError, FAST, runCli, sampleFixture, TEST_PASSWORD, tempDir, withMockSites } from "./helpers.ts";

const VALID_SITE = {
  siteId: "acme-main",
  clientId: "acme",
  url: "https://acme.example",
  username: "maintenance-auditor",
  passwordEnv: "WP_ACME_APP_PASSWORD",
};

describe("negative cases: connections", () => {
  test("a site without working HTTPS fails with a TLS error and is not retried", async () => {
    let connections = 0;
    const server = createServer((_request, response) => response.end("plain http"));
    server.on("connection", () => connections++);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;

    try {
      const client = new WordPressClient(`https://127.0.0.1:${port}`, "auditor", TEST_PASSWORD, {
        ...FAST,
        retries: 2,
      });
      const error = await expectApiError(client.getPlugins());
      assert.equal(error.kind, "tls");
      assert.match(error.message, /TLS error/);
      assert.equal(connections, 1);
    } finally {
      server.closeAllConnections();
      server.close();
    }
  });

  test("a wrong site address (no REST API there) gets a clear hint", async () => {
    await withMockSites([sampleFixture("demo-bakery")], async (_sites, mock) => {
      const client = new WordPressClient(mock.urlFor("no-such-site"), "auditor", TEST_PASSWORD, FAST);
      const error = await expectApiError(client.getPlugins());
      assert.equal(error.kind, "not-found");
      assert.equal(error.status, 404);
      assert.match(error.message, /REST API not reachable at \/wp-json\//);
    });
  });

  test("a site that does not answer is not asked the remaining questions", async () => {
    const slow: FixtureSite = {
      ...sampleFixture("demo-bakery"),
      siteId: "slow",
      failures: { plugins: { delayMs: 1500 } },
    };
    await withMockSites([slow], async ([site], mock) => {
      assert.ok(site);
      const inventory = await collectSite(site, { ...FAST, timeoutMs: 200 });
      assert.equal(inventory.fetchStatus, "failed");
      assert.equal(inventory.errors.length, 1);
      assert.equal(inventory.errors[0]?.kind, "timeout");
      assert.equal(mock.requests.length, 1);
    });
  });

  test("a server error on the status endpoint gives a partial result, not a crash", async () => {
    const broken: FixtureSite = {
      ...sampleFixture("demo-bakery"),
      siteId: "broken",
      failures: { status: { status: 500 } },
    };
    await withMockSites([broken], async ([site]) => {
      assert.ok(site);
      const inventory = await collectSite(site, FAST);
      assert.equal(inventory.fetchStatus, "partial");
      assert.equal(inventory.plugins.length, 15);
      assert.equal(inventory.errors[0]?.kind, "http");
      assert.ok(inventory.plugins.every((plugin) => plugin.updateAvailable === "unknown"));
    });
  });

  test("collecting with concurrency 0 still finishes every site", async () => {
    await withMockSites([sampleFixture("demo-bakery"), sampleFixture("demo-shop")], async (sites) => {
      const inventories = await collectSites(sites, { ...FAST, concurrency: 0 });
      assert.equal(inventories.length, 2);
    });
  });
});

describe("negative cases: unusual data", () => {
  test("a site with 200 plugins is listed completely", async () => {
    const plugins: FixtureItem[] = [];
    for (let i = 1; i <= 200; i++) {
      plugins.push({ id: `plugin-${i}/plugin-${i}.php`, name: `Plugin ${i}`, version: "1.0.0" });
    }
    const big: FixtureSite = { ...sampleFixture("demo-bakery"), siteId: "big", plugins };

    await withMockSites([big], async ([site]) => {
      assert.ok(site);
      const inventory = await collectSite(site, FAST);
      assert.equal(inventory.fetchStatus, "success");
      assert.equal(inventory.plugins.length, 200);
      assert.ok(inventory.plugins.every((plugin) => plugin.updateAvailable === "no"));
    });
  });

  test("names like 'constructor' or 'toString' cannot trick the update check", () => {
    const transient: UpdateTransient = {
      checked: true,
      lastChecked: 1,
      updates: {},
      noUpdate: ["toString"],
      checkedVersions: { toString: "1.0" },
    };
    assert.equal(resolveUpdate("constructor", "1.0", transient, "test").updateAvailable, "unknown");
    assert.equal(resolveUpdate("hasOwnProperty", "1.0", transient, "test").updateAvailable, "unknown");
    assert.equal(resolveUpdate("toString", "1.0", transient, "test").updateAvailable, "no");
  });
});

describe("negative cases: input files", () => {
  test("a license register saved by Slovenian Excel (semicolons, d. m. yyyy) is read correctly", async () => {
    const dir = await tempDir();
    try {
      const file = join(dir, "licenses.csv");
      const csv =
        "\uFEFFsite_id;plugin_identifier;license_status;expiry_date\r\ndemo-shop;pro/pro.php;Valid;30. 9. 2026\r\n";
      await writeFile(file, csv);

      const licenses = await loadLicenses(file, new Set(["demo-shop"]));
      assert.equal(licenses.found, true);
      assert.equal(licenses.records[0]?.status, "valid");
      assert.equal(licenses.records[0]?.expiryDate, "2026-09-30");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("a register that is not saved as UTF-8 stops with a hint instead of garbling names", async () => {
    const dir = await tempDir();
    try {
      const file = join(dir, "licenses.csv");
      const header = Buffer.from("site_id,plugin_identifier,license_status,owner\r\ndemo-shop,pro/pro.php,valid,");
      const windows1250Name = Buffer.from([0x8a, 0x74, 0x65, 0x66, 0x61, 0x6e, 0x0d, 0x0a]);
      await writeFile(file, Buffer.concat([header, windows1250Name]));

      await assert.rejects(
        loadLicenses(file, new Set(["demo-shop"])),
        (error) => error instanceof ConfigError && /not saved as UTF-8.*CSV UTF-8/.test(error.message),
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("a broken license register or work log stops the report with a clear message", async () => {
    const cwd = await tempDir();
    try {
      await writeFile(join(cwd, "clients.json"), JSON.stringify([VALID_SITE]));
      await writeFile(join(cwd, "agency.json"), JSON.stringify({ agencyName: "Test Agency" }));
      await writeFile(
        join(cwd, "licenses.csv"),
        "site_id,plugin_identifier,license_status\nacme-main,pro/pro.php,maybe\n",
      );

      const licenses = runCli(["report"], {}, cwd);
      assert.equal(licenses.status, 1);
      assert.match(licenses.stderr, /licenses\.csv is invalid/);
      assert.match(licenses.stderr, /row 2: license_status "maybe"/);

      await rm(join(cwd, "licenses.csv"));
      const log =
        "site_id,date,action,component,confirmation_by,confirmation_at\n" +
        "acme-main,2026-10-14,hack,pro/pro.php,Marko,2026-10-14 10:05\n";
      await writeFile(join(cwd, "maintenance_log.csv"), log);

      const work = runCli(["report"], {}, cwd);
      assert.equal(work.status, 1);
      assert.match(work.stderr, /maintenance_log\.csv is invalid/);
      assert.match(work.stderr, /row 2: action "hack"/);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  test("a missing agency.json stops the report and says how to fix it", async () => {
    const cwd = await tempDir();
    try {
      await writeFile(join(cwd, "clients.json"), JSON.stringify([VALID_SITE]));
      const result = runCli(["report"], {}, cwd);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /copy agency\.example\.json to agency\.json/);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  test("a missing clients.json says how to fix it", async () => {
    const cwd = await tempDir();
    try {
      const result = runCli(["collect"], {}, cwd);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /copy clients\.example\.json to clients\.json/);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  test("a corrupt snapshot only affects its own site", async () => {
    const root = await tempDir();
    try {
      const sites = sampleSiteConfigs();
      const paths = {
        agency: SAMPLE_FILES.agency,
        licenses: SAMPLE_FILES.licenses,
        log: SAMPLE_FILES.log,
        snapshots: join(root, "snapshots"),
        reports: join(root, "reports"),
      };
      await collectSample(new Set(sites.map((site) => site.siteId)), { ...FAST, concurrency: 2 }, paths.snapshots);
      await writeFile(join(paths.snapshots, "2026-10-21", "demo-shop.json"), "{ this is not json");

      const result = await generateReports(sites, paths, { generatedAt: SAMPLE_DATES.current, mode: "sample" });
      assert.equal(result.problems.length, 1);
      assert.equal(result.problems[0]?.siteId, "demo-shop");
      assert.match(result.problems[0]?.message ?? "", /not valid JSON/);
      assert.equal(result.sites.length, 3);

      const files = await readdir(result.dir);
      assert.ok(files.includes("r1-consolidated-2026-10.pdf"));
      assert.ok(files.includes("r3-client-demo-bakery-2026-10.pdf"));
      assert.ok(!files.includes("r3-client-demo-shop-2026-10.pdf"));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("a report file that cannot be replaced is a problem, and every other report is still written", async () => {
    const cwd = await tempDir();
    try {
      runCli(["collect", "--sample"], {}, cwd);
      const reportDir = join(cwd, "sample-output", "reports", "2026-10");
      await mkdir(join(reportDir, "r1-inventory-2026-10.csv"), { recursive: true });

      const result = runCli(["report", "--sample"], {}, cwd);
      assert.equal(result.status, 2, result.stderr);
      assert.match(result.stdout, /PROBLEM all sites: r1-inventory-2026-10\.csv could not be/);

      const files = await readdir(reportDir);
      assert.ok(files.includes("r1-consolidated-2026-10.pdf"));
      assert.ok(files.includes("r2-internal-demo-shop-2026-10.pdf"));
      assert.ok(files.includes("r3-client-demo-shop-2026-10.pdf"));
      assert.ok(!files.some((name) => name.endsWith(".tmp")));
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
