import { X509Certificate } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generate } from 'selfsigned';
import type { AppConfig } from '@sns/config';
import { pathsFor } from '@sns/config';
import { DEFAULT_LAN_HOSTNAME } from '@sns/contracts';
import { lanAddress } from './host-local.js';

function certificateCovers(san: string, dns: string[], ips: string[]): boolean {
  const text = san.toLowerCase();
  const dnsOk = dns.every((name) => text.includes(`dns:${name.toLowerCase()}`));
  const ipOk = ips.every((ip) => text.includes(`ip address:${ip.toLowerCase()}`));
  return dnsOk && ipOk;
}

export async function ensureLanCertificate(
  dir: string,
  opts: { hostname?: string } = {},
): Promise<{ cert: Buffer; key: Buffer }> {
  fs.mkdirSync(dir, { recursive: true });
  const certPath = path.join(dir, 'cert.pem');
  const keyPath = path.join(dir, 'key.pem');
  const hostname =
    (opts.hostname || DEFAULT_LAN_HOSTNAME).trim().toLowerCase() || DEFAULT_LAN_HOSTNAME;
  const dns = ['localhost', hostname, `${hostname}.local`];
  const machine = os.hostname();
  if (machine && !dns.some((name) => name.toLowerCase() === machine.toLowerCase()))
    dns.push(machine);
  const ips = ['127.0.0.1'];
  const lan = lanAddress();
  if (lan && !ips.includes(lan)) ips.push(lan);
  if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
    const existing = fs.readFileSync(certPath);
    const san = new X509Certificate(existing).subjectAltName ?? '';
    if (certificateCovers(san, dns, ips)) {
      return { cert: existing, key: fs.readFileSync(keyPath) };
    }
  }
  const altNames: { type: 2 | 7; value?: string; ip?: string }[] = [
    ...dns.map((value) => ({ type: 2 as const, value })),
    ...ips.map((ip) => ({ type: 7 as const, ip })),
  ];
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
  hostname?: string,
): Promise<{ cert: Buffer; key: Buffer } | null> {
  if (!config.tlsEnabled) return null;
  if (config.tlsCertPath && config.tlsKeyPath) {
    return {
      cert: fs.readFileSync(config.tlsCertPath),
      key: fs.readFileSync(config.tlsKeyPath),
    };
  }
  return ensureLanCertificate(pathsFor(config).certs, { hostname });
}
