const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function encodeTime(ms: number): string {
  let n = BigInt(ms);
  let out = '';
  for (let i = 0; i < 10; i++) {
    out = CROCKFORD[Number(n % 32n)] + out;
    n /= 32n;
  }
  return out;
}

function encodeRandom(): string {
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let out = '';
  for (let i = 0; i < 16; i++) {
    out = CROCKFORD[Number(n % 32n)] + out;
    n /= 32n;
  }
  return out;
}

/** ULID. Sortable, unguessable, never `count + 1`. */
export function newId(nowMs = Date.now()): string {
  return encodeTime(nowMs) + encodeRandom();
}
