export type FetchStatus = "success" | "partial" | "failed";

export type VerificationStatus =
  | "yes"
  | "no"
  | "unknown";

export interface SiteInventory {
  siteId: string;
  siteUrl: string;
  checkedAt: string;
  fetchStatus: FetchStatus;
  error: string | null;

  core: {
    installedVersion: string | null;
    availableVersion: string | null;
    updateAvailable: VerificationStatus;
  };

  plugins: PluginInventory[];
  themes: ThemeInventory[];
}

export interface PluginInventory {
  identifier: string;
  name: string;
  installedVersion: string | null;
  status: "active" | "inactive" | "unknown";
  updateAvailable: VerificationStatus;
  offeredVersion: string | null;
  source: string;
  lastCheck: string | null;
}

export interface ThemeInventory {
  slug: string;
  name: string;
  installedVersion: string | null;
  status: "active" | "inactive" | "unknown";
  updateAvailable: VerificationStatus;
  offeredVersion: string | null;
}
