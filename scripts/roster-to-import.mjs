#!/usr/bin/env node
/**
 * Converts a roster CSV (employee_id, name) into the Leave OS import shape.
 *
 * The app's template is GET /api/v1/import/template.csv:
 *   employee_code,first_name,last_name,work_email,joined_on,department_code,manager_code
 * There is no POST that commits that file. This converter adds a role column.
 * "staff" is the employee role (the domain code is `employee`; the product label is Employee).
 * Email, join date, department and manager are left blank — the roster does not have them.
 * scripts/import-roster.mjs fills the blanks the database cannot store as null.
 *
 * Usage:
 *   node scripts/roster-to-import.mjs roster.csv > import.csv
 *   node scripts/roster-to-import.mjs roster.csv import.csv
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const src = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (ch !== '\r') {
      cell += ch;
    }
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

function csvCell(value) {
  if (/[",\n\r]/.test(value)) return `"${value.replaceAll('"', '""')}"`;
  return value;
}

/**
 * @param {string} text roster CSV with employee_id and name
 * @returns {string} import CSV
 */
export function convertRoster(text) {
  const rows = parseCsv(text);
  if (rows.length === 0) throw new Error('The roster CSV is empty.');
  const header = rows[0].map((h) => h.trim().toLowerCase().replaceAll(' ', '_'));
  const idIdx = header.findIndex((h) => h === 'employee_id' || h === 'id' || h === 'employee_code');
  const nameIdx = header.findIndex((h) => h === 'name' || h === 'employee_name');
  if (idIdx < 0 || nameIdx < 0) {
    throw new Error('Roster CSV needs employee_id and name columns.');
  }
  const out = [
    'employee_code,first_name,last_name,work_email,joined_on,department_code,manager_code,role',
  ];
  for (const raw of rows.slice(1)) {
    const code = (raw[idIdx] ?? '').trim();
    const name = (raw[nameIdx] ?? '').trim();
    if (!code || !name) continue;
    const parts = name.split(/\s+/).filter(Boolean);
    const first = parts[0] ?? name;
    const last = parts.slice(1).join(' ');
    out.push([code, first, last, '', '', '', '', 'staff'].map((c) => csvCell(c)).join(','));
  }
  if (out.length < 2) throw new Error('The roster CSV has no people.');
  return `${out.join('\n')}\n`;
}

function isDirectRun() {
  const arg = process.argv[1];
  if (!arg) return false;
  return path.resolve(arg).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
}

if (isDirectRun()) {
  const input = process.argv[2];
  if (!input) {
    console.error('Usage: node scripts/roster-to-import.mjs <roster.csv> [import.csv]');
    process.exit(2);
  }
  const csv = convertRoster(fs.readFileSync(input, 'utf8'));
  const output = process.argv[3];
  if (output) fs.writeFileSync(output, csv);
  else process.stdout.write(csv);
}
