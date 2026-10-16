import { X509Certificate } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generate } from 'selfsigned';
import type { AppConfig } from '@sns/config';
import { pathsFor } from '@sns/config';
import { DEFAULT_LAN_HOSTNAME } from '@sns/contracts';
import { lanAddresses } from './host-local.js';

export const CA_FILE = 'ca.pem';
export const CA_KEY_FILE = 'ca-key.pem';
const CA_CN = 'Leave OS Local CA';

function certificateCovers(san: string, dns: string[], ips: string[]): boolean {
  const text = san.toLowerCase();
  const dnsOk = dns.every((name) => text.includes(`dns:${name.toLowerCase()}`));
  const ipOk = ips.every((ip) => text.includes(`ip address:${ip.toLowerCase()}`));
  return dnsOk && ipOk;
}

function readPem(file: string): Buffer | null {
  return fs.existsSync(file) ? fs.readFileSync(file) : null;
}

function caUsable(pem: Buffer): boolean {
  try {
    const ca = new X509Certificate(pem);
    return ca.ca && ca.verify(ca.publicKey);
  } catch {
    return false;
  }
}

function leafMatches(certPem: Buffer, caPem: Buffer, dns: string[], ips: string[]): boolean {
  try {
    const leaf = new X509Certificate(certPem);
    const ca = new X509Certificate(caPem);
    if (leaf.ca || !leaf.verify(ca.publicKey)) return false;
    return certificateCovers(leaf.subjectAltName ?? '', dns, ips);
  } catch {
    return false;
  }
}

export async function ensureLanCertificate(
  dir: string,
  opts: { hostname?: string; addresses?: string[] } = {},
): Promise<{ cert: Buffer; key: Buffer; ca: Buffer }> {
  fs.mkdirSync(dir, { recursive: true });
  const certPath = path.join(dir, 'cert.pem');
  const keyPath = path.join(dir, 'key.pem');
  const caPath = path.join(dir, CA_FILE);
  const caKeyPath = path.join(dir, CA_KEY_FILE);
  const hostname =
    (opts.hostname || DEFAULT_LAN_HOSTNAME).trim().toLowerCase() || DEFAULT_LAN_HOSTNAME;
  const dns = ['localhost', hostname, `${hostname}.local`];
  const machine = os.hostname();
  if (machine && !dns.some((name) => name.toLowerCase() === machine.toLowerCase()))
    dns.push(machine);
  const ips = ['127.0.0.1', ...(opts.addresses ?? lanAddresses())];
  const uniqueIps = [...new Set(ips)];

  let ca = readPem(caPath);
  let caKey = readPem(caKeyPath);
  if (!ca || !caKey || !caUsable(ca)) {
    const notAfterDate = new Date();
    notAfterDate.setFullYear(notAfterDate.getFullYear() + 10);
    const created = await generate(
      [
        { name: 'commonName', value: CA_CN },
        { name: 'organizationName', value: 'Simon & Sons' },
      ],
      {
        keySize: 2048,
        algorithm: 'sha256',
        notAfterDate,
        extensions: [
          { name: 'basicConstraints', cA: true, critical: true },
          { name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true },
        ],
      },
    );
    fs.writeFileSync(caPath, created.cert, { mode: 0o644 });
    fs.writeFileSync(caKeyPath, created.private, { mode: 0o600 });
    ca = Buffer.from(created.cert);
    caKey = Buffer.from(created.private);
  }

  const existing = readPem(certPath);
  const existingKey = readPem(keyPath);
  if (existing && existingKey && leafMatches(existing, ca, dns, uniqueIps)) {
    return { cert: existing, key: existingKey, ca };
  }

  const notAfterDate = new Date();
  notAfterDate.setDate(notAfterDate.getDate() + 825);
  const altNames: { type: 2 | 7; value?: string; ip?: string }[] = [
    ...dns.map((value) => ({ type: 2 as const, value })),
    ...uniqueIps.map((ip) => ({ type: 7 as const, ip })),
  ];
  const leaf = await generate([{ name: 'commonName', value: 'Leave OS' }], {
    keySize: 2048,
    algorithm: 'sha256',
    notAfterDate,
    ca: { key: caKey.toString('utf8'), cert: ca.toString('utf8') },
    extensions: [
      { name: 'basicConstraints', cA: false },
      { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
      { name: 'extKeyUsage', serverAuth: true },
      { name: 'subjectAltName', altNames },
    ],
  });
  fs.writeFileSync(certPath, leaf.cert, { mode: 0o644 });
  fs.writeFileSync(keyPath, leaf.private, { mode: 0o600 });
  return { cert: Buffer.from(leaf.cert), key: Buffer.from(leaf.private), ca };
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
  const dir = pathsFor(config).certs;
  const material = await ensureLanCertificate(dir, { hostname });
  const chain = Buffer.concat([material.cert, Buffer.from('\n'), material.ca]);
  return { cert: chain, key: material.key };
}
