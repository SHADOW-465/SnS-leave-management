import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { pathsFor, loadConfig } from '@sns/config';
import { openDatabase, type Db } from '@sns/database';
import { buildApp } from './app.js';
import type { RequestContext } from './ctx.js';
import { nowIso, todayInTimeZone } from './time.js';
import {
  completeSetup,
  demoAccounts,
  mayListDemoAccounts,
  setupTokensEqual,
} from './usecases/setup.js';

const opened: { sqlite: Db; dir: string }[] = [];
const TOKEN = 'hosted-setup-token-test';

afterEach(async () => {
  delete process.env.SETUP_TOKEN;
  for (const { sqlite, dir } of opened.splice(0)) {
    await sqlite.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function ctxFor(config: ReturnType<typeof loadConfig>, sqlite: Db): RequestContext {
  const dirs = pathsFor(config);
  return {
    requestId: 'hosted-setup-test',
    sqlite,
    config,
    principal: null,
    ip: '127.0.0.1',
    userAgent: 'test',
    now: nowIso(),
    today: todayInTimeZone('UTC'),
    attachmentsRoot: dirs.attachments,
    backupsRoot: dirs.backups,
  };
}

const setupBody = (extra: object = {}) => ({
  companyName: 'Test Co',
  timezone: 'Asia/Kolkata',
  leaveYearStartMonth: 1,
  leaveYearStartDay: 1,
  adminName: 'Ada Example',
  adminEmail: 'admin@example.invalid',
  adminPassword: 'ChangeMe_admin_1',
  ...extra,
});

describe('demo account listing', () => {
  it('compares setup tokens without throwing when the lengths differ', () => {
    expect(setupTokensEqual('abc', 'abc')).toBe(true);
    expect(setupTokensEqual('a', 'abcd')).toBe(false);
    expect(setupTokensEqual('', 'abcd')).toBe(false);
  });

  it('allows the list only for local dev or test on SQLite', () => {
    expect(
      mayListDemoAccounts({
        env: 'development',
        hostedPreview: false,
        dialect: 'sqlite',
        showDemoAccounts: true,
      }),
    ).toBe(true);
    expect(
      mayListDemoAccounts({
        env: 'test',
        hostedPreview: false,
        dialect: 'sqlite',
        showDemoAccounts: true,
      }),
    ).toBe(true);
    for (const blocked of [
      { env: 'production', hostedPreview: false, dialect: 'sqlite', showDemoAccounts: true },
      { env: 'development', hostedPreview: true, dialect: 'sqlite', showDemoAccounts: true },
      { env: 'development', hostedPreview: false, dialect: 'postgres', showDemoAccounts: true },
      { env: 'test', hostedPreview: false, dialect: 'sqlite', showDemoAccounts: false },
    ]) {
      expect(mayListDemoAccounts(blocked)).toBe(false);
    }
  });

  it('does not query the database when the list is forbidden', async () => {
    const sqlite = {
      dialect: 'postgres',
      prepare() {
        throw new Error('demo query ran');
      },
    };
    const listed = await demoAccounts({
      config: { env: 'development', hostedPreview: false, showDemoAccounts: true },
      sqlite,
    } as never);
    expect(listed).toEqual({ password: '', accounts: [] });
  });

  it('lists sample passwords on local development SQLite and nowhere else', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leaveos-demo-'));
    const sqlite = await openDatabase(path.join(dir, 'app.db'));
    opened.push({ sqlite, dir });
    const dev = loadConfig({ LEAVEOS_DATA_DIR: dir, LEAVEOS_ENV: 'development' });
    await completeSetup(ctxFor(dev, sqlite), { ...setupBody(), loadSampleData: true });
    const listed = await demoAccounts(ctxFor(dev, sqlite));
    expect(listed.accounts.length).toBeGreaterThan(0);
    expect(listed.password.length).toBeGreaterThan(0);

    const hosted = loadConfig({
      LEAVEOS_DATA_DIR: dir,
      LEAVEOS_ENV: 'development',
      LEAVEOS_HOSTED_PREVIEW: 'true',
      LEAVEOS_DEMO_ACCOUNTS: 'true',
    });
    const hidden = await demoAccounts(ctxFor(hosted, sqlite));
    expect(hidden).toEqual({ password: '', accounts: [] });
  });
});

describe('hosted first-run setup', () => {
  async function hostedApp() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leaveos-hosted-'));
    const sqlite = await openDatabase(path.join(dir, 'app.db'));
    opened.push({ sqlite, dir });
    const app = await buildApp(
      loadConfig({
        LEAVEOS_DATA_DIR: dir,
        LEAVEOS_ENV: 'development',
        LEAVEOS_HOSTED_PREVIEW: 'true',
      }),
      sqlite,
    );
    await app.ready();
    return app;
  }

  it('requires a configured token, rejects a mismatch and sample data, then accepts the token', async () => {
    const app = await hostedApp();
    const status = await app.inject({ method: 'GET', url: '/api/v1/setup/status' });
    expect(status.statusCode).toBe(200);
    expect(
      (status.json() as { data: { needsSetup: boolean; setupTokenRequired: boolean } }).data,
    ).toMatchObject({ needsSetup: true, setupTokenRequired: true });

    const missing = await app.inject({
      method: 'POST',
      url: '/api/v1/setup',
      payload: setupBody(),
    });
    expect(missing.statusCode).toBe(403);
    expect((missing.json() as { error: { code: string } }).error.code).toBe(
      'SETUP_TOKEN_NOT_CONFIGURED',
    );

    process.env.SETUP_TOKEN = TOKEN;
    const wrong = await app.inject({
      method: 'POST',
      url: '/api/v1/setup',
      payload: setupBody({ setupToken: 'nope' }),
    });
    expect(wrong.statusCode).toBe(403);
    expect((wrong.json() as { error: { code: string } }).error.code).toBe('SETUP_TOKEN_REQUIRED');

    const short = await app.inject({
      method: 'POST',
      url: '/api/v1/setup',
      payload: setupBody({ setupToken: 'x' }),
    });
    expect(short.statusCode).toBe(403);
    expect((short.json() as { error: { code: string } }).error.code).toBe('SETUP_TOKEN_REQUIRED');

    const sample = await app.inject({
      method: 'POST',
      url: '/api/v1/setup',
      payload: setupBody({ setupToken: TOKEN, loadSampleData: true }),
    });
    expect(sample.statusCode).toBe(400);
    expect((sample.json() as { error: { code: string } }).error.code).toBe(
      'SAMPLE_DATA_NOT_ON_HOSTED',
    );

    const okSetup = await app.inject({
      method: 'POST',
      url: '/api/v1/setup',
      payload: setupBody({ setupToken: TOKEN, loadSampleData: false }),
    });
    expect(okSetup.statusCode).toBe(200);

    const listed = await app.inject({ method: 'GET', url: '/api/v1/setup/demo-accounts' });
    expect(JSON.stringify(listed.json())).not.toContain('ChangeMe');
    expect((listed.json() as { data: { accounts: unknown[] } }).data.accounts).toEqual([]);
    await app.close();
  });
});
