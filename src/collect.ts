import { AGENCY_PLUGIN_ID, agencyPluginUpdate } from "./agency-plugin.ts";
import type { SiteConfig } from "./config.ts";
import {
  SNAPSHOT_SCHEMA_VERSION,
  type ActivationStatus,
  type CollectionError,
  type CollectionSource,
  type CoreInventory,
  type PluginInventory,
  type SiteInventory,
  type ThemeInventory,
  type UpdateInfo,
} from "./types.ts";
import {
  plainText,
  WordPressApiError,
  WordPressClient,
  type ClientOptions,
  type RawExtraPlugin,
  type RawPlugin,
  type RawStatus,
  type RawTheme,
  type UpdateTransient,
} from "./wordpress-client.ts";

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
};

function toError(source: CollectionSource, error: unknown): CollectionError {
  if (!(error instanceof WordPressApiError)) {
    const message = error instanceof Error ? error.message : String(error);
    return { source, kind: "network", httpStatus: null, message };
  }

  let message = error.message;
  if (source === "status" && error.kind === "not-found") {
    message += "; is the Agency Maintenance Status plugin installed and active?";
  }
  return { source, kind: error.kind, httpStatus: error.status, message };
}

function toStatus(status: string): ActivationStatus {
  if (status === "active" || status === "network-active") return "active";
  if (status === "inactive") return "inactive";
  return "unknown";
}

function toIso(timestamp: number | null): string | null {
  if (!timestamp) return null;
  const date = new Date(timestamp * 1000);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function textOrNull(value: string | null): string | null {
  if (value === null) return null;
  return plainText(value) || null;
}

function unknownUpdate(note: string, source: string, lastCheck: string | null): UpdateInfo {
  return { updateAvailable: "unknown", offeredVersion: null, source, lastCheck, updateNote: note };
}

export function resolveUpdate(
  id: string,
  installedVersion: string | null,
  transient: UpdateTransient | null,
  sourceName: string,
): UpdateInfo {
  if (!transient) return unknownUpdate(NOTE.noStatus, "none", null);

  const lastCheck = toIso(transient.lastChecked);
  if (!transient.checked) return unknownUpdate(NOTE.neverChecked, sourceName, lastCheck);

  if (!Object.hasOwn(transient.checkedVersions, id)) return unknownUpdate(NOTE.notInCheck, sourceName, lastCheck);
  if (transient.checkedVersions[id] !== installedVersion) return unknownUpdate(NOTE.stale, sourceName, lastCheck);

  if (Object.hasOwn(transient.updates, id)) {
    const offered = textOrNull(transient.updates[id] ?? null);
    return { updateAvailable: "yes", offeredVersion: offered, source: sourceName, lastCheck, updateNote: null };
  }
  if (transient.noUpdate.includes(id)) {
    return { updateAvailable: "no", offeredVersion: null, source: sourceName, lastCheck, updateNote: null };
  }
  return unknownUpdate(NOTE.untracked, sourceName, lastCheck);
}

function themeName(theme: RawTheme): string {
  let name = "";
  if (typeof theme.name === "string") name = theme.name;
  else name = theme.name.raw || theme.name.rendered || "";
  return plainText(name) || theme.stylesheet;
}

function pluginUpdate(identifier: string, installedVersion: string | null, status: RawStatus | null): UpdateInfo {
  if (identifier === AGENCY_PLUGIN_ID) return agencyPluginUpdate(installedVersion);
  const transient = status ? status.plugins : null;
  return resolveUpdate(identifier, installedVersion, transient, "update_plugins transient");
}

function extraPlugin(item: RawExtraPlugin, kind: "must-use" | "drop-in", note: string): PluginInventory {
  return {
    identifier: item.file,
    kind,
    name: plainText(item.name) || item.file,
    installedVersion: textOrNull(item.version),
    status: "active",
    ...unknownUpdate(note, "none", null),
  };
}

function normalizePlugins(raw: RawPlugin[], status: RawStatus | null): PluginInventory[] {
  const plugins: PluginInventory[] = [];

  for (const item of raw) {
    const identifier = `${item.plugin}.php`;
    const installedVersion = textOrNull(item.version);
    plugins.push({
      identifier,
      kind: "plugin",
      name: plainText(item.name) || identifier,
      installedVersion,
      status: toStatus(item.status),
      ...pluginUpdate(identifier, installedVersion, status),
    });
  }

  if (status) {
    for (const item of status.mustUsePlugins) plugins.push(extraPlugin(item, "must-use", NOTE.mustUse));
    for (const item of status.dropins) plugins.push(extraPlugin(item, "drop-in", NOTE.dropin));
  }

  plugins.sort((a, b) => a.identifier.localeCompare(b.identifier));
  return plugins;
}

function normalizeThemes(raw: RawTheme[], status: RawStatus | null): ThemeInventory[] {
  const themes: ThemeInventory[] = [];
  const transient = status ? status.themes : null;

  for (const item of raw) {
    const installedVersion = textOrNull(item.version);
    themes.push({
      slug: item.stylesheet,
      name: themeName(item),
      installedVersion,
      status: toStatus(item.status),
      ...resolveUpdate(item.stylesheet, installedVersion, transient, "update_themes transient"),
    });
  }

  themes.sort((a, b) => a.slug.localeCompare(b.slug));
  return themes;
}

function normalizeCore(status: RawStatus | null): CoreInventory {
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

  const core = status.core;
  if (!core.checked) {
    return {
      installedVersion: textOrNull(core.installed),
      availableVersion: null,
      updateAvailable: "unknown",
      source: "update_core transient",
      lastCheck: toIso(core.lastChecked),
      updateNote: NOTE.coreStale,
    };
  }

  return {
    installedVersion: textOrNull(core.installed),
    availableVersion: textOrNull(core.offered),
    updateAvailable: core.offered ? "yes" : "no",
    source: "update_core transient",
    lastCheck: toIso(core.lastChecked),
    updateNote: null,
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

function errorSummary(errors: CollectionError[]): string | null {
  if (errors.length === 0) return null;
  return errors.map((error) => `${error.source}: ${error.message}`).join("; ");
}

export async function collectSite(
  site: SiteConfig,
  options: Partial<ClientOptions> = {},
  now: () => Date = () => new Date(),
): Promise<SiteInventory> {
  const result = emptyInventory(site, now().toISOString());
  const errors = result.errors;

  const password = process.env[site.passwordEnv];
  if (!password) {
    const message = `environment variable ${site.passwordEnv} is not set`;
    errors.push({ source: "config", kind: "config", httpStatus: null, message });
    result.error = `config: ${message}`;
    return result;
  }

  const client = new WordPressClient(site.url, site.username, password, options);

  let plugins: RawPlugin[];
  try {
    plugins = await client.getPlugins();
  } catch (error) {
    errors.push(toError("plugins", error));
    result.error = errorSummary(errors);
    return result;
  }

  let themes: RawTheme[] | null = null;
  try {
    themes = await client.getThemes();
  } catch (error) {
    errors.push(toError("themes", error));
  }

  let status: RawStatus | null = null;
  try {
    status = await client.getStatus();
  } catch (error) {
    errors.push(toError("status", error));
  }

  result.core = normalizeCore(status);
  result.plugins = normalizePlugins(plugins, status);
  if (themes) result.themes = normalizeThemes(themes, status);
  result.fetchStatus = errors.length > 0 ? "partial" : "success";
  result.error = errorSummary(errors);
  return result;
}

async function collectSiteSafely(site: SiteConfig, options: ClientOptions, now: () => Date): Promise<SiteInventory> {
  const startedAt = now().toISOString();
  try {
    return await collectSite(site, options, now);
  } catch (error) {
    const failed = emptyInventory(site, startedAt);
    const problem = toError("plugins", error);
    failed.errors.push(problem);
    failed.error = `unexpected: ${problem.message}`;
    return failed;
  }
}

export async function collectSites(sites: readonly SiteConfig[], options: CollectOptions): Promise<SiteInventory[]> {
  const now = options.now ?? (() => new Date());
  const clientOptions: ClientOptions = {
    timeoutMs: options.timeoutMs,
    retries: options.retries,
    retryDelayMs: options.retryDelayMs,
  };
  const batchSize = Math.max(1, options.concurrency);

  const results: SiteInventory[] = [];
  for (let start = 0; start < sites.length; start += batchSize) {
    const batch = sites.slice(start, start + batchSize);
    const inventories = await Promise.all(batch.map((site) => collectSiteSafely(site, clientOptions, now)));
    results.push(...inventories);
  }
  return results;
}
