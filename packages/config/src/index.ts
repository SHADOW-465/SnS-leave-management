import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

const bool = z.preprocess((v) => {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
  return false;
}, z.boolean());

export const appConfigSchema = z.object({
  env: z.enum(['development', 'test', 'production']).default('development'),
  host: z.string().default('127.0.0.1'),
  port: z.coerce.number().int().positive().default(3000),
  bindAll: bool.default(false),
  dataDir: z.string().default('./data'),
  publicUrl: z.string().default('http://localhost:5173'),
  tlsEnabled: bool.default(false),
  tlsCertPath: z.string().optional(),
  tlsKeyPath: z.string().optional(),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  cookieSecure: bool.default(false),
  trustProxy: bool.default(false),
  sessionAbsoluteHours: z.coerce.number().default(8),
  sessionIdleHours: z.coerce.number().default(2),
  /** Temporary Vercel/Supabase click-through host. Office go-live remains SQLite (DW-41). */
  hostedPreview: bool.default(false),
  /** Sample @sns.test accounts on the sign-in screen. */
  showDemoAccounts: bool.default(false),
  /** First-run seed when the database is empty. Hosted preview only. */
  seedOnEmpty: bool.default(false),
  /** Enforce 1:1 workstation device binding to prevent cross-account logins / buddy punching. */
  enforceWorkstationBinding: bool.default(false),
  /** Optional. When set, the API uses Postgres (Supabase preview). Unset for office SQLite. */
  databaseUrl: z
    .string()
    .optional()
    .transform((s) => (s && s.trim() ? s.trim() : undefined)),
});

export type AppConfig = z.infer<typeof appConfigSchema>;

/**
 * Reads a `.env` file into `process.env` without overwriting anything already set.
 * Ten lines beats a dependency, and without it `.env.example` was decorative — the
 * documented development settings were never actually read.
 */
export function loadDotEnv(file = path.resolve('.env')): void {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
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

export function defaultDataDir(env: NodeJS.ProcessEnv = process.env): string {
  // Development writes into the repo. The ProgramData path is the *installed* location
  // and normally needs elevation, which made `pnpm dev` fail before first run.
  if (env.LEAVEOS_ENV === 'development' || env.LEAVEOS_ENV === 'test') {
    return path.resolve('./data');
  }
  if (process.platform === 'win32' && env.PROGRAMDATA) {
    return path.join(env.PROGRAMDATA, 'SimonAndSons', 'LeaveOS');
  }
  return path.resolve('./data');
}

function hostedPublicUrl(env: NodeJS.ProcessEnv): string | undefined {
  if (env.LEAVEOS_PUBLIC_URL) return env.LEAVEOS_PUBLIC_URL;
  if (env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`;
  if (env.VERCEL_URL) return `https://${env.VERCEL_URL}`;
  return undefined;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const hostedPreview =
    Boolean(env.VERCEL) ||
    ['1', 'true', 'yes', 'on'].includes((env.LEAVEOS_HOSTED_PREVIEW ?? '').toLowerCase());
  const dataDir =
    env.LEAVEOS_DATA_DIR ?? (hostedPreview ? '/tmp/leaveos-data' : defaultDataDir(env));
  const filePath = path.join(dataDir, 'config.json');
  let file: Record<string, unknown> = {};
  if (existsSync(filePath)) {
    file = JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>;
  }
  const envName = env.LEAVEOS_ENV ?? file.env;
  const merged = {
    env: envName,
    host: env.LEAVEOS_HOST ?? file.host,
    port: env.LEAVEOS_PORT ?? env.PORT ?? file.port,
    bindAll: env.LEAVEOS_BIND_ALL ?? file.bindAll,
    dataDir,
    publicUrl:
      env.LEAVEOS_PUBLIC_URL ??
      file.publicUrl ??
      (hostedPreview ? hostedPublicUrl(env) : undefined),
    tlsEnabled: env.LEAVEOS_TLS_ENABLED ?? file.tlsEnabled ?? (hostedPreview ? false : undefined),
    tlsCertPath: env.LEAVEOS_TLS_CERT ?? file.tlsCertPath,
    tlsKeyPath: env.LEAVEOS_TLS_KEY ?? file.tlsKeyPath,
    logLevel: env.LEAVEOS_LOG_LEVEL ?? file.logLevel,
    cookieSecure:
      env.LEAVEOS_COOKIE_SECURE ?? file.cookieSecure ?? (hostedPreview ? true : undefined),
    trustProxy: env.LEAVEOS_TRUST_PROXY ?? (hostedPreview ? true : undefined),
    hostedPreview: env.LEAVEOS_HOSTED_PREVIEW ?? hostedPreview,
    showDemoAccounts:
      envName === 'production'
        ? false
        : env.LEAVEOS_DEMO_ACCOUNTS !== undefined
          ? ['1', 'true', 'yes', 'on'].includes(env.LEAVEOS_DEMO_ACCOUNTS.toLowerCase())
          : Boolean(hostedPreview || envName === 'development' || envName === undefined),
    seedOnEmpty:
      envName === 'production'
        ? false
        : env.LEAVEOS_SEED_DEMO !== undefined
          ? ['1', 'true', 'yes', 'on'].includes(env.LEAVEOS_SEED_DEMO.toLowerCase())
          : Boolean(hostedPreview),
    enforceWorkstationBinding:
      env.LEAVEOS_ENFORCE_WORKSTATION !== undefined
        ? ['1', 'true', 'yes', 'on'].includes(env.LEAVEOS_ENFORCE_WORKSTATION.toLowerCase())
        : envName === 'production',
    databaseUrl:
      env.DATABASE_URL ??
      env.SUPABASE_DB_URL ??
      env.POSTGRES_URL_NON_POOLING ??
      env.POSTGRES_URL ??
      file.databaseUrl,
  };
  const parsed = appConfigSchema.safeParse(merged);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(`Invalid configuration: ${issue?.path.join('.')}: ${issue?.message}`);
  }
  return parsed.data;
}

export function pathsFor(config: AppConfig) {
  const root = path.resolve(config.dataDir);
  return {
    root,
    db: path.join(root, 'db', 'app.db'),
    attachments: path.join(root, 'attachments'),
    backups: path.join(root, 'backups'),
    logs: path.join(root, 'logs'),
    certs: path.join(root, 'certs'),
    configFile: path.join(root, 'config.json'),
    lockFile: path.join(root, 'db', 'app.lock'),
  };
}
