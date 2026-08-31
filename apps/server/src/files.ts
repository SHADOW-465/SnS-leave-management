import fs from 'node:fs';
import path from 'node:path';
import { DomainError, newId } from '@sns/domain';
import { sha256Hex } from '@sns/auth';
const MAGIC: {
  type: string;
  test: (b: Buffer) => boolean;
}[] = [
  { type: 'application/pdf', test: (b) => b.subarray(0, 4).toString() === '%PDF' },
  { type: 'image/jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    type: 'image/png',
    test: (b) =>
      b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
];
const MAX_BYTES = 10 * 1024 * 1024;
export function sniffMagic(buf: Buffer): string | null {
  return MAGIC.find((m) => m.test(buf))?.type ?? null;
}
export function storeAttachment(input: {
  root: string;
  originalName: string;
  mimeType: string;
  buffer: Buffer;
}): {
  storedName: string;
  detectedType: string;
  sha256: string;
  size: number;
} {
  if (input.buffer.length > MAX_BYTES) {
    throw new DomainError('UPLOAD_TOO_LARGE', 'File is too large. Maximum is 10 MB.');
  }
  const detected = sniffMagic(input.buffer);
  if (!detected) {
    throw new DomainError('UPLOAD_TYPE_REJECTED', 'Only PDF, JPG, and PNG files are accepted.');
  }
  const declared = input.mimeType.split(';')[0]?.trim();
  if (declared && declared !== 'application/octet-stream' && declared !== detected) {
    throw new DomainError(
      'UPLOAD_TYPE_MISMATCH',
      'The file contents do not match the declared type.',
    );
  }
  const storedName = `${newId()}${extensionFor(detected)}`;
  const dest = path.join(input.root, storedName);
  const resolved = path.resolve(dest);
  if (!resolved.startsWith(path.resolve(input.root))) {
    throw new DomainError('UPLOAD_PATH', 'Invalid filename.');
  }
  fs.mkdirSync(input.root, { recursive: true });
  fs.writeFileSync(dest, input.buffer);
  return {
    storedName,
    detectedType: detected,
    sha256: sha256Hex(input.buffer),
    size: input.buffer.length,
  };
}
function extensionFor(mime: string): string {
  if (mime === 'application/pdf') return '.pdf';
  if (mime === 'image/jpeg') return '.jpg';
  return '.png';
}
export function safeStoredPath(root: string, storedName: string): string {
  const base = path.basename(storedName);
  const resolved = path.resolve(root, base);
  if (!resolved.startsWith(path.resolve(root))) {
    throw new DomainError('UPLOAD_PATH', 'Invalid filename.');
  }
  return resolved;
}
