import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { SiteConfig } from "../config.ts";
import type { RawExtraPlugin, RawPlugin, RawStatus, RawTheme, UpdateTransient } from "../wordpress-client.ts";
import { startMockWordPress, type MockFailures, type MockSite } from "./mock-wordpress.ts";

export interface FixtureItem {
  id: string;
  name: string;
  version: string;
  active?: boolean;
  offer?: string;
  untracked?: boolean;
  checkedVersion?: string | null;
}

export interface FixtureSite {
  siteId: string;
  clientId: string;
  clientName: string;
  core: { installed: string; offered?: string };
  plugins: FixtureItem[];
  themes: FixtureItem[];
  mustUsePlugins?: RawExtraPlugin[];
  dropins?: RawExtraPlugin[];
  hoursSinceCheck?: number | null;
  statusEndpoint?: boolean;
  failures?: MockFailures;
}

export const SAMPLE_USERNAME = "maintenance-auditor";
export const SAMPLE_PASSWORD_ENV = "SAMPLE_APP_PASSWORD";

export const SAMPLE_DATES = {
  previous: new Date(2026, 8, 23, 9, 0),
  current: new Date(2026, 9, 21, 9, 0),
};

export const SAMPLE_FILES = {
  agency: fileURLToPath(new URL("../../samples/agency.sample.json", import.meta.url)),
  licenses: fileURLToPath(new URL("../../samples/licenses.sample.csv", import.meta.url)),
  log: fileURLToPath(new URL("../../samples/maintenance_log.sample.csv", import.meta.url)),
};

export const SAMPLE_OUTPUT = {
  snapshots: "sample-output/snapshots",
  reports: "sample-output/reports",
};

export function sampleDisplayUrl(siteId: string): string {
  return `https://${siteId}.example`;
}

function transient(items: readonly FixtureItem[], lastChecked: number | null): UpdateTransient {
  if (lastChecked === null)
    return { checked: false, lastChecked: null, updates: {}, noUpdate: [], checkedVersions: {} };

  const result: UpdateTransient = { checked: true, lastChecked, updates: {}, noUpdate: [], checkedVersions: {} };
  for (const item of items) {
    if (item.checkedVersion === null) continue;
    result.checkedVersions[item.id] = item.checkedVersion ?? item.version;
    if (item.offer) result.updates[item.id] = item.offer;
    else if (!item.untracked) result.noUpdate.push(item.id);
  }
  return result;
}

function mockPlugins(items: FixtureItem[]): RawPlugin[] {
  const plugins: RawPlugin[] = [];
  for (const item of items) {
    plugins.push({
      plugin: item.id.replace(/\.php$/, ""),
      name: item.name,
      status: item.active === false ? "inactive" : "active",
      version: item.version,
    });
  }
  return plugins;
}

function mockThemes(items: FixtureItem[]): RawTheme[] {
  const themes: RawTheme[] = [];
  for (const item of items) {
    themes.push({
      stylesheet: item.id,
      name: { raw: item.name, rendered: item.name },
      status: item.active ? "active" : "inactive",
      version: item.version,
    });
  }
  return themes;
}

export function buildMockSite(fixture: FixtureSite, username: string, password: string, now: Date): MockSite {
  const hours = fixture.hoursSinceCheck === undefined ? 3 : fixture.hoursSinceCheck;
  let lastChecked: number | null = null;
  if (hours !== null) lastChecked = Math.floor(now.getTime() / 1000) - hours * 3600;

  let offered: string | null = null;
  if (lastChecked !== null && fixture.core.offered) offered = fixture.core.offered;

  const status: RawStatus = {
    schemaVersion: 1,
    pluginVersion: "1.0.0",
    generatedAt: now.toISOString(),
    core: {
      installed: fixture.core.installed,
      checked: lastChecked !== null,
      offered,
      lastChecked,
    },
    plugins: transient(fixture.plugins, lastChecked),
    themes: transient(fixture.themes, lastChecked),
    mustUsePlugins: fixture.mustUsePlugins ?? [],
    dropins: fixture.dropins ?? [],
  };

  const site: MockSite = {
    siteId: fixture.siteId,
    username,
    password,
    plugins: mockPlugins(fixture.plugins),
    themes: mockThemes(fixture.themes),
    status: fixture.statusEndpoint === false ? null : status,
  };
  if (fixture.failures) site.failures = fixture.failures;
  return site;
}

function current(id: string, name: string, version: string, active = true): FixtureItem {
  return { id, name, version, active };
}

const DEMO_BAKERY: FixtureSite = {
  siteId: "demo-bakery",
  clientId: "demo-client-a",
  clientName: "Demo Client A",
  core: { installed: "7.1.3" },
  plugins: [
    current("akismet/akismet.php", "Akismet Anti-spam: Spam Protection", "5.6"),
    current("classic-editor/classic-editor.php", "Classic Editor", "1.6.7"),
    current("contact-form-7/wp-contact-form-7.php", "Contact Form 7", "6.1.2"),
    current("duplicate-post/duplicate-post.php", "Yoast Duplicate Post", "4.5"),
    current("elementor/elementor.php", "Elementor", "3.32.1"),
    current("hello.php", "Hello Dolly", "1.7.2", false),
    current("litespeed-cache/litespeed-cache.php", "LiteSpeed Cache", "7.5.0.1"),
    current("query-monitor/query-monitor.php", "Query Monitor", "3.19.0", false),
    current("redirection/redirection.php", "Redirection", "5.5.2"),
    current("updraftplus/updraftplus.php", "UpdraftPlus - Backup/Restore", "1.25.8"),
    current("woocommerce/woocommerce.php", "WooCommerce", "10.2.2"),
    current("wordfence/wordfence.php", "Wordfence Security", "8.1.0"),
    current("wordpress-seo/wp-seo.php", "Yoast SEO", "26.2"),
    current("wp-mail-smtp/wp_mail_smtp.php", "WP Mail SMTP", "4.6.0"),
    current("wpforms-lite/wpforms.php", "WPForms Lite", "1.9.8.1"),
  ],
  themes: [
    current("twentytwentyfive", "Twenty Twenty-Five", "1.3"),
    current("twentytwentyfour", "Twenty Twenty-Four", "1.3", false),
    current("twentytwentythree", "Twenty Twenty-Three", "1.6", false),
  ],
};

const DEMO_SHOP: FixtureSite = {
  siteId: "demo-shop",
  clientId: "demo-client-b",
  clientName: "Demo Client B",
  core: { installed: "7.0.4", offered: "7.1.3" },
  plugins: [
    { id: "woocommerce/woocommerce.php", name: "WooCommerce", version: "10.0.4", offer: "10.2.2" },
    { id: "contact-form-7/wp-contact-form-7.php", name: "Contact Form 7", version: "6.0.6", offer: "6.1.2" },
    current("akismet/akismet.php", "Akismet Anti-spam: Spam Protection", "5.6", false),
    current("hello.php", "Hello Dolly", "1.7.2", false),
    {
      id: "pro-page-builder/pro-page-builder.php",
      name: "Pro Page Builder (premium)",
      version: "3.4.0",
      untracked: true,
    },
    { id: "wordpress-seo/wp-seo.php", name: "Yoast SEO", version: "26.2", checkedVersion: "25.9" },
    { id: "simple-gallery/simple-gallery.php", name: "Simple Gallery", version: "2.1.0", checkedVersion: null },
    current("wp-mail-smtp/wp_mail_smtp.php", "WP Mail SMTP", "4.6.0"),
  ],
  themes: [
    { id: "storefront-child", name: "Storefront Child", version: "1.0.0", active: true, untracked: true },
    { id: "storefront", name: "Storefront", version: "4.6.1", active: false, offer: "4.6.2" },
    current("twentytwentyfive", "Twenty Twenty-Five", "1.3", false),
  ],
  mustUsePlugins: [{ file: "hosting-cache-helper.php", name: "Hosting Cache Helper", version: "1.2.0" }],
  dropins: [{ file: "object-cache.php", name: "Redis Object Cache Drop-In", version: "2.6.5" }],
};

const DEMO_PORTFOLIO: FixtureSite = {
  siteId: "demo-portfolio",
  clientId: "demo-client-c",
  clientName: "Demo Client C",
  core: { installed: "7.1.3" },
  statusEndpoint: false,
  plugins: [
    current("akismet/akismet.php", "Akismet Anti-spam: Spam Protection", "5.6"),
    current("wordpress-seo/wp-seo.php", "Yoast SEO", "26.1"),
    current("wp-mail-smtp/wp_mail_smtp.php", "WP Mail SMTP", "4.5.0", false),
  ],
  themes: [
    current("twentytwentyfive", "Twenty Twenty-Five", "1.3"),
    current("twentytwentyfour", "Twenty Twenty-Four", "1.2", false),
  ],
};

const DEMO_BLOG: FixtureSite = {
  siteId: "demo-blog",
  clientId: "demo-client-c",
  clientName: "Demo Client C",
  core: { installed: "7.1.3" },
  plugins: [current("akismet/akismet.php", "Akismet Anti-spam: Spam Protection", "5.6")],
  themes: [current("twentytwentyfive", "Twenty Twenty-Five", "1.3")],
  failures: {
    plugins: { status: 403, code: "rest_cannot_view_plugins" },
    themes: { status: 403, code: "rest_cannot_view_themes" },
  },
};

export const SAMPLE_SITES: readonly FixtureSite[] = [DEMO_BAKERY, DEMO_SHOP, DEMO_PORTFOLIO, DEMO_BLOG];

export const SAMPLE_PREVIOUS_SITES: readonly FixtureSite[] = [
  {
    ...DEMO_BAKERY,
    core: { installed: "7.1.2", offered: "7.1.3" },
    plugins: DEMO_BAKERY.plugins.map((plugin) =>
      plugin.id === "elementor/elementor.php" ? { ...plugin, version: "3.31.0", offer: "3.32.1" } : plugin,
    ),
  },
  {
    ...DEMO_SHOP,
    plugins: [
      ...DEMO_SHOP.plugins
        .filter((plugin) => plugin.id !== "simple-gallery/simple-gallery.php")
        .map((plugin) => (plugin.id === "hello.php" ? { ...plugin, active: true } : plugin)),
      { id: "old-slider/old-slider.php", name: "Old Slider", version: "4.2.0" },
    ],
  },
  DEMO_PORTFOLIO,
  DEMO_BLOG,
];

function sampleSiteConfig(fixture: FixtureSite, url: string): SiteConfig {
  return {
    siteId: fixture.siteId,
    clientId: fixture.clientId,
    clientName: fixture.clientName,
    url,
    username: SAMPLE_USERNAME,
    passwordEnv: SAMPLE_PASSWORD_ENV,
    allowInsecureHttp: true,
  };
}

export function sampleSiteConfigs(): SiteConfig[] {
  return SAMPLE_SITES.map((fixture) => sampleSiteConfig(fixture, sampleDisplayUrl(fixture.siteId)));
}

export async function startSampleSites(
  fixtures: readonly FixtureSite[] = SAMPLE_SITES,
  now = new Date(),
): Promise<{ sites: SiteConfig[]; close: () => Promise<void> }> {
  const password = randomUUID();
  process.env[SAMPLE_PASSWORD_ENV] = password;

  const mock = await startMockWordPress(fixtures.map((f) => buildMockSite(f, SAMPLE_USERNAME, password, now)));
  const sites = fixtures.map((fixture) => sampleSiteConfig(fixture, mock.urlFor(fixture.siteId)));

  return { sites, close: () => mock.close() };
}
