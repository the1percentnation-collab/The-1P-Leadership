// CSV parse + serialize. No dependency, RFC 4180 shaped.
//
// Used by the CRM contact import (parse) and export (serialize). Kept
// separate from crm-import.js so the export button on the contacts page can
// pull in the serializer without loading the whole import UI.
//
// What it handles, because real exports from Mailchimp / GHL / Excel do all
// of it: quoted fields containing commas, embedded newlines inside quotes,
// doubled quotes as an escape, CRLF or LF line endings, a UTF-8 BOM on the
// first header cell, and semicolon-delimited files (European Excel).

/** Strip a UTF-8 byte-order mark. Excel writes one; it corrupts the first header. */
function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Guess the delimiter by counting candidates outside quoted regions on the
 * first line. Excel in a comma-decimal locale exports semicolons, and those
 * files otherwise parse as a single column.
 */
function sniffDelimiter(text) {
  let line = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') inQuotes = !inQuotes;
    if (!inQuotes && (c === '\n' || c === '\r')) break;
    line += c;
  }
  const counts = [',', ';', '\t'].map((d) => {
    let n = 0;
    let q = false;
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '"') q = !q;
      else if (!q && line[i] === d) n++;
    }
    return { d, n };
  });
  counts.sort((a, b) => b.n - a.n);
  return counts[0].n > 0 ? counts[0].d : ',';
}

/**
 * Parse CSV text into { headers, rows } where each row is an array of strings
 * aligned to `headers` by position. Short rows are padded, long rows trimmed,
 * so downstream code can index by column without guarding every access.
 *
 * @returns {{ headers: string[], rows: string[][], delimiter: string }}
 */
export function parseCsv(text) {
  const src = stripBom(String(text || ''));
  if (!src.trim()) return { headers: [], rows: [], delimiter: ',' };
  const delimiter = sniffDelimiter(src);

  const records = [];
  let field = '';
  let record = [];
  let inQuotes = false;

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }  // "" is a literal quote
        else inQuotes = false;
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') { inQuotes = true; continue; }
    if (c === delimiter) { record.push(field); field = ''; continue; }
    if (c === '\r') { if (src[i + 1] === '\n') i++; record.push(field); records.push(record); field = ''; record = []; continue; }
    if (c === '\n') { record.push(field); records.push(record); field = ''; record = []; continue; }
    field += c;
  }
  // Trailing field / record (file without a final newline).
  record.push(field);
  records.push(record);

  // Drop records that are entirely empty — a trailing newline yields one.
  const clean = records.filter((r) => r.some((v) => String(v).trim() !== ''));
  if (!clean.length) return { headers: [], rows: [], delimiter };

  const headers = clean[0].map((h) => String(h).trim());
  const width = headers.length;
  const rows = clean.slice(1).map((r) => {
    const out = r.slice(0, width).map((v) => String(v).trim());
    while (out.length < width) out.push('');
    return out;
  });
  return { headers, rows, delimiter };
}

/** Quote a single value if it contains a delimiter, quote, or newline. */
function csvCell(value) {
  const s = value == null ? '' : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Serialize rows to CSV text.
 * @param {string[]} headers column headers, in order
 * @param {Array<Array<*>>} rows values aligned to headers
 */
export function toCsv(headers, rows) {
  const head = headers.map(csvCell).join(',');
  const body = rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
  return body ? `${head}\r\n${body}` : head;
}

/**
 * Trigger a browser download of `text` as `filename`.
 *
 * The BOM is deliberate: without it Excel opens a UTF-8 CSV as Windows-1252
 * and mangles every accented name in the contact list.
 */
export function downloadCsv(filename, text) {
  const blob = new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
