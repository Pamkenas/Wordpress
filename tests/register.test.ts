import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { parseAgency } from "../src/agency.ts";
import { ConfigError } from "../src/config.ts";
import type { CsvRow } from "../src/csv.ts";
import { effectiveLicenseStatus, parseLicenseRows } from "../src/licenses.ts";
import { isConfirmed, parseLogRows } from "../src/maintenance-log.ts";

const SITES = new Set(["demo-shop"]);

function rows(...values: Array<Record<string, string>>): CsvRow[] {
  return values.map((record, index) => ({ row: index + 2, values: record }));
}

function problems(run: () => unknown): string[] {
  try {
    run();
  } catch (error) {
    assert.ok(error instanceof ConfigError);
    return error.problems;
  }
  assert.fail("expected a ConfigError");
}

describe("license register", () => {
  const license = {
    site_id: "demo-shop",
    plugin_identifier: "pro/pro.php",
    license_status: "Valid",
    expiry_date: "30. 9. 2026",
  };

  test("parses a row and normalises the status and date", () => {
    const { records } = parseLicenseRows(rows(license), "licenses.csv", SITES);
    assert.equal(records[0]?.status, "valid");
    assert.equal(records[0]?.expiryDate, "2026-09-30");
  });

  test("a valid license past its expiry date is reported as expired", () => {
    const { records } = parseLicenseRows(rows(license), "licenses.csv", SITES);
    assert.equal(effectiveLicenseStatus(records[0], "2026-10-21"), "expired");
    assert.equal(effectiveLicenseStatus(records[0], "2026-09-30"), "valid");
    assert.equal(effectiveLicenseStatus(undefined, "2026-10-21"), "unknown");
  });

  test("rejects unknown statuses, bad dates and duplicates", () => {
    const found = problems(() =>
      parseLicenseRows(
        rows(
          { ...license, plugin_identifier: "a/a.php", license_status: "ok?" },
          { ...license, plugin_identifier: "b/b.php", expiry_date: "soon" },
          license,
          license,
        ),
        "licenses.csv",
        SITES,
      ),
    );
    assert.equal(found.length, 3);
    assert.match(found.join("\n"), /license_status "ok\?"/);
    assert.match(found.join("\n"), /expiry_date "soon"/);
    assert.match(found.join("\n"), /duplicate/);
  });

  test("rows for sites that are not in clients.json are ignored with a warning", () => {
    const { records, warnings } = parseLicenseRows(rows({ ...license, site_id: "old" }), "licenses.csv", SITES);
    assert.equal(records.length, 0);
    assert.match(warnings[0] ?? "", /not in clients.json/);
  });
});

describe("maintenance log", () => {
  const entry = {
    site_id: "demo-shop",
    date: "2026-10-14",
    action: "Install",
    component: "simple-gallery/simple-gallery.php",
    version_after: "2.1.0",
    confirmation_by: "Marko",
    confirmation_at: "2026-10-14 10:05",
  };

  test("an entry with both confirmation fields is confirmed", () => {
    const { entries } = parseLogRows(rows(entry), "log.csv", SITES);
    assert.equal(entries[0]?.action, "install");
    assert.ok(entries[0] && isConfirmed(entries[0]));
  });

  test("an entry with both confirmation fields empty is unconfirmed", () => {
    const { entries } = parseLogRows(rows({ ...entry, confirmation_by: "", confirmation_at: "" }), "log.csv", SITES);
    assert.ok(entries[0] && !isConfirmed(entries[0]));
  });

  test("half-filled confirmation, confirmation before the work and unknown actions are rejected", () => {
    const found = problems(() =>
      parseLogRows(
        rows(
          { ...entry, confirmation_at: "" },
          { ...entry, confirmation_at: "2026-10-13 09:00" },
          { ...entry, action: "hack" },
          { ...entry, date: "14/10/2026" },
        ),
        "log.csv",
        SITES,
      ),
    );
    assert.equal(found.length, 4);
    assert.match(found.join("\n"), /fill both confirmation_by and confirmation_at/);
    assert.match(found.join("\n"), /before the work date/);
    assert.match(found.join("\n"), /action "hack"/);
    assert.match(found.join("\n"), /date "14\/10\/2026"/);
  });

  test("entries are sorted by date", () => {
    const { entries } = parseLogRows(
      rows({ ...entry, date: "2026-10-20", confirmation_at: "2026-10-20" }, entry),
      "log.csv",
      SITES,
    );
    assert.deepEqual(
      entries.map((e) => e.date),
      ["2026-10-14", "2026-10-20"],
    );
  });
});

describe("agency settings", () => {
  test("fills defaults and resolves the logo next to agency.json", () => {
    const agency = parseAgency({ agencyName: "Agency", logo: "brand/logo.png" }, "agency.json", "/base");
    assert.equal(agency.language, "en");
    assert.equal(agency.csvDelimiter, ",");
    assert.equal(agency.primaryColor, "#1f6f8b");
    assert.ok(agency.logo?.replace(/\\/g, "/").endsWith("/base/brand/logo.png"));
  });

  test("reports every problem at once", () => {
    const found = problems(() =>
      parseAgency(
        { primaryColor: "blue", language: "de", csvDelimiter: "|", logo: "logo.gif", extra: 1 },
        "agency.json",
        "/",
      ),
    );
    assert.equal(found.length, 6);
  });
});
