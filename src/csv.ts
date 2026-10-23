import { readFile } from "node:fs/promises";
import { ConfigError } from "./config.ts";

export type CsvDelimiter = "," | ";";

export function normalizeKeyword(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-");
}

export interface CsvRow {
  row: number;
  values: Record<string, string>;
}

export interface CsvFile {
  rows: CsvRow[];
  warnings: string[];
}

export function detectDelimiter(text: string): CsvDelimiter {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const commas = firstLine.split(",").length;
  const semicolons = firstLine.split(";").length;
  return semicolons > commas ? ";" : ",";
}

export function parseCsv(text: string, delimiter: CsvDelimiter): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text.charAt(i);

    if (inQuotes) {
      if (char === '"' && text.charAt(i + 1) === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"' && field === "") {
      inQuotes = true;
    } else if (char === delimiter) {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text.charAt(i + 1) === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  if (inQuotes) throw new Error('a quoted value is not closed (missing ")');
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function escapeField(value: string, delimiter: CsvDelimiter): string {
  let text = value;
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  if (text.includes(delimiter) || /["\r\n]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

function csvLine(row: string[], delimiter: CsvDelimiter): string {
  const fields: string[] = [];
  for (const value of row) fields.push(escapeField(value, delimiter));
  return fields.join(delimiter);
}

export function toCsv(rows: string[][], delimiter: CsvDelimiter): string {
  const lines: string[] = [];
  for (const row of rows) lines.push(csvLine(row, delimiter));
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

function normalizeHeader(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

export async function readCsvFile(
  path: string,
  knownColumns: readonly string[],
  requiredColumns: readonly string[],
): Promise<CsvFile | null> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return null;
    throw new ConfigError(path, [`cannot read file (${code})`]);
  }

  text = text.replace(/^\uFEFF/, "");
  let table: string[][];
  try {
    table = parseCsv(text, detectDelimiter(text));
  } catch (error) {
    throw new ConfigError(path, [(error as Error).message]);
  }

  const header = (table[0] ?? []).map(normalizeHeader);
  const missing = requiredColumns.filter((column) => !header.includes(column));
  if (missing.length > 0) {
    throw new ConfigError(path, [`missing column(s): ${missing.join(", ")}`]);
  }

  const warnings: string[] = [];
  for (const column of header) {
    if (column !== "" && !knownColumns.includes(column)) warnings.push(`${path}: unknown column "${column}" ignored`);
  }

  const rows: CsvRow[] = [];
  for (let i = 1; i < table.length; i++) {
    const cells = table[i] ?? [];
    if (cells.every((cell) => cell.trim() === "")) continue;

    const values: Record<string, string> = {};
    for (let column = 0; column < header.length; column++) {
      const name = header[column] ?? "";
      values[name] = (cells[column] ?? "").trim();
    }
    rows.push({ row: i + 1, values });
  }

  return { rows, warnings };
}
