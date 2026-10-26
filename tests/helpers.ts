import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, deflateSync } from "node:zlib";
import type { SiteConfig } from "../src/config.ts";
import { buildMockSite, SAMPLE_SITES, type FixtureSite } from "../src/sample/fixtures.ts";
import { startMockWordPress, type MockWordPress } from "../src/sample/mock-wordpress.ts";
import { WordPressApiError } from "../src/wordpress-client.ts";

const CLI = fileURLToPath(new URL("../src/index.ts", import.meta.url));

export async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "wp-maint-"));
}

export function runCli(args: string[], env: NodeJS.ProcessEnv = {}, cwd: string = process.cwd()) {
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
    cwd,
  });
}

export async function expectApiError(promise: Promise<unknown>): Promise<WordPressApiError> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof WordPressApiError, `expected WordPressApiError, got ${error}`);
    return error;
  }
  assert.fail("expected the request to fail");
}

export function textOf(node: unknown): string {
  if (node === null || node === undefined) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("\n");
  if (typeof node === "object") {
    const record = node as Record<string, unknown>;
    return ["text", "stack", "columns", "ul", "ol", "table", "body"].map((key) => textOf(record[key])).join("\n");
  }
  return "";
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, checksum]);
}

export function tinyPng(width = 8, height = 8): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 0x40)]);
  const pixels = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(pixels)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

export const TEST_PASSWORD = "abcd EFGH 1234 ijkl MNOP 5678";
export const TEST_PASSWORD_ENV = "TEST_WP_APP_PASSWORD";
export const FAST = { timeoutMs: 2000, retries: 0, retryDelayMs: 10 };

export function sampleFixture(siteId: string): FixtureSite {
  const fixture = SAMPLE_SITES.find((s) => s.siteId === siteId);
  if (!fixture) throw new Error(`no sample fixture ${siteId}`);
  return fixture;
}

export async function withMockSites(
  fixtures: FixtureSite[],
  fn: (sites: SiteConfig[], mock: MockWordPress) => Promise<void>,
): Promise<void> {
  process.env[TEST_PASSWORD_ENV] = TEST_PASSWORD;
  const password = TEST_PASSWORD.replace(/\s+/g, "");
  const mock = await startMockWordPress(fixtures.map((f) => buildMockSite(f, "auditor", password, new Date())));
  const sites: SiteConfig[] = fixtures.map((f) => ({
    siteId: f.siteId,
    clientId: f.clientId,
    url: mock.urlFor(f.siteId),
    username: "auditor",
    passwordEnv: TEST_PASSWORD_ENV,
    allowInsecureHttp: true,
  }));
  try {
    await fn(sites, mock);
  } finally {
    await mock.close();
  }
}
