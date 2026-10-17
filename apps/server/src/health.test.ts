import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, type Db } from '@sns/database';
import { collectHealth, writeHealth } from './health.js';
import { ensureLanCertificate } from './tls.js';

const dirs: string[] = [];
const opened: Db[] = [];

afterEach(async () => {
  for (const db of opened.splice(0)) await db.close();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('host health', () => {
  it('reports integrity, backup age, certificate expiry, and free disk', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leaveos-health-'));
    dirs.push(dir);
    const sqlite = await openDatabase(path.join(dir, 'app.db'));
    opened.push(sqlite);
    const now = new Date('2026-10-16T12:00:00.000Z');
    await sqlite
      .prepare(
        `INSERT INTO backup_record (id, path, started_at, finished_at, size_bytes, sha256, integrity_check_result, schema_version, trigger, status)
         VALUES ('bk1', 'backup-1.db', ?, ?, 10, 'abc', 'ok', '0001_init', 'scheduled', 'ok')`,
      )
      .run('2026-10-16T08:00:00.000Z', '2026-10-16T08:00:00.000Z');
    const certs = path.join(dir, 'certs');
    await ensureLanCertificate(certs);
    const report = await collectHealth(sqlite, {
      backupsRoot: dir,
      certPath: path.join(certs, 'cert.pem'),
      now,
    });
    expect(report.integrity).toBe('ok');
    expect(report.backupAgeHours).toBe(4);
    expect(report.certExpiresAt).toBeTruthy();
    expect(report.diskFreeBytes).toBeGreaterThan(0);
    const stored = await writeHealth(sqlite, {
      backupsRoot: dir,
      certPath: path.join(certs, 'cert.pem'),
    });
    const row = (await sqlite
      .prepare(`SELECT value_json FROM app_setting WHERE key = 'host.health'`)
      .get()) as {
      value_json: string;
    };
    expect(JSON.parse(row.value_json).integrity).toBe('ok');
    expect(stored.integrity).toBe('ok');
  });

  it('asks the installer to keep a plugged-in host awake', () => {
    const iss = fs.readFileSync(
      fileURLToPath(new URL('../../../installer/leaveos.iss', import.meta.url)),
      'utf8',
    );
    expect(iss).toContain('powercfg.exe');
    expect(iss).toContain('/change standby-timeout-ac 0');
    expect(iss).toContain('/change hibernate-timeout-ac 0');
    expect(iss).toContain('DisableDirPage=yes');
    expect(iss).toContain('DisableReadyPage=yes');
    expect(iss).toContain('prepare-host.cjs');
    expect(iss).toContain('--restore-power');
    expect(iss).toContain('--prepare');
    expect(iss).toContain('https://127.0.0.1:8443/host');
    expect(iss).toContain('Also delete Leave OS data and backups?');
    expect(iss).toContain('advfirewall firewall delete rule name=""Leave OS""');
    expect(iss).toContain('advfirewall firewall delete rule name=""Leave OS HTTP""');
    expect(iss).toContain('certs\\ca.pem');
    expect(iss).toContain('Leave OS Local CA');
    expect(iss).not.toContain('[UninstallDelete]\nType: filesandordirs; Name: "{commonappdata}');
    const service = fs.readFileSync(
      fileURLToPath(new URL('../../../installer/install-service.cjs', import.meta.url)),
      'utf8',
    );
    expect(service).toContain("allowInbound('Leave OS HTTP', 'TCP', '80,8080')");
    expect(service).toContain('LeaveOS-service.exe');
    expect(service).toContain("winsw(['install'])");
    expect(service).toContain("winsw(['start'])");
    expect(service).toContain("winsw(['status'])");
    expect(service).toContain('Leave OS service state is Running.');
    expect(service).not.toContain('node-windows');
    expect(iss).toContain('LeaveOS-service.exe');
    expect(iss).toContain('Parameters: "stop"');
    expect(iss).toContain('Parameters: "uninstall"');
    expect(iss).toContain('ssPostInstall');
    expect(iss).toContain('ResultCode');
    expect(iss).toContain('SuppressibleMsgBox');
    expect(iss).toContain('verify ca.pem');
    expect(iss).toContain('install.log');
    expect(iss).toContain('power-previous.json');
    expect(iss).toContain('Type: filesandordirs; Name: "{app}"');
    expect(iss).not.toMatch(/^\[Run\]/m);
  });
});
