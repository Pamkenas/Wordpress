import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, test } from "node:test";
import { AGENCY_PLUGIN_ID, BUNDLED_PLUGIN_VERSION } from "../src/agency-plugin.ts";
import { collectSite, collectSites, resolveUpdate } from "../src/collect.ts";
import { SAMPLE_SITES, type FixtureSite } from "../src/sample/fixtures.ts";
import type { PluginInventory } from "../src/types.ts";
import { FAST, sampleFixture, withMockSites } from "./helpers.ts";

describe("the agency's own status plugin", () => {
  test("its header version and the VERSION constant in the PHP file match", async () => {
    const php = await readFile(
      new URL("../wordpress-plugin/agency-maintenance-status/agency-maintenance-status.php", import.meta.url),
      "utf8",
    );
    const constant = /const VERSION\s*=\s*'([^']+)'/.exec(php)?.[1];
    assert.ok(BUNDLED_PLUGIN_VERSION);
    assert.equal(constant, BUNDLED_PLUGIN_VERSION);
    assert.match(php, /^\s*\*\s*Update URI:\s*false$/m);
  });

  test("is compared with the version in this repository instead of being 'unknown'", async () => {
    const withPlugin = (siteId: string, version: string): FixtureSite => ({
      ...sampleFixture("demo-portfolio"),
      siteId,
      statusEndpoint: true,
      plugins: [{ id: AGENCY_PLUGIN_ID, name: "Agency Maintenance Status", version, untracked: true }],
    });

    await withMockSites(
      [withPlugin("old-copy", "0.9.0"), withPlugin("same-copy", BUNDLED_PLUGIN_VERSION ?? "")],
      async (sites) => {
        const [old, same] = await collectSites(sites, { ...FAST, concurrency: 2 });
        const oldPlugin = findPlugin(old?.plugins ?? [], AGENCY_PLUGIN_ID);
        assert.equal(oldPlugin.updateAvailable, "yes");
        assert.equal(oldPlugin.offeredVersion, BUNDLED_PLUGIN_VERSION);
        assert.equal(findPlugin(same?.plugins ?? [], AGENCY_PLUGIN_ID).updateAvailable, "no");
      },
    );
  });
});

function findPlugin(plugins: PluginInventory[], id: string): PluginInventory {
  const plugin = plugins.find((item) => item.identifier === id);
  assert.ok(plugin, `missing ${id}`);
  return plugin;
}

describe("acceptance: inventory completeness", () => {
  test("a site with 15 plugins and zero pending updates still lists all 15", async () => {
    await withMockSites([sampleFixture("demo-bakery")], async ([site]) => {
      const inv = await collectSite(site!, FAST);
      assert.equal(inv.fetchStatus, "success");
      assert.equal(inv.plugins.length, 15);
      assert.ok(inv.plugins.every((p) => p.updateAvailable === "no"));
      assert.equal(inv.core.updateAvailable, "no");
      assert.equal(inv.core.installedVersion, "7.1.3");
    });
  });

  test("inactive plugins and inactive themes are included", async () => {
    await withMockSites([sampleFixture("demo-shop")], async ([site]) => {
      const inv = await collectSite(site!, FAST);
      assert.equal(findPlugin(inv.plugins, "hello.php").status, "inactive");
      assert.equal(findPlugin(inv.plugins, "akismet/akismet.php").status, "inactive");
      const parent = inv.themes.find((t) => t.slug === "storefront");
      assert.equal(parent?.status, "inactive");
      assert.equal(parent?.updateAvailable, "yes");
      assert.equal(parent?.offeredVersion, "4.6.2");
      assert.equal(inv.themes.find((t) => t.slug === "storefront-child")?.status, "active");
    });
  });

  test("REST plugin ids are mapped to WordPress basenames so update data matches", async () => {
    await withMockSites([sampleFixture("demo-shop")], async ([site]) => {
      const inv = await collectSite(site!, FAST);
      const woo = findPlugin(inv.plugins, "woocommerce/woocommerce.php");
      assert.equal(woo.updateAvailable, "yes");
      assert.equal(woo.offeredVersion, "10.2.2");
      assert.equal(inv.core.availableVersion, "7.1.3");
    });
  });

  test("must-use plugins and drop-ins are listed with an explicit unknown update state", async () => {
    await withMockSites([sampleFixture("demo-shop")], async ([site]) => {
      const inv = await collectSite(site!, FAST);
      const mu = findPlugin(inv.plugins, "hosting-cache-helper.php");
      assert.equal(mu.kind, "must-use");
      assert.equal(mu.updateAvailable, "unknown");
      assert.equal(findPlugin(inv.plugins, "object-cache.php").kind, "drop-in");
    });
  });
});

describe("acceptance: unknown stays unknown", () => {
  test("premium, stale and newly installed plugins are unknown, never 'no'", async () => {
    await withMockSites([sampleFixture("demo-shop")], async ([site]) => {
      const inv = await collectSite(site!, FAST);
      for (const id of [
        "pro-page-builder/pro-page-builder.php",
        "wordpress-seo/wp-seo.php",
        "simple-gallery/simple-gallery.php",
      ]) {
        const p = findPlugin(inv.plugins, id);
        assert.equal(p.updateAvailable, "unknown", id);
        assert.equal(p.offeredVersion, null, id);
        assert.ok(p.updateNote, `${id} should explain why it is unknown`);
      }
    });
  });

  test("a site that never ran an update check reports every update state as unknown", async () => {
    const fixture: FixtureSite = { ...sampleFixture("demo-bakery"), siteId: "never-checked", hoursSinceCheck: null };
    await withMockSites([fixture], async ([site]) => {
      const inv = await collectSite(site!, FAST);
      assert.equal(inv.fetchStatus, "success");
      assert.ok([inv.core, ...inv.plugins, ...inv.themes].every((i) => i.updateAvailable === "unknown"));
    });
  });

  test("resolveUpdate needs an explicit no_update entry for the installed version", () => {
    const transient = {
      checked: true,
      lastChecked: 1,
      updates: {},
      noUpdate: ["a.php"],
      checkedVersions: { "a.php": "1.0" },
    };
    assert.equal(resolveUpdate("a.php", "1.0", transient, "t").updateAvailable, "no");
    assert.equal(resolveUpdate("a.php", "1.1", transient, "t").updateAvailable, "unknown");
    assert.equal(resolveUpdate("b.php", "1.0", transient, "t").updateAvailable, "unknown");
    assert.equal(resolveUpdate("a.php", "1.0", null, "t").updateAvailable, "unknown");
  });
});

describe("acceptance: failures are isolated", () => {
  test("a site returning 403 is marked failed and the other sites are still collected", async () => {
    await withMockSites([sampleFixture("demo-blog"), sampleFixture("demo-bakery")], async (sites) => {
      const [blocked, healthy] = await collectSites(sites, { ...FAST, concurrency: 2 });
      assert.equal(blocked?.fetchStatus, "failed");
      assert.equal(blocked?.errors[0]?.kind, "forbidden");
      assert.equal(blocked?.errors[0]?.httpStatus, 403);
      assert.match(blocked?.error ?? "", /rest_cannot_view_plugins/);
      assert.equal(healthy?.fetchStatus, "success");
      assert.equal(healthy?.plugins.length, 15);
    });
  });

  test("a site that times out is marked failed and the other sites are still collected", async () => {
    const slow: FixtureSite = {
      ...sampleFixture("demo-bakery"),
      siteId: "slow",
      failures: { plugins: { delayMs: 1500 } },
    };
    await withMockSites([slow, sampleFixture("demo-shop")], async (sites) => {
      const [timedOut, healthy] = await collectSites(sites, { ...FAST, timeoutMs: 200, concurrency: 1 });
      assert.equal(timedOut?.fetchStatus, "failed");
      assert.equal(timedOut?.errors.find((e) => e.source === "plugins")?.kind, "timeout");
      assert.equal(healthy?.fetchStatus, "success");
    });
  });

  test("missing status endpoint gives a partial result with the full inventory", async () => {
    await withMockSites([sampleFixture("demo-portfolio")], async ([site]) => {
      const inv = await collectSite(site!, FAST);
      assert.equal(inv.fetchStatus, "partial");
      assert.equal(inv.plugins.length, 3);
      assert.equal(inv.themes.length, 2);
      assert.equal(inv.core.installedVersion, null);
      assert.ok([inv.core, ...inv.plugins, ...inv.themes].every((i) => i.updateAvailable === "unknown"));
      assert.match(inv.error ?? "", /Agency Maintenance Status plugin/);
    });
  });

  test("a missing password fails the site without any network request", async () => {
    await withMockSites([sampleFixture("demo-bakery")], async ([site], mock) => {
      const inv = await collectSite({ ...site!, passwordEnv: "DOES_NOT_EXIST_PASSWORD" }, FAST);
      assert.equal(inv.fetchStatus, "failed");
      assert.equal(inv.errors[0]?.kind, "config");
      assert.equal(mock.requests.length, 0);
    });
  });

  test("transient 503 responses are retried", async () => {
    const flaky: FixtureSite = {
      ...sampleFixture("demo-bakery"),
      siteId: "flaky",
      failures: { plugins: { status: 503, times: 2 } },
    };
    await withMockSites([flaky], async ([site], mock) => {
      const inv = await collectSite(site!, { ...FAST, retries: 2 });
      assert.equal(inv.fetchStatus, "success");
      assert.equal(mock.requests.filter((r) => r.path === "/wp/v2/plugins").length, 3);
    });
  });
});

describe("acceptance: read-only", () => {
  test("a full collection run sends nothing but GET requests", async () => {
    await withMockSites([...SAMPLE_SITES], async (sites, mock) => {
      await collectSites(sites, { ...FAST, concurrency: 2 });
      assert.equal(mock.requests.length, 10);
      assert.deepEqual(new Set(mock.requests.map((r) => r.method)), new Set(["GET"]));
    });
  });

  test("a site whose plugin list is refused is not asked anything else", async () => {
    await withMockSites([sampleFixture("demo-blog")], async ([site], mock) => {
      assert.ok(site);
      const inventory = await collectSite(site, FAST);
      assert.equal(inventory.fetchStatus, "failed");
      assert.equal(inventory.errors.length, 1);
      assert.equal(mock.requests.length, 1);
    });
  });
});
