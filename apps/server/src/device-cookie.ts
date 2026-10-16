import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/** Secret that signs the device cookie. Created once per data directory. */
export function loadDeviceSecret(dataDir: string): Buffer {
  const file = path.join(dataDir, 'device-cookie.key');
  if (fs.existsSync(file)) return fs.readFileSync(file);
  const secret = randomBytes(32);
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}

export function sealDeviceId(id: string, secret: Buffer): string {
  const sig = createHmac('sha256', secret).update(id).digest('base64url');
  return `${id}.${sig}`;
}

/** Returns the device id, or null when the cookie is missing or the signature does not match. */
export function openDeviceCookie(value: string | undefined, secret: Buffer): string | null {
  if (!value) return null;
  const dot = value.lastIndexOf('.');
  if (dot <= 0) return null;
  const id = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  if (!/^[0-9A-Za-z]{10,40}$/.test(id)) return null;
  const expected = createHmac('sha256', secret).update(id).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return id;
}

export function normalizeIp(raw: string | null | undefined): string {
  let ip = (raw ?? '').trim();
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  return ip;
}
