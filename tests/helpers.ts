import type { SiteConfig } from "../src/config.ts";
import { buildMockSite, SAMPLE_SITES, type FixtureSite } from "../src/sample/fixtures.ts";
import { startMockWordPress, type MockWordPress } from "../src/sample/mock-wordpress.ts";

export const TEST_PASSWORD = "abcd EFGH 1234 ijkl MNOP 5678";
export const TEST_PASSWORD_ENV = "TEST_WP_APP_PASSWORD";
export const FAST = { timeoutMs: 2000, retries: 0, retryDelayMs: 10 };

export function sampleFixture(siteId: string): FixtureSite {
  const fixture = SAMPLE_SITES.find((s) => s.siteId === siteId);
  if (!fixture) throw new Error(`no sample fixture ${siteId}`);
  return fixture;
}

export async function withMockSites<T>(
  fixtures: FixtureSite[],
  fn: (sites: SiteConfig[], mock: MockWordPress) => Promise<T>,
): Promise<T> {
  process.env[TEST_PASSWORD_ENV] = TEST_PASSWORD;
  const password = TEST_PASSWORD.replace(/\s+/g, "");
  const mock = await startMockWordPress(fixtures.map((f) => buildMockSite(f, "auditor", password, new Date())));
  const sites: SiteConfig[] = fixtures.map((f) => ({
    siteId: f.siteId,
    clientId: f.clientId,
    url: mock.urlFor(f.siteId),
    username: "auditor",
    passwordEnv: TEST_PASSWORD_ENV,
    allowInsecureHttp: true,
  }));
  try {
    return await fn(sites, mock);
  } finally {
    await mock.close();
  }
}
