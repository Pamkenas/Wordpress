import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { compareVersions, diffInventories } from "../src/diff.ts";
import type { PluginInventory, SiteInventory, ThemeInventory } from "../src/types.ts";

const UPDATE = { updateAvailable: "no", offeredVersion: null, source: "t", lastCheck: null, updateNote: null } as const;

function plugin(
  identifier: string,
  version: string,
  status: "active" | "inactive" = "active",
  kind: PluginInventory["kind"] = "plugin",
): PluginInventory {
  return { identifier, kind, name: identifier, installedVersion: version, status, ...UPDATE };
}

function theme(slug: string, version: string, status: "active" | "inactive"): ThemeInventory {
  return { slug, name: slug, installedVersion: version, status, ...UPDATE };
}

function inventory(core: string | null, plugins: PluginInventory[], themes: ThemeInventory[] = []): SiteInventory {
  return {
    schemaVersion: 1,
    siteId: "site",
    clientId: "client",
    siteUrl: "https://site.example",
    checkedAt: "2026-10-01T00:00:00.000Z",
    fetchStatus: "success",
    error: null,
    errors: [],
    core: { installedVersion: core, availableVersion: null, ...UPDATE },
    plugins,
    themes,
  };
}

describe("compareVersions", () => {
  test("compares numerically, not as text", () => {
    assert.equal(compareVersions("10.0.4", "9.9"), 1);
    assert.equal(compareVersions("3.31.0", "3.32.1"), -1);
    assert.equal(compareVersions("1.0", "1.0.0"), 0);
  });

  test("a pre-release is older than the release", () => {
    assert.equal(compareVersions("2.0-beta", "2.0"), -1);
    assert.equal(compareVersions("2.0", "2.0-rc1"), 1);
  });
});

describe("diffInventories", () => {
  test("finds added, removed, updated, downgraded, activated and deactivated items", () => {
    const before = inventory(
      "7.1.2",
      [plugin("a.php", "1.0"), plugin("b.php", "2.0"), plugin("c.php", "1.0", "inactive"), plugin("gone.php", "1.0")],
      [theme("t1", "1.0", "active"), theme("t2", "1.0", "inactive")],
    );
    const after = inventory(
      "7.1.3",
      [plugin("a.php", "1.1"), plugin("b.php", "1.9"), plugin("c.php", "1.0", "active"), plugin("new.php", "1.0")],
      [theme("t1", "1.0", "inactive"), theme("t2", "1.0", "active")],
    );

    const changes = diffInventories(before, after);
    assert.ok(changes);
    const summary = changes.map((c) => `${c.itemType}:${c.identifier}:${c.kind}`);
    assert.deepEqual(summary, [
      "core:wordpress:updated",
      "plugin:a.php:updated",
      "plugin:b.php:downgraded",
      "plugin:c.php:activated",
      "plugin:gone.php:removed",
      "plugin:new.php:added",
      "theme:t1:deactivated",
      "theme:t2:activated",
    ]);
  });

  test("identical snapshots have no changes", () => {
    const same = inventory("7.1.3", [plugin("a.php", "1.0")]);
    assert.deepEqual(diffInventories(same, same), []);
  });

  test("a failed snapshot cannot be compared", () => {
    const failed = { ...inventory(null, []), fetchStatus: "failed" as const };
    assert.equal(diffInventories(failed, inventory("7.1.3", [])), null);
  });

  test("must-use plugins are not reported as removed when the status endpoint was missing", () => {
    const before = inventory("7.1.3", [plugin("a.php", "1.0"), plugin("mu.php", "1.0", "active", "must-use")]);
    const after = {
      ...inventory(null, [plugin("a.php", "1.0")]),
      fetchStatus: "partial" as const,
      errors: [{ source: "status" as const, kind: "not-found" as const, httpStatus: 404, message: "x" }],
    };
    assert.deepEqual(diffInventories(before, after), []);
  });
});
