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
    const ca = new X509Certificate(first.ca);
    expect(ca.ca).toBe(true);
    expect(ca.verify(ca.publicKey)).toBe(true);
    expect(parsed.ca).toBe(false);
    expect(parsed.issuer).toBe(ca.subject);
    expect(parsed.issuer).not.toBe(parsed.subject);
    expect(parsed.verify(ca.publicKey)).toBe(true);
    expect(parsed.subjectAltName).toContain('DNS:localhost');
    expect(parsed.subjectAltName).toContain('DNS:sns-leave');
    expect(parsed.subjectAltName).toContain('DNS:sns-leave.local');
    expect(parsed.subjectAltName).toContain('IP Address:127.0.0.1');
    expect(fs.readFileSync(path.join(dir, 'cert.pem'), 'utf8')).toContain('BEGIN CERTIFICATE');
    expect(fs.readFileSync(path.join(dir, 'cert.pem'), 'utf8')).not.toContain('PRIVATE KEY');
    expect(fs.existsSync(path.join(dir, 'ca-key.pem'))).toBe(true);
    const renamed = await ensureLanCertificate(dir, { hostname: 'front-desk' });
    expect(renamed.cert.equals(first.cert)).toBe(false);
    expect(renamed.ca.equals(first.ca)).toBe(true);
    expect(new X509Certificate(renamed.cert).subjectAltName).toContain('DNS:front-desk.local');
    expect(new X509Certificate(renamed.cert).verify(ca.publicKey)).toBe(true);
  });

  it('keeps the same CA and rewrites the leaf when a LAN address changes', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leaveos-tls-'));
    dirs.push(dir);
    const first = await ensureLanCertificate(dir, { addresses: ['10.1.1.5'] });
    expect(new X509Certificate(first.cert).subjectAltName).toContain('IP Address:10.1.1.5');
    const again = await ensureLanCertificate(dir, { addresses: ['10.1.1.5'] });
    expect(again.cert.equals(first.cert)).toBe(true);
    const moved = await ensureLanCertificate(dir, { addresses: ['10.9.9.9'] });
    expect(moved.ca.equals(first.ca)).toBe(true);
    expect(moved.cert.equals(first.cert)).toBe(false);
    const leaf = new X509Certificate(moved.cert);
    expect(leaf.subjectAltName).toContain('IP Address:10.9.9.9');
    expect(leaf.subjectAltName).toContain('IP Address:127.0.0.1');
    expect(leaf.verify(new X509Certificate(moved.ca).publicKey)).toBe(true);
    expect(fs.readFileSync(path.join(dir, 'ca-key.pem'), 'utf8')).not.toContain(
      'BEGIN CERTIFICATE',
    );
  });
});
