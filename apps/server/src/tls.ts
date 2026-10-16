import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generate } from 'selfsigned';
import type { AppConfig } from '@sns/config';
import { pathsFor } from '@sns/config';
import { lanAddress } from './host-local.js';

export async function ensureLanCertificate(dir: string): Promise<{ cert: Buffer; key: Buffer }> {
  fs.mkdirSync(dir, { recursive: true });
  const certPath = path.join(dir, 'cert.pem');
  const keyPath = path.join(dir, 'key.pem');
  if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
    return { cert: fs.readFileSync(certPath), key: fs.readFileSync(keyPath) };
  }
  const altNames: { type: 2 | 7; value?: string; ip?: string }[] = [
    { type: 2, value: 'localhost' },
    { type: 7, ip: '127.0.0.1' },
  ];
  const host = os.hostname();
  if (host) altNames.push({ type: 2, value: host });
  const lan = lanAddress();
  if (lan) altNames.push({ type: 7, ip: lan });
  const notAfterDate = new Date();
  notAfterDate.setDate(notAfterDate.getDate() + 825);
  const pems = await generate([{ name: 'commonName', value: 'Leave OS' }], {
    keySize: 2048,
    algorithm: 'sha256',
    notAfterDate,
    extensions: [{ name: 'subjectAltName', altNames }],
  });
  fs.writeFileSync(certPath, pems.cert, { mode: 0o644 });
  fs.writeFileSync(keyPath, pems.private, { mode: 0o600 });
  return { cert: Buffer.from(pems.cert), key: Buffer.from(pems.private) };
}

export async function resolveTlsMaterial(
  config: AppConfig,
): Promise<{ cert: Buffer; key: Buffer } | null> {
  if (!config.tlsEnabled) return null;
  if (config.tlsCertPath && config.tlsKeyPath) {
    return {
      cert: fs.readFileSync(config.tlsCertPath),
      key: fs.readFileSync(config.tlsKeyPath),
    };
  }
  return ensureLanCertificate(pathsFor(config).certs);
}
