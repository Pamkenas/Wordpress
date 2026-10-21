import { randomUUID } from "node:crypto";
import type { SiteConfig } from "../config.ts";
import type { RawExtraPlugin, RawStatus, UpdateTransient } from "../wordpress-client.ts";
import { startMockWordPress, type MockFailure, type MockRoute, type MockSite } from "./mock-wordpress.ts";

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
  failures?: Partial<Record<MockRoute, MockFailure>>;
}

export const SAMPLE_USERNAME = "maintenance-auditor";
export const SAMPLE_PASSWORD_ENV = "SAMPLE_APP_PASSWORD";

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

export function buildMockSite(fixture: FixtureSite, username: string, password: string, now: Date): MockSite {
  const hours = fixture.hoursSinceCheck === undefined ? 3 : fixture.hoursSinceCheck;
  const lastChecked = hours === null ? null : Math.floor(now.getTime() / 1000) - hours * 3600;

  const status: RawStatus = {
    schemaVersion: 1,
    pluginVersion: "1.0.0",
    generatedAt: now.toISOString(),
    core: {
      installed: fixture.core.installed,
      checked: lastChecked !== null,
      offered: lastChecked !== null ? (fixture.core.offered ?? null) : null,
      lastChecked,
    },
    plugins: transient(fixture.plugins, lastChecked),
    themes: transient(fixture.themes, lastChecked),
    mustUsePlugins: fixture.mustUsePlugins ?? [],
    dropins: fixture.dropins ?? [],
  };

  return {
    siteId: fixture.siteId,
    username,
    password,
    plugins: fixture.plugins.map((p) => ({
      plugin: p.id.replace(/\.php$/, ""),
      name: p.name,
      status: p.active === false ? "inactive" : "active",
      version: p.version,
    })),
    themes: fixture.themes.map((t) => ({
      stylesheet: t.id,
      name: { raw: t.name, rendered: t.name },
      status: t.active ? "active" : "inactive",
      version: t.version,
    })),
    status: fixture.statusEndpoint === false ? null : status,
    ...(fixture.failures && { failures: fixture.failures }),
  };
}

const current = (id: string, name: string, version: string, active = true): FixtureItem => ({
  id,
  name,
  version,
  active,
});

export const SAMPLE_SITES: readonly FixtureSite[] = [
  {
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
  },
  {
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
  },
  {
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
  },
  {
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
  },
];

export async function startSampleSites(
  fixtures: readonly FixtureSite[] = SAMPLE_SITES,
  now = new Date(),
): Promise<{ sites: SiteConfig[]; close: () => Promise<void> }> {
  const password = randomUUID();
  process.env[SAMPLE_PASSWORD_ENV] = password;

  const mock = await startMockWordPress(fixtures.map((f) => buildMockSite(f, SAMPLE_USERNAME, password, now)));
  const sites: SiteConfig[] = fixtures.map((f) => ({
    siteId: f.siteId,
    clientId: f.clientId,
    clientName: f.clientName,
    url: mock.urlFor(f.siteId),
    username: SAMPLE_USERNAME,
    passwordEnv: SAMPLE_PASSWORD_ENV,
    allowInsecureHttp: true,
  }));

  return { sites, close: () => mock.close() };
}
