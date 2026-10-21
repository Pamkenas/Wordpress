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

export interface RawStatus {
  schemaVersion: number;
  pluginVersion: string;
  generatedAt: string;
  core: {
    installed: string;
    checked: boolean;
    offered: string | null;
    lastChecked: number | null;
  };
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

const RETRYABLE: ReadonlySet<ErrorKind> = new Set(["timeout", "network", "rate-limited", "server"]);
const MAX_RETRY_AFTER_MS = 10000;
const TLS_ERROR = /CERT|SSL|TLS|SELF_SIGNED|UNABLE_TO_VERIFY|ALTNAME/;

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

function isStringMap(value: unknown): value is Record<string, string | null> {
  return isRecord(value) && Object.values(value).every((v) => typeof v === "string" || v === null);
}

function clean(text: string, max = 200): string {
  const plain = text
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > max ? `${plain.slice(0, max - 1)}…` : plain;
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
  return Number.isFinite(seconds) ? Math.min(seconds * 1000, MAX_RETRY_AFTER_MS) : null;
}

function describeFetchFailure(error: unknown, route: string): WordPressApiError {
  if (error instanceof DOMException && error.name === "TimeoutError") {
    return new WordPressApiError("timeout", null, `timed out (GET ${route})`);
  }

  const cause = (error as { cause?: { code?: string; message?: string } }).cause;
  const code = cause?.code ?? "";
  if (TLS_ERROR.test(code)) {
    return new WordPressApiError("tls", null, `TLS certificate verification failed: ${code} (GET ${route})`);
  }

  const detail = code || cause?.message || (error instanceof Error ? error.message : String(error));
  return new WordPressApiError("network", null, `network error: ${clean(detail)} (GET ${route})`);
}

function validatePlugins(data: unknown): RawPlugin[] | null {
  if (!Array.isArray(data)) return null;
  const valid = data.every(
    (p) =>
      isRecord(p) &&
      typeof p.plugin === "string" &&
      typeof p.name === "string" &&
      typeof p.status === "string" &&
      typeof p.version === "string",
  );
  return valid ? (data as RawPlugin[]) : null;
}

function validateThemes(data: unknown): RawTheme[] | null {
  if (!Array.isArray(data)) return null;
  const valid = data.every(
    (t) =>
      isRecord(t) &&
      typeof t.stylesheet === "string" &&
      (typeof t.name === "string" || isRecord(t.name)) &&
      typeof t.status === "string" &&
      typeof t.version === "string",
  );
  return valid ? (data as RawTheme[]) : null;
}

function validTransient(t: unknown): t is UpdateTransient {
  return (
    isRecord(t) &&
    typeof t.checked === "boolean" &&
    (t.lastChecked === null || typeof t.lastChecked === "number") &&
    isStringMap(t.updates) &&
    Array.isArray(t.noUpdate) &&
    t.noUpdate.every((id) => typeof id === "string") &&
    isStringMap(t.checkedVersions)
  );
}

function validExtras(list: unknown): list is RawExtraPlugin[] {
  return (
    Array.isArray(list) &&
    list.every(
      (p) => isRecord(p) && typeof p.file === "string" && typeof p.name === "string" && typeof p.version === "string",
    )
  );
}

function validateStatus(data: unknown): RawStatus | null {
  if (!isRecord(data) || data.schemaVersion !== 1 || !isRecord(data.core)) return null;
  const { core } = data;
  const coreValid =
    typeof core.installed === "string" &&
    typeof core.checked === "boolean" &&
    (core.offered === null || typeof core.offered === "string") &&
    (core.lastChecked === null || typeof core.lastChecked === "number");
  const valid =
    coreValid &&
    validTransient(data.plugins) &&
    validTransient(data.themes) &&
    validExtras(data.mustUsePlugins) &&
    validExtras(data.dropins);
  return valid ? (data as unknown as RawStatus) : null;
}

export class WordPressClient {
  private readonly baseUrl: string;
  private readonly authorization: string;
  private readonly options: ClientOptions;

  constructor(baseUrl: string, username: string, applicationPassword: string, options: Partial<ClientOptions> = {}) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.options = { ...DEFAULT_CLIENT_OPTIONS, ...options };

    const credentials = Buffer.from(`${username}:${applicationPassword.replace(/\s+/g, "")}`).toString("base64");

    this.authorization = `Basic ${credentials}`;
  }

  async getPlugins(): Promise<RawPlugin[]> {
    const route = "/wp/v2/plugins";
    return this.validated(route, await this.get(route, "plugin,name,status,version"), validatePlugins);
  }

  async getThemes(): Promise<RawTheme[]> {
    const route = "/wp/v2/themes";
    return this.validated(route, await this.get(route, "stylesheet,name,status,version"), validateThemes);
  }

  async getStatus(): Promise<RawStatus> {
    const route = "/agency-maintenance/v1/status";
    return this.validated(route, await this.get(route), validateStatus);
  }

  private validated<T>(route: string, data: unknown, validate: (data: unknown) => T | null): T {
    const result = validate(data);
    if (result === null) {
      throw new WordPressApiError("invalid-response", null, `unexpected response shape (GET ${route})`);
    }
    return result;
  }

  private async get(route: string, fields?: string): Promise<unknown> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.attempt(route, fields);
      } catch (error) {
        const retryable = error instanceof WordPressApiError && RETRYABLE.has(error.kind);
        if (!retryable || attempt >= this.options.retries) throw error;
        const delay = error.retryAfterMs ?? this.options.retryDelayMs * 2 ** attempt;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  private async attempt(route: string, fields?: string): Promise<unknown> {
    const url = new URL(`${this.baseUrl}/wp-json${route}`);
    if (fields) url.searchParams.set("_fields", fields);

    let response: Response;
    try {
      response = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: this.authorization,
          Accept: "application/json",
        },
        redirect: "manual",
        signal: AbortSignal.timeout(this.options.timeoutMs),
      });
    } catch (error) {
      throw describeFetchFailure(error, route);
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location") ?? "unknown location";
      throw new WordPressApiError(
        "redirect",
        response.status,
        `redirected to ${clean(location)}; update the site URL in clients.json (GET ${route})`,
      );
    }

    let body: string;
    try {
      body = await response.text();
    } catch (error) {
      throw describeFetchFailure(error, route);
    }

    let data: unknown;
    try {
      data = JSON.parse(body);
    } catch {
      data = undefined;
    }

    if (!response.ok) {
      throw this.httpError(response, data, route);
    }

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

  private httpError(response: Response, data: unknown, route: string): WordPressApiError {
    const kind = kindForStatus(response.status);
    const wpCode = isRecord(data) && typeof data.code === "string" ? clean(data.code, 80) : null;
    const wpMessage = isRecord(data) && typeof data.message === "string" ? clean(data.message) : null;

    let message = `HTTP ${response.status}${wpCode ? ` ${wpCode}` : ""}${wpMessage ? `: ${wpMessage}` : ""} (GET ${route})`;
    if (wpCode === "rest_not_logged_in") {
      message += "; WordPress did not receive the credentials (check that the server passes the Authorization header)";
    } else if (kind === "not-found" && wpCode === null) {
      message += "; REST API not reachable at /wp-json/ (check permalinks and the site URL)";
    }

    return new WordPressApiError(kind, response.status, message, parseRetryAfter(response.headers.get("retry-after")));
  }
}
