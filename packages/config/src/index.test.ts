import { describe, expect, it } from 'vitest';
import { loadConfig } from './index.js';

describe('config', () => {
  it('loads defaults', () => {
    const c = loadConfig({ LEAVEOS_DATA_DIR: './data' });
    expect(c.port).toBe(3000);
    expect(c.host).toBe('127.0.0.1');
  });

  it('names the offending key', () => {
    expect(() => loadConfig({ LEAVEOS_DATA_DIR: './data', LEAVEOS_PORT: 'nope' })).toThrow(/port/);
  });

  it('treats VERCEL as a hosted preview against Postgres', () => {
    const c = loadConfig({
      VERCEL: '1',
      VERCEL_URL: 'sns-leave-os.vercel.app',
      DATABASE_URL: 'postgres://user:pass@db.example.invalid:5432/postgres',
    });
    expect(c.hostedPreview).toBe(true);
    expect(c.cookieSecure).toBe(true);
    expect(c.trustProxy).toBe(true);
    expect(c.tlsEnabled).toBe(false);
    expect(c.showDemoAccounts).toBe(true);
    expect(c.seedOnEmpty).toBe(true);
    expect(c.dataDir).toBe('/tmp/leaveos-data');
    expect(c.publicUrl).toBe('https://sns-leave-os.vercel.app');
    expect(c.databaseUrl).toBe('postgres://user:pass@db.example.invalid:5432/postgres');
  });

  it('accepts the Vercel Marketplace POSTGRES_URL when DATABASE_URL is unset', () => {
    const c = loadConfig({
      VERCEL: '1',
      POSTGRES_URL_NON_POOLING: 'postgres://user:pass@db.example.invalid:5432/postgres',
      POSTGRES_URL: 'postgres://user:pass@db.example.invalid:6543/postgres',
    });
    expect(c.databaseUrl).toBe('postgres://user:pass@db.example.invalid:5432/postgres');
  });

  it('does not treat a local test run as hosted', () => {
    const c = loadConfig({ LEAVEOS_DATA_DIR: './data', LEAVEOS_ENV: 'test' });
    expect(c.hostedPreview).toBe(false);
    expect(c.showDemoAccounts).toBe(false);
    expect(c.cookieSecure).toBe(false);
    expect(c.trustProxy).toBe(false);
  });

  it('disables demo accounts and seeding in production, and enables workstation enforcement', () => {
    const c = loadConfig({
      LEAVEOS_DATA_DIR: './data',
      LEAVEOS_ENV: 'production',
      LEAVEOS_DEMO_ACCOUNTS: 'true', // Attempt to force demo accounts in production
    });
    expect(c.showDemoAccounts).toBe(false);
    expect(c.seedOnEmpty).toBe(false);
    expect(c.enforceWorkstationBinding).toBe(true);
  });

  it('allows demo accounts and disables workstation binding restriction in development', () => {
    const c = loadConfig({
      LEAVEOS_DATA_DIR: './data',
      LEAVEOS_ENV: 'development',
    });
    expect(c.showDemoAccounts).toBe(true);
    expect(c.enforceWorkstationBinding).toBe(false);
  });
});
