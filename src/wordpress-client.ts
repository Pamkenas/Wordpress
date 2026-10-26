import type { ErrorKind } from "./types.ts";

export interface RawPlugin {
  plugin: string;
  name: string;
  status: string;
  version: string;
}

export interface RawTheme {
  stylesheet: string;
  name: string | { raw?: string; rendered?: string };
  status: string;
  version: string;
}

export interface UpdateTransient {
  checked: boolean;
  lastChecked: number | null;
  updates: Record<string, string | null>;
  noUpdate: string[];
  checkedVersions: Record<string, string>;
}

export interface RawExtraPlugin {
  file: string;
  name: string;
  version: string;
}

export interface RawCore {
  installed: string;
  checked: boolean;
  offered: string | null;
  lastChecked: number | null;
}

export interface RawStatus {
  schemaVersion: number;
  pluginVersion: string;
  generatedAt: string;
  core: RawCore;
  plugins: UpdateTransient;
  themes: UpdateTransient;
  mustUsePlugins: RawExtraPlugin[];
  dropins: RawExtraPlugin[];
}

export interface ClientOptions {
  timeoutMs: number;
  retries: number;
  retryDelayMs: number;
}

export const DEFAULT_CLIENT_OPTIONS: ClientOptions = { timeoutMs: 15000, retries: 2, retryDelayMs: 1000 };

interface FetchError {
  cause?: { code?: string; message?: string };
}

const RETRYABLE_KINDS: ErrorKind[] = ["timeout", "network", "rate-limited", "server"];
const MAX_RETRY_AFTER_MS = 10000;
const MAX_BODY_BYTES = 5 * 1024 * 1024;
const TLS_ERROR = /CERT|SSL|TLS|SELF_SIGNED|UNABLE_TO_VERIFY|ALTNAME/;

const NAMED_ENTITIES = new Map<string, number>([
  ["amp", 38],
  ["lt", 60],
  ["gt", 62],
  ["quot", 34],
  ["apos", 39],
  ["nbsp", 160],
  ["ndash", 8211],
  ["mdash", 8212],
  ["hellip", 8230],
  ["lsquo", 8216],
  ["rsquo", 8217],
  ["ldquo", 8220],
  ["rdquo", 8221],
]);

export class WordPressApiError extends Error {
  readonly kind: ErrorKind;
  readonly status: number | null;
  readonly retryAfterMs: number | null;

  constructor(kind: ErrorKind, status: number | null, message: string, retryAfterMs: number | null = null) {
    super(message);
    this.kind = kind;
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTextOrNull(value: unknown): boolean {
  return value === null || typeof value === "string";
}

function isNumberOrNull(value: unknown): boolean {
  return value === null || typeof value === "number";
}

function isListOf(value: unknown, check: (item: unknown) => boolean): boolean {
  return Array.isArray(value) && value.every(check);
}

function isTextMap(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return Object.values(value).every(isTextOrNull);
}

function isRawPlugin(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    typeof value.plugin === "string" &&
    typeof value.name === "string" &&
    typeof value.status === "string" &&
    typeof value.version === "string"
  );
}

function isRawTheme(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const hasName = typeof value.name === "string" || isRecord(value.name);
  return (
    typeof value.stylesheet === "string" &&
    hasName &&
    typeof value.status === "string" &&
    typeof value.version === "string"
  );
}

function isExtraPlugin(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return typeof value.file === "string" && typeof value.name === "string" && typeof value.version === "string";
}

function isTransient(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    typeof value.checked === "boolean" &&
    isNumberOrNull(value.lastChecked) &&
    isTextMap(value.updates) &&
    isListOf(value.noUpdate, (id) => typeof id === "string") &&
    isTextMap(value.checkedVersions)
  );
}

function isRawCore(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    typeof value.installed === "string" &&
    typeof value.checked === "boolean" &&
    isTextOrNull(value.offered) &&
    isNumberOrNull(value.lastChecked)
  );
}

function isRawStatus(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    value.schemaVersion === 1 &&
    isRawCore(value.core) &&
    isTransient(value.plugins) &&
    isTransient(value.themes) &&
    isListOf(value.mustUsePlugins, isExtraPlugin) &&
    isListOf(value.dropins, isExtraPlugin)
  );
}

function entityCode(name: string): number | undefined {
  if (/^#x/i.test(name)) return parseInt(name.slice(2), 16);
  if (name.startsWith("#")) return Number(name.slice(1));
  return NAMED_ENTITIES.get(name);
}

function decodeEntity(entity: string, name: string): string {
  const code = entityCode(name);
  if (code === undefined || !Number.isInteger(code) || code < 1 || code > 0x10ffff) return entity;
  return String.fromCodePoint(code);
}

export function plainText(text: string): string {
  return text
    .replace(/<[^>]*>/g, " ")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, decodeEntity)
    .replace(/\p{Cc}/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function clean(text: string, max = 200): string {
  const plain = plainText(text);
  if (plain.length <= max) return plain;
  return `${plain.slice(0, max - 1)}…`;
}

function kindForStatus(status: number): ErrorKind {
  if (status === 401) return "auth";
  if (status === 403) return "forbidden";
  if (status === 404) return "not-found";
  if (status === 429) return "rate-limited";
  if (status === 502 || status === 503 || status === 504) return "server";
  return "http";
}

function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function invalidShape(route: string): WordPressApiError {
  return new WordPressApiError("invalid-response", null, `unexpected response shape (GET ${route})`);
}

async function readBody(response: Response, route: string): Promise<string> {
  if (!response.body) return "";

  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    if (size > MAX_BODY_BYTES) {
      throw new WordPressApiError("invalid-response", response.status, `response is larger than 5 MB (GET ${route})`);
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function fetchFailure(error: unknown, route: string): WordPressApiError {
  if (error instanceof WordPressApiError) return error;
  if (error instanceof DOMException && error.name === "TimeoutError") {
    return new WordPressApiError("timeout", null, `timed out (GET ${route})`);
  }

  const cause = (error as FetchError).cause;
  const code = cause?.code ?? "";
  if (TLS_ERROR.test(code)) {
    return new WordPressApiError(
      "tls",
      null,
      `TLS error ${code}: the HTTPS certificate or connection is not valid (GET ${route})`,
    );
  }

  let detail = code;
  if (!detail) detail = cause?.message ?? "";
  if (!detail) detail = error instanceof Error ? error.message : String(error);
  return new WordPressApiError("network", null, `network error: ${clean(detail)} (GET ${route})`);
}

function httpError(response: Response, data: unknown, route: string): WordPressApiError {
  const kind = kindForStatus(response.status);

  let code: string | null = null;
  let wordpressMessage: string | null = null;
  if (isRecord(data)) {
    if (typeof data.code === "string") code = clean(data.code, 80);
    if (typeof data.message === "string") wordpressMessage = clean(data.message);
  }

  let message = `HTTP ${response.status}`;
  if (code) message += ` ${code}`;
  if (wordpressMessage) message += `: ${wordpressMessage}`;
  message += ` (GET ${route})`;

  if (code === "rest_not_logged_in") {
    message += "; WordPress did not receive the credentials (check that the server passes the Authorization header)";
  } else if (kind === "not-found" && code === null) {
    message += "; REST API not reachable at /wp-json/ (check permalinks and the site URL)";
  }

  const retryAfter = parseRetryAfter(response.headers.get("retry-after"));
  return new WordPressApiError(kind, response.status, message, retryAfter);
}

export class WordPressClient {
  private readonly baseUrl: string;
  private readonly authorization: string;
  private readonly options: ClientOptions;

  constructor(baseUrl: string, username: string, applicationPassword: string, options: Partial<ClientOptions> = {}) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.options = { ...DEFAULT_CLIENT_OPTIONS, ...options };

    const password = applicationPassword.replace(/\s+/g, "");
    const credentials = Buffer.from(`${username}:${password}`).toString("base64");
    this.authorization = `Basic ${credentials}`;
  }

  async getPlugins(): Promise<RawPlugin[]> {
    const route = "/wp/v2/plugins";
    const data = await this.get(route, "plugin,name,status,version");
    if (!isListOf(data, isRawPlugin)) throw invalidShape(route);
    return data as RawPlugin[];
  }

  async getThemes(): Promise<RawTheme[]> {
    const route = "/wp/v2/themes";
    const data = await this.get(route, "stylesheet,name,status,version");
    if (!isListOf(data, isRawTheme)) throw invalidShape(route);
    return data as RawTheme[];
  }

  async getStatus(): Promise<RawStatus> {
    const route = "/agency-maintenance/v1/status";
    const data = await this.get(route, "");
    if (!isRawStatus(data)) throw invalidShape(route);
    return data as RawStatus;
  }

  private async get(route: string, fields: string): Promise<unknown> {
    let attempt = 0;
    while (true) {
      try {
        return await this.request(route, fields);
      } catch (error) {
        const canRetry = error instanceof WordPressApiError && RETRYABLE_KINDS.includes(error.kind);
        if (!canRetry || attempt >= this.options.retries) throw error;

        const delay = error.retryAfterMs ?? this.options.retryDelayMs * 2 ** attempt;
        await sleep(delay);
        attempt++;
      }
    }
  }

  private async request(route: string, fields: string): Promise<unknown> {
    const url = new URL(`${this.baseUrl}/wp-json${route}`);
    if (fields) url.searchParams.set("_fields", fields);

    let response: Response;
    let body: string;
    try {
      response = await fetch(url, {
        method: "GET",
        headers: { Authorization: this.authorization, Accept: "application/json" },
        redirect: "manual",
        signal: AbortSignal.timeout(this.options.timeoutMs),
      });
      body = await readBody(response, route);
    } catch (error) {
      throw fetchFailure(error, route);
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location") ?? "unknown location";
      throw new WordPressApiError(
        "redirect",
        response.status,
        `redirected to ${clean(location)}; update the site URL in clients.json (GET ${route})`,
      );
    }

    const data = parseJson(body);
    if (!response.ok) throw httpError(response, data, route);

    if (data === undefined) {
      const type = response.headers.get("content-type") ?? "no content type";
      throw new WordPressApiError(
        "invalid-response",
        response.status,
        `expected JSON but received ${clean(type, 60)} (GET ${route}); is the REST API blocked by a security plugin?`,
      );
    }

    return data;
  }
}
