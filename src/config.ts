import { readFile } from "node:fs/promises";

export interface SiteConfig {
  siteId: string;
  clientId: string;
  clientName?: string;
  url: string;
  username: string;
  passwordEnv: string;
  allowInsecureHttp?: boolean;
}

export class ConfigError extends Error {
  readonly problems: string[];

  constructor(source: string, problems: string[]) {
    super(`${source} is invalid:\n  - ${problems.join("\n  - ")}`);
    this.problems = problems;
  }
}

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;
const ENV_PATTERN = /^[A-Z_][A-Z0-9_]*$/;
const KNOWN_KEYS = ["siteId", "clientId", "clientName", "url", "username", "passwordEnv", "allowInsecureHttp"];
const SECRET_KEY_PATTERN = /pass|secret|token|key|auth/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLocalHost(hostname: string): boolean {
  if (hostname === "localhost" || hostname === "[::1]") return true;
  if (/^127\.\d+\.\d+\.\d+$/.test(hostname)) return true;
  return /\.(localhost|local|test)$/.test(hostname);
}

function checkUrl(value: unknown, allowInsecureHttp: boolean, problems: string[], label: string): string | null {
  if (typeof value !== "string" || value.trim() === "") {
    problems.push(`${label}: "url" is required`);
    return null;
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    problems.push(`${label}: "url" is not a valid URL`);
    return null;
  }

  if (url.username || url.password) problems.push(`${label}: "url" must not contain credentials`);
  if (url.search || url.hash) problems.push(`${label}: "url" must not contain a query string or fragment`);

  if (url.protocol === "http:" && !allowInsecureHttp) {
    problems.push(`${label}: "url" must use https:// (set "allowInsecureHttp": true only for a local test instance)`);
  } else if (url.protocol === "http:" && !isLocalHost(url.hostname)) {
    problems.push(
      `${label}: "allowInsecureHttp" only works for a test site on this computer (localhost, *.local, *.test); use https://`,
    );
  } else if (url.protocol !== "https:" && url.protocol !== "http:") {
    problems.push(`${label}: "url" must use https://`);
  }

  return `${url.origin}${url.pathname}`.replace(/\/+$/, "");
}

function checkSite(entry: unknown, index: number, seenIds: Set<string>, problems: string[]): SiteConfig | null {
  const position = `site #${index + 1}`;
  if (!isRecord(entry)) {
    problems.push(`${position}: expected an object`);
    return null;
  }

  const label = typeof entry.siteId === "string" ? `${position} (${entry.siteId})` : position;
  const problemsBefore = problems.length;

  for (const key of Object.keys(entry)) {
    if (KNOWN_KEYS.includes(key)) continue;
    if (SECRET_KEY_PATTERN.test(key)) {
      problems.push(`${label}: "${key}" looks like a secret; store it in .env and reference it with "passwordEnv"`);
    } else {
      problems.push(`${label}: unknown field "${key}"`);
    }
  }

  const { siteId, clientId, clientName, username, passwordEnv, allowInsecureHttp } = entry;

  if (typeof siteId !== "string" || !ID_PATTERN.test(siteId)) {
    problems.push(`${label}: "siteId" must be lowercase letters, digits and dashes`);
  } else if (seenIds.has(siteId)) {
    problems.push(`${label}: duplicate "siteId"`);
  } else {
    seenIds.add(siteId);
  }

  if (typeof clientId !== "string" || !ID_PATTERN.test(clientId)) {
    problems.push(`${label}: "clientId" must be lowercase letters, digits and dashes`);
  }
  if (clientName !== undefined && typeof clientName !== "string") {
    problems.push(`${label}: "clientName" must be a string`);
  }
  if (typeof username !== "string" || username.trim() === "") {
    problems.push(`${label}: "username" is required`);
  }
  if (typeof passwordEnv !== "string" || !ENV_PATTERN.test(passwordEnv)) {
    problems.push(`${label}: "passwordEnv" must be an environment variable name such as WP_ACME_APP_PASSWORD`);
  }
  if (allowInsecureHttp !== undefined && typeof allowInsecureHttp !== "boolean") {
    problems.push(`${label}: "allowInsecureHttp" must be true or false`);
  }

  const url = checkUrl(entry.url, allowInsecureHttp === true, problems, label);
  if (problems.length > problemsBefore || url === null) return null;

  const site: SiteConfig = {
    siteId: String(siteId),
    clientId: String(clientId),
    url,
    username: String(username).trim(),
    passwordEnv: String(passwordEnv),
  };
  if (typeof clientName === "string") site.clientName = clientName;
  if (allowInsecureHttp === true) site.allowInsecureHttp = true;
  return site;
}

export function parseSites(data: unknown, source = "clients.json"): SiteConfig[] {
  if (!Array.isArray(data)) throw new ConfigError(source, ["expected a JSON array of sites"]);
  if (data.length === 0) throw new ConfigError(source, ["no sites configured"]);

  const problems: string[] = [];
  const seenIds = new Set<string>();
  const sites: SiteConfig[] = [];

  for (let index = 0; index < data.length; index++) {
    const site = checkSite(data[index], index, seenIds, problems);
    if (site) sites.push(site);
  }

  if (problems.length > 0) throw new ConfigError(source, problems);
  return sites;
}

export async function loadSites(path: string): Promise<SiteConfig[]> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    const problem =
      code === "ENOENT" ? "file not found (copy clients.example.json to clients.json)" : `cannot read file (${code})`;
    throw new ConfigError(path, [problem]);
  }

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new ConfigError(path, [`not valid JSON: ${(error as Error).message}`]);
  }

  return parseSites(data, path);
}
