import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { X509Certificate } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { ensureLanCertificate } from './tls.js';

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('LAN certificate', () => {
  it('writes a certificate for localhost and reuses it', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leaveos-tls-'));
    dirs.push(dir);
    const first = await ensureLanCertificate(dir);
    const second = await ensureLanCertificate(dir);
    expect(first.cert.equals(second.cert)).toBe(true);
    expect(first.key.equals(second.key)).toBe(true);
    const parsed = new X509Certificate(first.cert);
    expect(parsed.subjectAltName).toContain('DNS:localhost');
    expect(parsed.subjectAltName).toContain('DNS:sns-leave');
    expect(parsed.subjectAltName).toContain('DNS:sns-leave.local');
    expect(parsed.subjectAltName).toContain('IP Address:127.0.0.1');
    expect(fs.readFileSync(path.join(dir, 'cert.pem'), 'utf8')).toContain('BEGIN CERTIFICATE');
    const renamed = await ensureLanCertificate(dir, { hostname: 'front-desk' });
    expect(renamed.cert.equals(first.cert)).toBe(false);
    expect(new X509Certificate(renamed.cert).subjectAltName).toContain('DNS:front-desk.local');
  });
});
