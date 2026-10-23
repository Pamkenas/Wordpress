import assert from "node:assert/strict";
import { writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { describe, test } from "node:test";
import { detectDelimiter, parseCsv, readCsvFile, toCsv } from "../src/csv.ts";
import {
  formatDate,
  formatPeriod,
  isInPeriod,
  isValidPeriod,
  parseDateInput,
  parseDateTimeInput,
  periodEnd,
} from "../src/dates.ts";
import { tempDir } from "./helpers.ts";

describe("csv", () => {
  test("parses quoted fields, doubled quotes, embedded delimiters and line breaks", () => {
    const rows = parseCsv('a,"b, c","say ""hi""","two\nlines"\r\nx,y,z,w\r\n', ",");
    assert.deepEqual(rows, [
      ["a", "b, c", 'say "hi"', "two\nlines"],
      ["x", "y", "z", "w"],
    ]);
  });

  test("a quote inside an unquoted value is an ordinary character", () => {
    assert.deepEqual(parseCsv('5" screen,ok', ","), [['5" screen', "ok"]]);
  });

  test("an unclosed quote is an error, not a silently swallowed file", () => {
    assert.throws(() => parseCsv('a,"never closed\nb,c', ","), /not closed/);
  });

  test("detects the semicolon delimiter Excel uses in a Slovenian locale", () => {
    assert.equal(detectDelimiter("site_id;date;action\nx;y;z"), ";");
    assert.equal(detectDelimiter("site_id,date,action"), ",");
  });

  test("writes a BOM, CRLF line endings, quotes when needed and neutralises formulas", () => {
    const csv = toCsv(
      [
        ["name", "note"],
        ["=HYPERLINK(1)", "a,b"],
      ],
      ",",
    );
    assert.equal(csv, '\uFEFFname,note\r\n\'=HYPERLINK(1),"a,b"\r\n');
  });

  test("readCsvFile normalises headers, skips empty rows and reports unknown columns", async () => {
    const dir = await tempDir();
    try {
      const file = join(dir, "data.csv");
      await writeFile(file, "\uFEFFSite ID;Date;Extra\r\ndemo;2026-10-01;x\r\n;;\r\n");
      const result = await readCsvFile(file, ["site_id", "date"], ["site_id"]);
      assert.ok(result);
      assert.deepEqual(result.rows, [{ row: 2, values: { site_id: "demo", date: "2026-10-01", extra: "x" } }]);
      assert.match(result.warnings.join(), /unknown column "extra"/);
      assert.equal(await readCsvFile(join(dir, "missing.csv"), [], []), null);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("dates", () => {
  test("accepts ISO dates and the dates Excel writes in Slovenian", () => {
    assert.equal(parseDateInput("2026-10-07"), "2026-10-07");
    assert.equal(parseDateInput("7.10.2026"), "2026-10-07");
    assert.equal(parseDateInput("7. 10. 2026"), "2026-10-07");
  });

  test("rejects impossible dates and other formats", () => {
    assert.equal(parseDateInput("2026-02-30"), null);
    assert.equal(parseDateInput("10/07/2026"), null);
    assert.equal(parseDateInput("yesterday"), null);
  });

  test("parses an optional time", () => {
    assert.equal(parseDateTimeInput("2026-10-07 15:10"), "2026-10-07 15:10");
    assert.equal(parseDateTimeInput("7. 10. 2026 9:05"), "2026-10-07 09:05");
    assert.equal(parseDateTimeInput("2026-10-07T15:10:59"), "2026-10-07 15:10");
    assert.equal(parseDateTimeInput("2026-10-07 25:00"), null);
  });

  test("periods", () => {
    assert.ok(isValidPeriod("2026-10"));
    assert.ok(!isValidPeriod("2026-13"));
    assert.equal(periodEnd("2028-02"), "2028-02-29");
    assert.ok(isInPeriod("2026-10-31", "2026-10"));
    assert.ok(!isInPeriod("2026-11-01", "2026-10"));
  });

  test("formats dates and months in English and Slovenian", () => {
    assert.equal(formatDate("2026-10-07", "en"), "7 Oct 2026");
    assert.equal(formatDate("2026-10-07", "sl"), "7. 10. 2026");
    assert.equal(formatPeriod("2026-10", "en"), "October 2026");
    assert.equal(formatPeriod("2026-10", "sl"), "oktober 2026");
  });
});
