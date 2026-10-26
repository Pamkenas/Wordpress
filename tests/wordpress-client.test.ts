import assert from "node:assert/strict";
import { test } from "node:test";
import type { FixtureSite } from "../src/sample/fixtures.ts";
import type { MockFailures } from "../src/sample/mock-wordpress.ts";
import { plainText, WordPressClient } from "../src/wordpress-client.ts";
import { expectApiError, FAST, sampleFixture, TEST_PASSWORD, withMockSites } from "./helpers.ts";

function withFailure(failures?: MockFailures): FixtureSite {
  const site: FixtureSite = { ...sampleFixture("demo-bakery"), siteId: "site" };
  if (failures) site.failures = failures;
  return site;
}

test("application password spaces are stripped and Basic auth is accepted", async () => {
  await withMockSites([withFailure(undefined)], async ([site]) => {
    const client = new WordPressClient(site!.url, "auditor", TEST_PASSWORD, FAST);
    assert.equal((await client.getPlugins()).length, 15);
  });
});

test("a wrong application password is reported as an auth error", async () => {
  await withMockSites([withFailure(undefined)], async ([site]) => {
    const error = await expectApiError(new WordPressClient(site!.url, "auditor", "wrong", FAST).getPlugins());
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
    const error = await expectApiError(new WordPressClient(config!.url, "auditor", TEST_PASSWORD, FAST).getPlugins());
    assert.equal(error.kind, "redirect");
    assert.match(error.message, /attacker\.example/);
  });
});

test("an HTML page instead of JSON is an invalid response, not a crash", async () => {
  const site = withFailure({ plugins: { status: 200, body: "<html><body>Access denied by firewall</body></html>" } });
  await withMockSites([site], async ([config]) => {
    const error = await expectApiError(new WordPressClient(config!.url, "auditor", TEST_PASSWORD, FAST).getPlugins());
    assert.equal(error.kind, "invalid-response");
    assert.match(error.message, /expected JSON/);
  });
});

test("JSON of the wrong shape is rejected", async () => {
  const site = withFailure({
    plugins: { status: 200, body: JSON.stringify({ hello: "world" }), contentType: "application/json" },
  });
  await withMockSites([site], async ([config]) => {
    const error = await expectApiError(new WordPressClient(config!.url, "auditor", TEST_PASSWORD, FAST).getPlugins());
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
    const error = await expectApiError(
      new WordPressClient(config!.url, "auditor", TEST_PASSWORD, { ...FAST, retries: 3 }).getPlugins(),
    );
    assert.equal(error.kind, "forbidden");
    assert.equal(mock.requests.length, 1);
  });
});

test("a response larger than 5 MB is refused instead of filling the memory", async () => {
  const huge = `[${"0,".repeat(3 * 1024 * 1024)}0]`;
  const site = withFailure({ plugins: { status: 200, body: huge, contentType: "application/json" } });
  await withMockSites([site], async ([config]) => {
    const error = await expectApiError(new WordPressClient(config!.url, "auditor", TEST_PASSWORD, FAST).getPlugins());
    assert.equal(error.kind, "invalid-response");
    assert.match(error.message, /larger than 5 MB/);
  });
});

test("error messages from a site lose HTML, entities and terminal control codes", async () => {
  const escape = String.fromCharCode(27);
  const message = `<b>Blocked</b> by &quot;Firewall&quot; &amp; more${escape}[2J`;
  const body = JSON.stringify({ code: "blocked", message });
  const site = withFailure({ plugins: { status: 500, body, contentType: "application/json" } });
  await withMockSites([site], async ([config]) => {
    const error = await expectApiError(new WordPressClient(config!.url, "auditor", TEST_PASSWORD, FAST).getPlugins());
    assert.match(error.message, /^HTTP 500 blocked: Blocked by "Firewall" & more \[2J/);
    assert.ok(!error.message.includes(escape));
  });
});

test("plainText turns WordPress text into plain text and leaves unknown entities alone", () => {
  const dash = String.fromCodePoint(8211);
  assert.equal(plainText("Header &amp; Footer &lt;Pro&gt;"), "Header & Footer <Pro>");
  assert.equal(plainText("Smush &#8211; <em>Lazy</em> &#x41;"), `Smush ${dash} Lazy A`);
  assert.equal(plainText("&bogus; &constructor; &#99999999;"), "&bogus; &constructor; &#99999999;");
});

test("an unreachable host is a network error", async () => {
  const error = await expectApiError(
    new WordPressClient("http://127.0.0.1:1", "auditor", TEST_PASSWORD, FAST).getPlugins(),
  );
  assert.equal(error.kind, "network");
});
