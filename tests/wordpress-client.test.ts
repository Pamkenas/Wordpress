import assert from "node:assert/strict";
import { test } from "node:test";
import type { FixtureSite } from "../src/sample/fixtures.ts";
import { WordPressApiError, WordPressClient } from "../src/wordpress-client.ts";
import { FAST, sampleFixture, TEST_PASSWORD, withMockSites } from "./helpers.ts";

function withFailure(failures: FixtureSite["failures"]): FixtureSite {
  return { ...sampleFixture("demo-bakery"), siteId: "site", ...(failures && { failures }) };
}

async function rejection(promise: Promise<unknown>): Promise<WordPressApiError> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof WordPressApiError, `expected WordPressApiError, got ${error}`);
    return error;
  }
  assert.fail("expected the request to fail");
}

test("application password spaces are stripped and Basic auth is accepted", async () => {
  await withMockSites([withFailure(undefined)], async ([site]) => {
    const client = new WordPressClient(site!.url, "auditor", TEST_PASSWORD, FAST);
    assert.equal((await client.getPlugins()).length, 15);
  });
});

test("a wrong application password is reported as an auth error", async () => {
  await withMockSites([withFailure(undefined)], async ([site]) => {
    const error = await rejection(new WordPressClient(site!.url, "auditor", "wrong", FAST).getPlugins());
    assert.equal(error.kind, "auth");
    assert.equal(error.status, 401);
    assert.match(error.message, /incorrect_password/);
  });
});

test("redirects are never followed, so credentials cannot leak to another host", async () => {
  const site = withFailure({
    plugins: { status: 301, body: "", headers: { Location: "http://attacker.example/wp-json/wp/v2/plugins" } },
  });
  await withMockSites([site], async ([config]) => {
    const error = await rejection(new WordPressClient(config!.url, "auditor", TEST_PASSWORD, FAST).getPlugins());
    assert.equal(error.kind, "redirect");
    assert.match(error.message, /attacker\.example/);
  });
});

test("an HTML page instead of JSON is an invalid response, not a crash", async () => {
  const site = withFailure({ plugins: { status: 200, body: "<html><body>Access denied by firewall</body></html>" } });
  await withMockSites([site], async ([config]) => {
    const error = await rejection(new WordPressClient(config!.url, "auditor", TEST_PASSWORD, FAST).getPlugins());
    assert.equal(error.kind, "invalid-response");
    assert.match(error.message, /expected JSON/);
  });
});

test("JSON of the wrong shape is rejected", async () => {
  const site = withFailure({
    plugins: { status: 200, body: JSON.stringify({ hello: "world" }), contentType: "application/json" },
  });
  await withMockSites([site], async ([config]) => {
    const error = await rejection(new WordPressClient(config!.url, "auditor", TEST_PASSWORD, FAST).getPlugins());
    assert.equal(error.kind, "invalid-response");
  });
});

test("429 is retried and honours Retry-After", async () => {
  const site = withFailure({ themes: { status: 429, headers: { "Retry-After": "0" }, times: 1 } });
  await withMockSites([site], async ([config], mock) => {
    const themes = await new WordPressClient(config!.url, "auditor", TEST_PASSWORD, {
      ...FAST,
      retries: 1,
    }).getThemes();
    assert.equal(themes.length, 3);
    assert.equal(mock.requests.filter((r) => r.path === "/wp/v2/themes").length, 2);
  });
});

test("403 is not retried", async () => {
  const site = withFailure({ plugins: { status: 403, code: "rest_cannot_view_plugins" } });
  await withMockSites([site], async ([config], mock) => {
    const error = await rejection(
      new WordPressClient(config!.url, "auditor", TEST_PASSWORD, { ...FAST, retries: 3 }).getPlugins(),
    );
    assert.equal(error.kind, "forbidden");
    assert.equal(mock.requests.length, 1);
  });
});

test("an unreachable host is a network error", async () => {
  const error = await rejection(new WordPressClient("http://127.0.0.1:1", "auditor", TEST_PASSWORD, FAST).getPlugins());
  assert.equal(error.kind, "network");
});
