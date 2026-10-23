import { AGENCY_PLUGIN_ID, agencyPluginUpdate } from "./agency-plugin.ts";
import type { SiteConfig } from "./config.ts";
import {
  WordPressApiError,
  WordPressClient,
  type ClientOptions,
  type RawExtraPlugin,
  type RawPlugin,
  type RawStatus,
  type RawTheme,
  type UpdateTransient,
} from "./wordpress-client.ts";
import {
  SNAPSHOT_SCHEMA_VERSION,
  type ActivationStatus,
  type CollectionError,
  type CollectionSource,
  type PluginInventory,
  type SiteInventory,
  type ThemeInventory,
  type UpdateInfo,
} from "./types.ts";

export interface CollectOptions extends ClientOptions {
  concurrency: number;
  now?: () => Date;
}

const NOTE = {
  noStatus: "update data unavailable (status endpoint could not be read)",
  neverChecked: "WordPress has not completed an update check yet",
  notInCheck: "not included in the last WordPress update check",
  stale: "installed version changed since the last update check",
  untracked: "no update channel reported (premium or custom plugin/theme?); verify manually",
  mustUse: "must-use plugins are not checked for updates by WordPress",
  dropin: "drop-ins are not checked for updates by WordPress",
  coreStale: "core update check is missing or older than the installed version",
} as const;

function toError(source: CollectionSource, error: unknown): CollectionError {
  if (error instanceof WordPressApiError) {
    let message = error.message;
    if (source === "status" && error.kind === "not-found") {
      message += "; is the Agency Maintenance Status plugin installed and active?";
    }
    return { source, kind: error.kind, httpStatus: error.status, message };
  }
  return { source, kind: "network", httpStatus: null, message: error instanceof Error ? error.message : String(error) };
}

function toStatus(status: string): ActivationStatus {
  if (status === "active" || status === "network-active") return "active";
  if (status === "inactive") return "inactive";
  return "unknown";
}

function toIso(timestamp: number | null | undefined): string | null {
  return timestamp ? new Date(timestamp * 1000).toISOString() : null;
}

function unknown(note: string, source: string, lastCheck: string | null = null): UpdateInfo {
  return { updateAvailable: "unknown", offeredVersion: null, source, lastCheck, updateNote: note };
}

export function resolveUpdate(
  id: string,
  installedVersion: string | null,
  transient: UpdateTransient | null,
  sourceName: string,
): UpdateInfo {
  if (!transient) return unknown(NOTE.noStatus, "none");

  const lastCheck = toIso(transient.lastChecked);
  if (!transient.checked) return unknown(NOTE.neverChecked, sourceName, lastCheck);

  const checkedVersion = transient.checkedVersions[id];
  if (checkedVersion === undefined) return unknown(NOTE.notInCheck, sourceName, lastCheck);
  if (checkedVersion !== installedVersion) return unknown(NOTE.stale, sourceName, lastCheck);

  if (Object.hasOwn(transient.updates, id)) {
    return {
      updateAvailable: "yes",
      offeredVersion: transient.updates[id] ?? null,
      source: sourceName,
      lastCheck,
      updateNote: null,
    };
  }
  if (transient.noUpdate.includes(id)) {
    return { updateAvailable: "no", offeredVersion: null, source: sourceName, lastCheck, updateNote: null };
  }
  return unknown(NOTE.untracked, sourceName, lastCheck);
}

function themeName(theme: RawTheme): string {
  if (typeof theme.name === "string") return theme.name;
  return theme.name.raw || theme.name.rendered || theme.stylesheet;
}

function normalizePlugins(raw: RawPlugin[], status: RawStatus | null): PluginInventory[] {
  const plugins: PluginInventory[] = raw.map((p) => {
    const identifier = `${p.plugin}.php`;
    const installedVersion = p.version || null;
    const update =
      identifier === AGENCY_PLUGIN_ID
        ? agencyPluginUpdate(installedVersion)
        : resolveUpdate(identifier, installedVersion, status?.plugins ?? null, "update_plugins transient");
    return {
      identifier,
      kind: "plugin",
      name: p.name || identifier,
      installedVersion,
      status: toStatus(p.status),
      ...update,
    };
  });

  const extra = (list: RawExtraPlugin[], kind: "must-use" | "drop-in", note: string): PluginInventory[] =>
    list.map((p) => ({
      identifier: p.file,
      kind,
      name: p.name || p.file,
      installedVersion: p.version || null,
      status: "active",
      ...unknown(note, "none"),
    }));

  if (status) {
    plugins.push(
      ...extra(status.mustUsePlugins, "must-use", NOTE.mustUse),
      ...extra(status.dropins, "drop-in", NOTE.dropin),
    );
  }

  return plugins.sort((a, b) => a.identifier.localeCompare(b.identifier));
}

function normalizeThemes(raw: RawTheme[], status: RawStatus | null): ThemeInventory[] {
  return raw
    .map((t) => {
      const installedVersion = t.version || null;
      return {
        slug: t.stylesheet,
        name: themeName(t),
        installedVersion,
        status: toStatus(t.status),
        ...resolveUpdate(t.stylesheet, installedVersion, status?.themes ?? null, "update_themes transient"),
      };
    })
    .sort((a, b) => a.slug.localeCompare(b.slug));
}

function normalizeCore(status: RawStatus | null): SiteInventory["core"] {
  if (!status) {
    return {
      installedVersion: null,
      availableVersion: null,
      updateAvailable: "unknown",
      source: "none",
      lastCheck: null,
      updateNote: NOTE.noStatus,
    };
  }

  const { installed, checked, offered, lastChecked } = status.core;
  return {
    installedVersion: installed,
    availableVersion: checked ? offered : null,
    updateAvailable: !checked ? "unknown" : offered ? "yes" : "no",
    source: "update_core transient",
    lastCheck: toIso(lastChecked),
    updateNote: checked ? null : NOTE.coreStale,
  };
}

function emptyInventory(site: SiteConfig, checkedAt: string): SiteInventory {
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    siteId: site.siteId,
    clientId: site.clientId,
    siteUrl: site.url,
    checkedAt,
    fetchStatus: "failed",
    error: null,
    errors: [],
    core: normalizeCore(null),
    plugins: [],
    themes: [],
  };
}

export async function collectSite(
  site: SiteConfig,
  options: Partial<ClientOptions> = {},
  now: () => Date = () => new Date(),
): Promise<SiteInventory> {
  const result = emptyInventory(site, now().toISOString());

  const password = process.env[site.passwordEnv];
  if (!password) {
    result.errors.push({
      source: "config",
      kind: "config",
      httpStatus: null,
      message: `environment variable ${site.passwordEnv} is not set`,
    });
    result.error = `config: ${result.errors[0]?.message}`;
    return result;
  }

  const client = new WordPressClient(site.url, site.username, password, options);
  const [plugins, themes, status] = await Promise.allSettled([
    client.getPlugins(),
    client.getThemes(),
    client.getStatus(),
  ]);

  if (plugins.status === "rejected") result.errors.push(toError("plugins", plugins.reason));
  if (themes.status === "rejected") result.errors.push(toError("themes", themes.reason));
  if (status.status === "rejected") result.errors.push(toError("status", status.reason));

  const st = status.status === "fulfilled" ? status.value : null;
  result.core = normalizeCore(st);
  if (plugins.status === "fulfilled") result.plugins = normalizePlugins(plugins.value, st);
  if (themes.status === "fulfilled") result.themes = normalizeThemes(themes.value, st);

  if (plugins.status === "rejected") result.fetchStatus = "failed";
  else result.fetchStatus = result.errors.length > 0 ? "partial" : "success";

  result.error = result.errors.length > 0 ? result.errors.map((e) => `${e.source}: ${e.message}`).join("; ") : null;
  return result;
}

export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;

  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index] as T);
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return results;
}

export function collectSites(sites: readonly SiteConfig[], options: CollectOptions): Promise<SiteInventory[]> {
  const { concurrency, now = () => new Date(), ...clientOptions } = options;
  return mapLimit(sites, concurrency, async (site) => {
    const startedAt = now().toISOString();
    try {
      return await collectSite(site, clientOptions, now);
    } catch (error) {
      const failed = emptyInventory(site, startedAt);
      failed.errors.push(toError("plugins", error));
      failed.error = `unexpected: ${failed.errors[0]?.message}`;
      return failed;
    }
  });
}
