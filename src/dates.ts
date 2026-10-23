import type { Language } from "./agency.ts";

const MONTH_NAMES: Record<Language, string[]> = {
  en: [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ],
  sl: [
    "januar",
    "februar",
    "marec",
    "april",
    "maj",
    "junij",
    "julij",
    "avgust",
    "september",
    "oktober",
    "november",
    "december",
  ],
};

const SHORT_MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function splitIsoDate(value: string): { year: number; month: number; day: number } {
  const parts = value.slice(0, 10).split("-");
  return {
    year: Number(parts[0]),
    month: Number(parts[1] ?? "1"),
    day: Number(parts[2] ?? "1"),
  };
}

function isRealDate(year: number, month: number, day: number): boolean {
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

export function localDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function localDateTime(date: Date): string {
  return `${localDate(date)} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function isValidPeriod(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

export function periodStart(period: string): string {
  return `${period}-01`;
}

export function periodEnd(period: string): string {
  const { year, month } = splitIsoDate(`${period}-01`);
  const lastDay = new Date(year, month, 0).getDate();
  return `${period}-${pad(lastDay)}`;
}

export function isInPeriod(date: string, period: string): boolean {
  return date >= periodStart(period) && date <= periodEnd(period);
}

export function parseDateInput(value: string): string | null {
  const text = value.trim();
  let year: number;
  let month: number;
  let day: number;

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  const european = /^(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})$/.exec(text);
  if (iso) {
    year = Number(iso[1]);
    month = Number(iso[2]);
    day = Number(iso[3]);
  } else if (european) {
    day = Number(european[1]);
    month = Number(european[2]);
    year = Number(european[3]);
  } else {
    return null;
  }

  if (!isRealDate(year, month, day)) return null;
  return `${year}-${pad(month)}-${pad(day)}`;
}

export function parseDateTimeInput(value: string): string | null {
  const text = value.trim();
  const dateOnly = parseDateInput(text);
  if (dateOnly) return dateOnly;

  const match = /^(.*\S)[ T](\d{1,2}):(\d{2})(?::\d{2})?$/.exec(text);
  if (!match) return null;

  const date = parseDateInput(match[1] ?? "");
  const hours = Number(match[2]);
  const minutes = Number(match[3]);
  if (!date || hours > 23 || minutes > 59) return null;
  return `${date} ${pad(hours)}:${pad(minutes)}`;
}

export function formatDate(value: string, language: Language): string {
  const { year, month, day } = splitIsoDate(value);
  if (language === "sl") return `${day}. ${month}. ${year}`;
  return `${day} ${SHORT_MONTHS_EN[month - 1]} ${year}`;
}

export function formatDateTime(isoTimestamp: string, language: Language): string {
  const date = new Date(isoTimestamp);
  if (Number.isNaN(date.getTime())) return isoTimestamp;
  return `${formatDate(localDate(date), language)} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function formatPeriod(period: string, language: Language): string {
  const { year, month } = splitIsoDate(`${period}-01`);
  return `${MONTH_NAMES[language][month - 1]} ${year}`;
}
