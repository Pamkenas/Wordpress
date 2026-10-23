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

export function parseAgency(data: unknown, source: string, baseDir: string): AgencyConfig {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new ConfigError(source, ["expected a JSON object"]);
  }

  const entry = data as Record<string, unknown>;
  const problems: string[] = [];

  for (const key of Object.keys(entry)) {
    if (!KNOWN_KEYS.includes(key)) problems.push(`unknown field "${key}"`);
  }

  function text(key: string): string | null {
    const value = entry[key];
    if (value === undefined || value === null || value === "") return null;
    if (typeof value !== "string") {
      problems.push(`"${key}" must be a string`);
      return null;
    }
    return value.trim() || null;
  }

  const agencyName = text("agencyName");
  if (!agencyName) problems.push('"agencyName" is required');

  const contactEmail = text("contactEmail");
  if (contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
    problems.push('"contactEmail" is not a valid e-mail address');
  }

  const website = text("website");
  if (website && !/^https?:\/\/\S+$/.test(website)) problems.push('"website" must start with https://');

  const primaryColor = text("primaryColor") ?? DEFAULT_COLOR;
  if (!/^#[0-9a-fA-F]{6}$/.test(primaryColor)) problems.push('"primaryColor" must look like #1f6f8b');

  const logo = text("logo");
  if (logo && ![".png", ".jpg", ".jpeg"].includes(extname(logo).toLowerCase())) {
    problems.push('"logo" must be a .png or .jpg file');
  }

  const language = text("language") ?? "en";
  if (language !== "en" && language !== "sl") problems.push('"language" must be "en" or "sl"');

  const csvDelimiter = text("csvDelimiter") ?? ",";
  if (csvDelimiter !== "," && csvDelimiter !== ";") problems.push('"csvDelimiter" must be "," or ";"');

  if (problems.length > 0) throw new ConfigError(source, problems);

  return {
    agencyName: agencyName as string,
    contactEmail,
    website,
    primaryColor,
    logo: logo ? resolve(baseDir, logo) : null,
    language: language as Language,
    csvDelimiter: csvDelimiter as CsvDelimiter,
  };
}

export async function loadAgency(path: string): Promise<AgencyConfig> {
  let content: string;
  try {
    content = await readFile(path, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    throw new ConfigError(path, [
      code === "ENOENT" ? "file not found (copy agency.example.json to agency.json)" : `cannot read file (${code})`,
    ]);
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
