export const SNAPSHOT_SCHEMA_VERSION = 1;

export type FetchStatus = "success" | "partial" | "failed";

export type VerificationStatus = "yes" | "no" | "unknown";

export type ActivationStatus = "active" | "inactive" | "unknown";

export type PluginKind = "plugin" | "must-use" | "drop-in";

export type CollectionSource = "config" | "plugins" | "themes" | "status";

export type ErrorKind =
  | "config"
  | "auth"
  | "forbidden"
  | "not-found"
  | "timeout"
  | "network"
  | "tls"
  | "rate-limited"
  | "server"
  | "http"
  | "redirect"
  | "invalid-response";

export interface CollectionError {
  source: CollectionSource;
  kind: ErrorKind;
  httpStatus: number | null;
  message: string;
}

export interface UpdateInfo {
  updateAvailable: VerificationStatus;
  offeredVersion: string | null;
  source: string;
  lastCheck: string | null;
  updateNote: string | null;
}

export interface CoreInventory {
  installedVersion: string | null;
  availableVersion: string | null;
  updateAvailable: VerificationStatus;
  source: string;
  lastCheck: string | null;
  updateNote: string | null;
}

export interface PluginInventory extends UpdateInfo {
  identifier: string;
  kind: PluginKind;
  name: string;
  installedVersion: string | null;
  status: ActivationStatus;
}

export interface ThemeInventory extends UpdateInfo {
  slug: string;
  name: string;
  installedVersion: string | null;
  status: ActivationStatus;
}

export interface SiteInventory {
  schemaVersion: number;
  siteId: string;
  clientId: string;
  siteUrl: string;
  checkedAt: string;
  fetchStatus: FetchStatus;
  error: string | null;
  errors: CollectionError[];
  core: CoreInventory;
  plugins: PluginInventory[];
  themes: ThemeInventory[];
}
