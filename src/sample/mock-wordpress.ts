import { createServer, type ServerResponse } from "node:http";
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

export interface MockSite {
  siteId: string;
  username: string;
  password: string;
  plugins: RawPlugin[];
  themes: RawTheme[];
  status: RawStatus | null;
  failures?: Partial<Record<MockRoute, MockFailure>>;
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

const ROUTES: Record<string, MockRoute> = {
  "/wp/v2/plugins": "plugins",
  "/wp/v2/themes": "themes",
  "/agency-maintenance/v1/status": "status",
};

function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=UTF-8", ...headers });
  res.end(JSON.stringify(body));
}

function wpError(
  res: ServerResponse,
  status: number,
  code: string,
  message: string,
  headers?: Record<string, string>,
): void {
  sendJson(res, status, { code, message, data: { status } }, headers);
}

export async function startMockWordPress(sites: readonly MockSite[]): Promise<MockWordPress> {
  const bySite = new Map(sites.map((s) => [s.siteId, s]));
  const requests: MockRequest[] = [];
  const failureCounts = new Map<string, number>();

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://mock");
    const match = /^\/([^/]+)\/wp-json(\/.*)$/.exec(url.pathname);
    const site = match ? bySite.get(match[1] ?? "") : undefined;
    const path = match?.[2] ?? url.pathname;
    requests.push({ siteId: site?.siteId ?? "?", method: req.method ?? "?", path });

    if (!site) {
      res.writeHead(404, { "Content-Type": "text/html" });
      res.end("<html><body>Not Found</body></html>");
      return;
    }

    const route = ROUTES[path];
    if (req.method !== "GET" || !route) {
      wpError(res, 404, "rest_no_route", "No route was found matching the URL and request method.");
      return;
    }

    const expected = `Basic ${Buffer.from(`${site.username}:${site.password}`).toString("base64")}`;
    if (!req.headers.authorization) {
      wpError(res, 401, "rest_not_logged_in", "You are not currently logged in.");
      return;
    }
    if (req.headers.authorization !== expected) {
      wpError(res, 401, "incorrect_password", "The provided password is an invalid application password.");
      return;
    }

    const failure = site.failures?.[route];
    const key = `${site.siteId}:${route}`;
    const count = failureCounts.get(key) ?? 0;
    if (failure && (failure.times === undefined || count < failure.times)) {
      failureCounts.set(key, count + 1);
      if (failure.delayMs) await new Promise((resolve) => setTimeout(resolve, failure.delayMs));
      if (res.destroyed) return;

      const status = failure.status ?? 500;
      if (failure.body !== undefined) {
        res.writeHead(status, { "Content-Type": failure.contentType ?? "text/html", ...failure.headers });
        res.end(failure.body);
      } else {
        wpError(res, status, failure.code ?? "mock_error", `Simulated HTTP ${status}.`, failure.headers);
      }
      return;
    }

    if (route === "plugins") sendJson(res, 200, site.plugins);
    else if (route === "themes") sendJson(res, 200, site.themes);
    else if (site.status) sendJson(res, 200, site.status, { "Cache-Control": "no-store, private" });
    else wpError(res, 404, "rest_no_route", "No route was found matching the URL and request method.");
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    urlFor: (siteId) => `http://127.0.0.1:${port}/${siteId}`,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
