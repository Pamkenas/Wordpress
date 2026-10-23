import { readFileSync } from "node:fs";
import { compareVersions } from "./diff.ts";
import type { UpdateInfo } from "./types.ts";

export const AGENCY_PLUGIN_ID = "agency-maintenance-status/agency-maintenance-status.php";

const PLUGIN_FILE = new URL(
  "../wordpress-plugin/agency-maintenance-status/agency-maintenance-status.php",
  import.meta.url,
);

const SOURCE = "agency plugin in this repository";

function readBundledVersion(): string | null {
  try {
    const header = readFileSync(PLUGIN_FILE, "utf8");
    return /^\s*\*\s*Version:\s*(\S+)/m.exec(header)?.[1] ?? null;
  } catch {
    return null;
  }
}

export const BUNDLED_PLUGIN_VERSION = readBundledVersion();

export function agencyPluginUpdate(installedVersion: string | null): UpdateInfo {
  if (!BUNDLED_PLUGIN_VERSION || !installedVersion) {
    return {
      updateAvailable: "unknown",
      offeredVersion: null,
      source: SOURCE,
      lastCheck: null,
      updateNote: "the agency plugin version could not be compared with this repository",
    };
  }

  if (compareVersions(installedVersion, BUNDLED_PLUGIN_VERSION) < 0) {
    return {
      updateAvailable: "yes",
      offeredVersion: BUNDLED_PLUGIN_VERSION,
      source: SOURCE,
      lastCheck: null,
      updateNote: null,
    };
  }
  return { updateAvailable: "no", offeredVersion: null, source: SOURCE, lastCheck: null, updateNote: null };
}
