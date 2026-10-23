import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { extname } from "node:path";
import pdfmake from "pdfmake";
import type { Content, CustomTableLayout, Size, TableCell, TDocumentDefinitions } from "pdfmake/interfaces.js";
import { writeFileAtomic } from "../files.ts";

const require = createRequire(import.meta.url);

function fontFile(name: string): string {
  return require.resolve(`pdfmake/fonts/Roboto/${name}`);
}

const ROBOTO = {
  normal: fontFile("Roboto-Regular.ttf"),
  bold: fontFile("Roboto-Medium.ttf"),
  italics: fontFile("Roboto-Italic.ttf"),
  bolditalics: fontFile("Roboto-MediumItalic.ttf"),
};

const FONT_FILES = new Set(Object.values(ROBOTO));

pdfmake.setFonts({ Roboto: ROBOTO });
pdfmake.setUrlAccessPolicy(() => false);
pdfmake.setLocalAccessPolicy((path) => FONT_FILES.has(path));

export const COLORS = {
  text: "#1f2933",
  muted: "#5f6b76",
  border: "#d9dee3",
  headerFill: "#eef2f5",
  good: "#1e7b4f",
  warning: "#a15c00",
  bad: "#b3261e",
};

export const ARROW = "›";

const TABLE_LAYOUT: CustomTableLayout = {
  hLineWidth: (row) => (row === 0 ? 0 : 0.5),
  vLineWidth: () => 0,
  hLineColor: () => COLORS.border,
  fillColor: (row) => (row === 0 ? COLORS.headerFill : null),
  paddingLeft: () => 4,
  paddingRight: () => 4,
  paddingTop: () => 3,
  paddingBottom: () => 3,
};

export function heading(text: string, color: string = COLORS.text): Content {
  return { text, fontSize: 12, bold: true, color, margin: [0, 14, 0, 6], headlineLevel: 1 };
}

export function muted(text: string): Content {
  return { text, color: COLORS.muted, fontSize: 8, margin: [0, 0, 0, 4] };
}

export function nameWithId(name: string, identifier: string): TableCell {
  if (name.toLowerCase() === identifier.toLowerCase()) return { text: name, wordBreak: "break-all" };
  return {
    stack: [
      { text: name, bold: true },
      { text: identifier, color: COLORS.muted, fontSize: 7, wordBreak: "break-all" },
    ],
  };
}

export function table(headers: string[], rows: TableCell[][], widths: Size[], emptyText: string): Content {
  if (rows.length === 0) return { text: emptyText, italics: true, color: COLORS.muted, margin: [0, 0, 0, 4] };

  const headerRow: TableCell[] = headers.map((header) => ({
    text: header,
    bold: true,
    color: COLORS.muted,
    fontSize: 7.5,
  }));
  return {
    table: { headerRows: 1, dontBreakRows: true, widths, body: [headerRow, ...rows] },
    layout: TABLE_LAYOUT,
    fontSize: 8,
    margin: [0, 0, 0, 4],
  };
}

export function keyValues(pairs: Array<[string, Content]>): Content {
  const body: TableCell[][] = [];
  for (const [key, value] of pairs) {
    body.push([{ text: key, color: COLORS.muted }, value as TableCell]);
  }
  return {
    table: { widths: [110, "*"], body },
    layout: "noBorders",
    margin: [0, 0, 0, 6],
  };
}

const GOOD_STATES = ["success", "current", "valid", "not-required"];
const BAD_STATES = ["failed", "not-collected", "expired", "missing"];

export function statusColor(status: string): string {
  if (GOOD_STATES.includes(status)) return COLORS.good;
  if (BAD_STATES.includes(status)) return COLORS.bad;
  return COLORS.warning;
}

export function pageFooter(left: string, pageLabel: (page: number, total: number) => string) {
  return function footer(currentPage: number, pageCount: number): Content {
    return {
      columns: [
        { text: left, width: "*" },
        { text: pageLabel(currentPage, pageCount), width: "auto" },
      ],
      margin: [40, 18, 40, 0],
      fontSize: 7.5,
      color: COLORS.muted,
    };
  };
}

export function baseDocument(title: string, content: Content[], landscape = false): TDocumentDefinitions {
  return {
    pageSize: "A4",
    pageOrientation: landscape ? "landscape" : "portrait",
    pageMargins: [40, 46, 40, 50],
    info: { title, creator: "wordpress-maintenance", producer: "wordpress-maintenance" },
    defaultStyle: { font: "Roboto", fontSize: 9, color: COLORS.text, lineHeight: 1.2 },
    pageBreakBefore: (node) => node.headlineLevel === 1 && node.startPosition.verticalRatio > 0.82,
    content,
  };
}

export async function imageDataUrl(path: string): Promise<string> {
  const type = extname(path).toLowerCase() === ".png" ? "image/png" : "image/jpeg";
  const data = await readFile(path);
  return `data:${type};base64,${data.toString("base64")}`;
}

export async function writePdf(path: string, doc: TDocumentDefinitions): Promise<void> {
  const buffer = await pdfmake.createPdf(doc).getBuffer();
  await writeFileAtomic(path, buffer);
}
