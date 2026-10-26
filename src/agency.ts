import { access, readFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { ConfigError } from "./config.ts";
import type { CsvDelimiter } from "./csv.ts";

export type Language = "en" | "sl";

export interface AgencyConfig {
  agencyName: string;
  contactEmail: string | null;
  website: string | null;
  primaryColor: string;
  logo: string | null;
  language: Language;
  csvDelimiter: CsvDelimiter;
}

const KNOWN_KEYS = ["agencyName", "contactEmail", "website", "primaryColor", "logo", "language", "csvDelimiter"];
const DEFAULT_COLOR = "#1f6f8b";
const LOGO_EXTENSIONS = [".png", ".jpg", ".jpeg"];

function readText(entry: Record<string, unknown>, key: string, problems: string[]): string | null {
  const value = entry[key];
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    problems.push(`"${key}" must be a string`);
    return null;
  }
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function toLanguage(value: string): Language | null {
  if (value === "en" || value === "sl") return value;
  return null;
}

function toDelimiter(value: string): CsvDelimiter | null {
  if (value === "," || value === ";") return value;
  return null;
}

export function parseAgency(data: unknown, source: string, baseDir: string): AgencyConfig {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new ConfigError(source, ["expected a JSON object"]);
  }

  const entry = data as Record<string, unknown>;
  const problems: string[] = [];

  for (const key of Object.keys(entry)) {
    if (!KNOWN_KEYS.includes(key)) problems.push(`unknown field "${key}"`);
  }

  const agencyName = readText(entry, "agencyName", problems);
  if (!agencyName) problems.push('"agencyName" is required');

  const contactEmail = readText(entry, "contactEmail", problems);
  if (contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
    problems.push('"contactEmail" is not a valid e-mail address');
  }

  const website = readText(entry, "website", problems);
  if (website && !/^https?:\/\/\S+$/.test(website)) {
    problems.push('"website" must start with https:// or http://');
  }

  const primaryColor = readText(entry, "primaryColor", problems) ?? DEFAULT_COLOR;
  if (!/^#[0-9a-fA-F]{6}$/.test(primaryColor)) {
    problems.push('"primaryColor" must look like #1f6f8b');
  }

  const logo = readText(entry, "logo", problems);
  if (logo && !LOGO_EXTENSIONS.includes(extname(logo).toLowerCase())) {
    problems.push('"logo" must be a .png or .jpg file');
  }

  const language = toLanguage(readText(entry, "language", problems) ?? "en");
  if (!language) problems.push('"language" must be "en" or "sl"');

  const csvDelimiter = toDelimiter(readText(entry, "csvDelimiter", problems) ?? ",");
  if (!csvDelimiter) problems.push('"csvDelimiter" must be "," or ";"');

  if (problems.length > 0 || !agencyName || !language || !csvDelimiter) {
    throw new ConfigError(source, problems);
  }

  return {
    agencyName,
    contactEmail,
    website,
    primaryColor,
    logo: logo ? resolve(baseDir, logo) : null,
    language,
    csvDelimiter,
  };
}

export async function loadAgency(path: string): Promise<AgencyConfig> {
  let content: string;
  try {
    content = await readFile(path, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    const problem =
      code === "ENOENT" ? "file not found (copy agency.example.json to agency.json)" : `cannot read file (${code})`;
    throw new ConfigError(path, [problem]);
  }

  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch (error) {
    throw new ConfigError(path, [`not valid JSON: ${(error as Error).message}`]);
  }

  const agency = parseAgency(data, path, dirname(resolve(path)));
  if (agency.logo) {
    try {
      await access(agency.logo);
    } catch {
      throw new ConfigError(path, [`logo file not found: ${agency.logo}`]);
    }
  }
  return agency;
}
