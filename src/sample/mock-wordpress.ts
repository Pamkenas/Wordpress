import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { RawPlugin, RawStatus, RawTheme } from "../wordpress-client.ts";

export type MockRoute = "plugins" | "themes" | "status";

export interface MockFailure {
  status?: number;
  code?: string;
  body?: string;
  contentType?: string;
  headers?: Record<string, string>;
  delayMs?: number;
  times?: number;
}

export interface MockFailures {
  plugins?: MockFailure;
  themes?: MockFailure;
  status?: MockFailure;
}

export interface MockSite {
  siteId: string;
  username: string;
  password: string;
  plugins: RawPlugin[];
  themes: RawTheme[];
  status: RawStatus | null;
  failures?: MockFailures;
}

export interface MockRequest {
  siteId: string;
  method: string;
  path: string;
}

export interface MockWordPress {
  urlFor(siteId: string): string;
  readonly requests: MockRequest[];
  close(): Promise<void>;
}

const NO_ROUTE = "No route was found matching the URL and request method.";

function routeFor(path: string): MockRoute | null {
  if (path === "/wp/v2/plugins") return "plugins";
  if (path === "/wp/v2/themes") return "themes";
  if (path === "/agency-maintenance/v1/status") return "status";
  return null;
}

function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=UTF-8", ...headers });
  res.end(JSON.stringify(body));
}

function sendWordPressError(
  res: ServerResponse,
  status: number,
  code: string,
  message: string,
  headers: Record<string, string> = {},
): void {
  sendJson(res, status, { code, message, data: { status } }, headers);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function authorizationFor(site: MockSite): string {
  return `Basic ${Buffer.from(`${site.username}:${site.password}`).toString("base64")}`;
}

async function sendFailure(res: ServerResponse, failure: MockFailure): Promise<void> {
  if (failure.delayMs) await sleep(failure.delayMs);
  if (res.destroyed) return;

  const status = failure.status ?? 500;
  if (failure.body !== undefined) {
    res.writeHead(status, { "Content-Type": failure.contentType ?? "text/html", ...failure.headers });
    res.end(failure.body);
    return;
  }
  sendWordPressError(res, status, failure.code ?? "mock_error", `Simulated HTTP ${status}.`, failure.headers);
}

function sendRoute(res: ServerResponse, site: MockSite, route: MockRoute): void {
  if (route === "plugins") {
    sendJson(res, 200, site.plugins);
  } else if (route === "themes") {
    sendJson(res, 200, site.themes);
  } else if (site.status) {
    sendJson(res, 200, site.status, { "Cache-Control": "no-store, private" });
  } else {
    sendWordPressError(res, 404, "rest_no_route", NO_ROUTE);
  }
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.closeAllConnections();
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

export async function startMockWordPress(sites: readonly MockSite[]): Promise<MockWordPress> {
  const sitesById = new Map<string, MockSite>();
  for (const site of sites) sitesById.set(site.siteId, site);

  const requests: MockRequest[] = [];
  const failureCounts = new Map<string, number>();

  function failureToSend(site: MockSite, route: MockRoute): MockFailure | null {
    const failure = site.failures?.[route];
    if (!failure) return null;

    const key = `${site.siteId}:${route}`;
    const count = failureCounts.get(key) ?? 0;
    if (failure.times !== undefined && count >= failure.times) return null;

    failureCounts.set(key, count + 1);
    return failure;
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://mock");
    const match = /^\/([^/]+)\/wp-json(\/.*)$/.exec(url.pathname);
    const site = match ? sitesById.get(match[1] ?? "") : undefined;
    const path = match?.[2] ?? url.pathname;
    requests.push({ siteId: site?.siteId ?? "?", method: req.method ?? "?", path });

    if (!site) {
      res.writeHead(404, { "Content-Type": "text/html" });
      res.end("<html><body>Not Found</body></html>");
      return;
    }

    const route = routeFor(path);
    if (req.method !== "GET" || !route) {
      sendWordPressError(res, 404, "rest_no_route", NO_ROUTE);
      return;
    }

    if (!req.headers.authorization) {
      sendWordPressError(res, 401, "rest_not_logged_in", "You are not currently logged in.");
      return;
    }
    if (req.headers.authorization !== authorizationFor(site)) {
      sendWordPressError(res, 401, "incorrect_password", "The provided password is an invalid application password.");
      return;
    }

    const failure = failureToSend(site, route);
    if (failure) {
      await sendFailure(res, failure);
      return;
    }

    sendRoute(res, site, route);
  }

  const server = createServer(handle);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    urlFor: (siteId) => `http://127.0.0.1:${port}/${siteId}`,
    requests,
    close: () => closeServer(server),
  };
}
