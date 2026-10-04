/**
 * CSV writer (the parser lives in lib/utils/csv.ts). Every cell is quoted
 * when needed and protected against formula injection: a text cell starting
 * with = + - @ (or a tab / carriage return) gets a leading ' so a
 * spreadsheet shows it as text. Usernames and tags are typed by people, so
 * this matters. Numbers are written as numbers.
 */
export type CsvCell = string | number | boolean | null | undefined | Date;

const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: CsvCell): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "boolean") return value ? "true" : "false";
  let text = value instanceof Date ? value.toISOString() : String(value);
  if (FORMULA_START.test(text)) text = `'${text}`;
  if (/[",\n\r;]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

/** Rows to CSV text (first row = header). BOM so Excel reads the accents. */
export function toCsv(rows: CsvCell[][], options: { bom?: boolean } = {}): string {
  const body = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
  return (options.bom === false ? "" : "﻿") + body + "\r\n";
}
