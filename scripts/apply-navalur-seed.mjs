#!/usr/bin/env node
/**
 * Applies scripts/reset-simon-and-sons-navalur.sql to a PostgreSQL database.
 * Usage:
 *   node scripts/apply-navalur-seed.mjs [DATABASE_URL]
 * If DATABASE_URL is not passed as an argument, it reads DATABASE_URL / SUPABASE_DB_URL
 * from environment or .env.
 */
import fs from 'node:fs';
import path from 'node:path';
import postgres from 'postgres';

function loadDotEnv(file = path.resolve('.env')) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (process.env[key] !== undefined) continue;
    process.env[key] = trimmed
      .slice(eq + 1)
      .trim()
      .replace(/^(['"])(.*)\1$/, '$2');
  }
}

loadDotEnv();

const dbUrl =
  process.argv[2] ??
  process.env.DATABASE_URL ??
  process.env.SUPABASE_DB_URL ??
  process.env.POSTGRES_URL_NON_POOLING ??
  process.env.POSTGRES_URL;

if (!dbUrl) {
  console.error('Error: No DATABASE_URL found in environment, arguments, or .env file.');
  console.error(
    'Usage: node scripts/apply-navalur-seed.mjs "postgresql://user:pass@host:5432/dbname"',
  );
  console.error(
    'Or copy scripts/reset-simon-and-sons-navalur.sql into the Supabase SQL editor directly.',
  );
  process.exit(1);
}

function splitSql(sql) {
  const parts = [];
  let buf = '';
  let inDollar = false;
  for (let i = 0; i < sql.length; i++) {
    if (sql.startsWith('$$', i)) {
      inDollar = !inDollar;
      buf += '$$';
      i++;
      continue;
    }
    if (!inDollar && sql[i] === ';') {
      if (buf.trim()) parts.push(buf.trim());
      buf = '';
      continue;
    }
    buf += sql[i];
  }
  if (buf.trim()) parts.push(buf.trim());
  return parts;
}

async function main() {
  const sqlFile = path.resolve('scripts/reset-simon-and-sons-navalur.sql');
  console.log(`Reading SQL file: ${sqlFile}`);
  const rawSql = fs.readFileSync(sqlFile, 'utf8');

  const cleanSql = rawSql
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^--.*$/gm, '')
    .trim();

  const stmts = splitSql(cleanSql).filter(Boolean);
  console.log(`Connecting to Postgres database (${stmts.length} statements to execute)...`);

  const sql = postgres(dbUrl, {
    max: 1,
    idle_timeout: 20,
    ssl: dbUrl.includes('supabase') || dbUrl.includes('sslmode=require') ? 'require' : undefined,
    prepare: false,
  });

  try {
    for (let i = 0; i < stmts.length; i++) {
      await sql.unsafe(stmts[i] + ';');
    }
    console.log('✓ Successfully applied Simon & Sons Navalur dataset to database!');
  } catch (err) {
    console.error('Execution failed:', err);
    process.exit(1);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main();
