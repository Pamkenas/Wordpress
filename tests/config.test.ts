import assert from "node:assert/strict";
import { test } from "node:test";
import { ConfigError, loadSites, parseSites } from "../src/config.ts";

const valid = {
  siteId: "acme-main",
  clientId: "acme",
  url: "https://www.example.com/",
  username: "maintenance-auditor",
  passwordEnv: "WP_ACME_MAIN_APP_PASSWORD",
};

function problems(data: unknown): string[] {
  try {
    parseSites(data);
  } catch (error) {
    assert.ok(error instanceof ConfigError);
    return error.problems;
  }
  assert.fail("expected a ConfigError");
}

test("clients.example.json is valid", async () => {
  const sites = await loadSites("clients.example.json");
  assert.deepEqual(
    sites.map((s) => s.siteId),
    ["local-test", "acme-main"],
  );
});

test("trailing slashes are removed from site URLs", () => {
  assert.equal(parseSites([valid])[0]?.url, "https://www.example.com");
});

test("a password stored in clients.json is rejected with a pointer to .env", () => {
  const [problem] = problems([{ ...valid, password: "abcd 1234" }]);
  assert.match(problem ?? "", /looks like a secret.*\.env/);
});

test("http:// is refused unless allowInsecureHttp is set", () => {
  assert.match(problems([{ ...valid, url: "http://www.example.com" }])[0] ?? "", /https/);
  assert.equal(parseSites([{ ...valid, url: "http://localhost/wordpress", allowInsecureHttp: true }]).length, 1);
});

test("site ids must be safe file names and unique", () => {
  assert.match(problems([{ ...valid, siteId: "../../etc" }])[0] ?? "", /siteId/);
  assert.match(problems([valid, valid]).join(), /duplicate/);
});

test("URLs with credentials, queries or fragments are rejected", () => {
  assert.equal(problems([{ ...valid, url: "https://user:pw@example.com" }]).length, 1);
  assert.equal(problems([{ ...valid, url: "https://example.com/?a=1" }]).length, 1);
});

test("all problems are reported at once", () => {
  assert.equal(
    problems([{ siteId: "OK NOT", clientId: "", url: "nope", username: "", passwordEnv: "lower" }]).length,
    5,
  );
});
