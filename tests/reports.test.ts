import assert from "node:assert/strict";
import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { collectSite } from "../src/collect.ts";
import { parseCsv } from "../src/csv.ts";
import { buildSiteReport, type SiteReport } from "../src/report-model.ts";
import { generateReports, prepareReports, type PreparedReports, type ReportPaths } from "../src/reports/generate.ts";
import { imageDataUrl, writePdf } from "../src/reports/pdf.ts";
import { buildR1Csv, R1_COLUMNS } from "../src/reports/r1.ts";
import { buildR2Pdf } from "../src/reports/r2.ts";
import { buildR3Pdf } from "../src/reports/r3.ts";
import { CLIENT_TEXT } from "../src/reports/text.ts";
import {
  SAMPLE_DATES,
  SAMPLE_FILES,
  SAMPLE_PASSWORD_ENV,
  SAMPLE_SITES,
  SAMPLE_USERNAME,
  sampleSiteConfigs,
} from "../src/sample/fixtures.ts";
import { collectSample } from "../src/workflow.ts";
import { FAST, sampleFixture, tempDir, textOf, tinyPng, withMockSites } from "./helpers.ts";

const sites = sampleSiteConfigs();
let root = "";
let paths: ReportPaths;
let prepared: PreparedReports;

before(async () => {
  root = await tempDir();
  paths = {
    agency: SAMPLE_FILES.agency,
    licenses: SAMPLE_FILES.licenses,
    log: SAMPLE_FILES.log,
    snapshots: join(root, "snapshots"),
    reports: join(root, "reports"),
  };
  await collectSample(new Set(sites.map((site) => site.siteId)), { ...FAST, concurrency: 2 }, paths.snapshots);
  prepared = await prepareReports(sites, paths);
});

after(async () => {
  await rm(root, { recursive: true, force: true });
});

function siteReport(siteId: string): SiteReport {
  const report = prepared.reports.find((r) => r.site.siteId === siteId);
  assert.ok(report, `no report for ${siteId}`);
  return report;
}

function r2Text(siteId: string): string {
  return textOf(buildR2Pdf(siteReport(siteId), prepared.agency, SAMPLE_DATES.current).content);
}

function r3Text(siteId: string, language = prepared.agency.language): string {
  return textOf(buildR3Pdf(siteReport(siteId), { ...prepared.agency, language }, null).content);
}

function csvRows(): Array<Record<string, string>> {
  const csv = buildR1Csv(prepared.reports, prepared.agency).replace(/^\uFEFF/, "");
  const table = parseCsv(csv, ",");
  assert.deepEqual(table[0], R1_COLUMNS);

  const rows: Array<Record<string, string>> = [];
  for (const cells of table.slice(1)) {
    if (cells.length <= 1) continue;
    const row: Record<string, string> = {};
    R1_COLUMNS.forEach((column, index) => {
      row[column] = cells[index] ?? "";
    });
    rows.push(row);
  }
  return rows;
}

describe("acceptance: inventory in reports", () => {
  test("the site with 15 plugins and zero updates lists all 15 in its R2 report and in the R1 CSV", () => {
    const bakery = SAMPLE_SITES.find((site) => site.siteId === "demo-bakery");
    assert.ok(bakery);
    const text = r2Text("demo-bakery");
    for (const plugin of bakery.plugins) assert.ok(text.includes(plugin.name), `R2 is missing ${plugin.name}`);

    const rows = csvRows().filter((row) => row.site_id === "demo-bakery" && row.item_type === "plugin");
    assert.equal(rows.length, 15);
    assert.ok(rows.every((row) => row.update_available === "false"));
  });

  test("inactive plugins and themes are included; unknown license and update states stay unknown", () => {
    const rows = csvRows();
    const find = (siteId: string, identifier: string) =>
      rows.find((row) => row.site_id === siteId && row.identifier === identifier);

    assert.equal(find("demo-bakery", "hello.php")?.status, "inactive");
    assert.equal(find("demo-bakery", "twentytwentyfour")?.item_type, "theme");
    assert.equal(find("demo-bakery", "twentytwentyfour")?.status, "inactive");
    assert.equal(find("demo-bakery", "akismet/akismet.php")?.license_status, "unknown");
    assert.equal(find("demo-shop", "pro-page-builder/pro-page-builder.php")?.update_available, "unknown");
    assert.ok(rows.filter((row) => row.item_type !== "site").every((row) => row.license_status !== ""));
  });

  test("the baseline is the last successful snapshot before the month", () => {
    assert.equal(siteReport("demo-shop").currentDate, "2026-10-21");
    assert.equal(siteReport("demo-shop").baselineDate, "2026-09-23");
  });
});

describe("acceptance: failures", () => {
  test("a site returning 403 is marked failed and every other site still gets its reports", async () => {
    const result = await generateReports(sites, paths, { generatedAt: SAMPLE_DATES.current, mode: "sample" });
    const files = await readdir(result.dir);
    for (const site of sites) {
      assert.ok(files.includes(`r2-internal-${site.siteId}-2026-10.pdf`), site.siteId);
      assert.ok(files.includes(`r3-client-${site.siteId}-2026-10.pdf`), site.siteId);
    }

    const failedRow = csvRows().find((row) => row.site_id === "demo-blog");
    assert.equal(failedRow?.item_type, "site");
    assert.equal(failedRow?.fetch_status, "failed");
    assert.match(failedRow?.note ?? "", /403/);
  });

  test("the client report of a failed site never says everything is fine", () => {
    const text = r3Text("demo-blog");
    assert.ok(text.includes(CLIENT_TEXT.sl.statusUnavailable));
    assert.ok(!text.includes(CLIENT_TEXT.sl.noIssues));
  });

  test("themes that could not be read are never reported as 'no themes'", async () => {
    const fixture = { ...sampleFixture("demo-bakery"), siteId: "themes-fail", failures: { themes: { status: 500 } } };
    await withMockSites([fixture], async ([site]) => {
      assert.ok(site);
      const inventory = await collectSite(site, FAST);
      assert.equal(inventory.fetchStatus, "partial");

      const pair = { current: inventory, currentDate: "2026-10-21", baseline: null, baselineDate: null };
      const report = buildSiteReport(site, "2026-10", pair, [], []);
      assert.equal(report.themesCollected, false);

      const internal = textOf(buildR2Pdf(report, prepared.agency, SAMPLE_DATES.current).content);
      assert.ok(internal.includes("Themes could not be read"));
      assert.ok(!internal.includes("No themes installed"));

      const client = textOf(buildR3Pdf(report, prepared.agency, null).content);
      assert.match(client, /Teme\s+—/);
    });
  });

  test("a month without snapshots is reported as not collected", async () => {
    const november = await prepareReports(sites, paths, "2026-11");
    assert.ok(november.reports.every((report) => report.status === "not-collected"));
    assert.match(november.warnings.join(), /no snapshots in 2026-11/);
  });
});

describe("acceptance: confirmed work only", () => {
  test("observed changes are in R2 but never appear in R3 as work", () => {
    const internal = r2Text("demo-shop");
    assert.ok(internal.includes("deactivated"));
    assert.ok(internal.includes("Old Slider"));

    const client = r3Text("demo-shop");
    assert.ok(client.includes("Namestitev: Simple Gallery (2.1.0)"));
    assert.ok(!client.includes("Old Slider"), "unconfirmed removal must not reach the client");
    assert.ok(!client.includes("Hello Dolly"), "an observed deactivation is not agency work");
  });

  test("a WordPress auto-update seen between snapshots is not claimed as work", () => {
    const changes = siteReport("demo-bakery").changes ?? [];
    assert.ok(changes.some((change) => change.itemType === "core" && change.kind === "updated"));

    const client = r3Text("demo-bakery");
    assert.ok(client.includes("Posodobitev: Elementor (3.31.0 › 3.32.1)"));
    assert.ok(!client.includes("7.1.2"));
  });

  test("work logged outside the month is not included", () => {
    assert.ok(!r2Text("demo-shop").includes("September work"));
    assert.equal(siteReport("demo-shop").work.length, 1);
    assert.equal(siteReport("demo-shop").unconfirmedWork.length, 1);
  });
});

describe("acceptance: what the client report must not contain", () => {
  test("no internal notes, other clients, usernames or passwords", () => {
    const client = r3Text("demo-shop");
    const forbidden = [
      "ticket 1042",
      "Waiting for client approval",
      "Renewal invoice",
      "Demo Client A",
      "demo-bakery",
      SAMPLE_USERNAME,
      "rest_",
      process.env[SAMPLE_PASSWORD_ENV] ?? "password-not-set",
    ];
    for (const text of forbidden) assert.ok(!client.includes(text), `R3 contains "${text}"`);
    assert.ok(r2Text("demo-shop").includes("ticket 1042"), "internal notes belong in R2");
  });

  test("written files and the summary contain no credentials", async () => {
    const result = await generateReports(sites, paths, { generatedAt: SAMPLE_DATES.current, mode: "sample" });
    const password = process.env[SAMPLE_PASSWORD_ENV] ?? "password-not-set";
    for (const file of result.files) {
      const content = await readFile(file);
      if (file.endsWith(".pdf")) assert.equal(content.subarray(0, 5).toString(), "%PDF-", file);
      assert.ok(!content.includes(password), `${file} contains the password`);
      assert.ok(!content.includes(SAMPLE_USERNAME), `${file} contains the username`);
    }
    const summary = await readFile(join(result.dir, "_report.json"), "utf8");
    assert.ok(!summary.includes(password));
    assert.equal(JSON.parse(summary).sites.length, sites.length);
  });
});

describe("licenses and branding", () => {
  test("an expired license is flagged internally and as a next step for the client", () => {
    assert.ok(r2Text("demo-shop").includes("expired (recorded: valid)"));
    assert.ok(r3Text("demo-shop").includes("Licenca za Pro Page Builder (premium) zahteva pozornost (potekla)."));
  });

  test("a mistyped register identifier gets a suggestion", () => {
    assert.ok(r2Text("demo-shop").includes("Did you mean wp-mail-smtp/wp_mail_smtp.php?"));
  });

  test("the client report can be produced in English", () => {
    const text = r3Text("demo-shop", "en");
    assert.ok(text.includes("Website maintenance report"));
    assert.ok(text.includes("Installation: Simple Gallery (2.1.0)"));
  });

  test("a PNG logo from agency.json is embedded", async () => {
    const logoFile = join(root, "logo.png");
    await writeFile(logoFile, tinyPng());
    const logo = await imageDataUrl(logoFile);
    const doc = buildR3Pdf(siteReport("demo-shop"), { ...prepared.agency, logo: logoFile }, logo);
    assert.match(String(doc.images?.logo), /^data:image\/png;base64,/);

    const out = join(root, "with-logo.pdf");
    await writePdf(out, doc);
    assert.equal((await readFile(out)).subarray(0, 5).toString(), "%PDF-");
  });
});
