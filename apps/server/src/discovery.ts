import { createSocket, type Socket } from 'node:dgram';
import { DEFAULT_LAN_HOSTNAME } from '@sns/contracts';
import multicastDns from 'multicast-dns';

const LLMNR_ADDR = '224.0.0.252';
const LLMNR_PORT = 5355;

export type StaffUrls = {
  name: string;
  hostname: string;
  mdns: string;
  ip: string | null;
};

export function staffUrls(input: {
  hostname?: string | null;
  port: number;
  tls: boolean;
  address?: string | null;
}): StaffUrls {
  const name =
    (input.hostname || DEFAULT_LAN_HOSTNAME).trim().toLowerCase() || DEFAULT_LAN_HOSTNAME;
  const scheme = input.tls ? 'https' : 'http';
  return {
    name,
    hostname: `${scheme}://${name}:${input.port}`,
    mdns: `${scheme}://${name}.local:${input.port}`,
    ip: input.address ? `${scheme}://${input.address}:${input.port}` : null,
  };
}

export type DnsAnswer = {
  name: string;
  type: string;
  ttl: number;
  data: string | string[] | { port: number; weight: number; priority: number; target: string };
};

export function discoveryRecords(input: {
  hostname: string;
  address: string;
  port: number;
}): DnsAnswer[] {
  const fqdn = `${input.hostname}.local`;
  const instance = `${input.hostname}._https._tcp.local`;
  return [
    { name: fqdn, type: 'A', ttl: 120, data: input.address },
    { name: '_https._tcp.local', type: 'PTR', ttl: 120, data: instance },
    {
      name: instance,
      type: 'SRV',
      ttl: 120,
      data: { port: input.port, weight: 0, priority: 0, target: fqdn },
    },
    { name: instance, type: 'TXT', ttl: 120, data: ['path=/'] },
  ];
}

export function answersForQuery(
  questions: { name?: string; type?: string }[],
  input: { hostname: string; address: string; port: number },
): DnsAnswer[] {
  const records = discoveryRecords(input);
  const [a, ptr, srv, txt] = records;
  const instance = srv!.name.toLowerCase();
  const fqdn = `${input.hostname.toLowerCase()}.local`;
  const bare = input.hostname.toLowerCase();
  const answers: DnsAnswer[] = [];
  for (const question of questions) {
    const name = String(question.name ?? '')
      .replace(/\.$/, '')
      .toLowerCase();
    const type = String(question.type ?? 'A').toUpperCase();
    const any = type === 'ANY';
    if ((name === fqdn || name === bare) && (type === 'A' || any) && a) answers.push(a);
    if (
      (name === '_https._tcp.local' || name === '_https._tcp') &&
      (type === 'PTR' || any) &&
      ptr
    ) {
      answers.push(ptr);
    }
    if (name === instance && (type === 'SRV' || any) && srv) answers.push(srv);
    if (name === instance && (type === 'TXT' || any) && txt) answers.push(txt);
  }
  return answers;
}

export function encodeDnsQuestion(id: number, name: string, qtype = 1): Buffer {
  const labels = name
    .split('.')
    .filter(Boolean)
    .map((label) => {
      const raw = Buffer.from(label);
      return Buffer.concat([Buffer.from([raw.length]), raw]);
    });
  const header = Buffer.alloc(12);
  header.writeUInt16BE(id & 0xffff, 0);
  header.writeUInt16BE(1, 4);
  const tail = Buffer.alloc(4);
  tail.writeUInt16BE(qtype, 0);
  tail.writeUInt16BE(1, 2);
  return Buffer.concat([header, ...labels, Buffer.from([0]), tail]);
}

export function firstQuestion(buf: Buffer): { name: string; type: number; end: number } | null {
  if (buf.length < 12 || buf.readUInt16BE(4) < 1) return null;
  const labels: string[] = [];
  let offset = 12;
  while (offset < buf.length) {
    const len = buf[offset] ?? 0;
    if (len === 0) {
      offset += 1;
      break;
    }
    if ((len & 0xc0) === 0xc0 || offset + 1 + len > buf.length) return null;
    labels.push(buf.subarray(offset + 1, offset + 1 + len).toString('utf8'));
    offset += 1 + len;
  }
  if (offset + 4 > buf.length) return null;
  return { name: labels.join('.'), type: buf.readUInt16BE(offset), end: offset + 4 };
}

/** LLMNR response for a single-label A query. Null when the name is not ours. */
export function llmnrAnswer(query: Buffer, hostname: string, address: string): Buffer | null {
  const question = firstQuestion(query);
  if (!question) return null;
  if (question.name.toLowerCase() !== hostname.toLowerCase()) return null;
  if (question.type !== 1 && question.type !== 255) return null;
  const octets = address.split('.').map((part) => Number(part));
  if (octets.length !== 4 || octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return null;
  }
  const header = Buffer.alloc(12);
  header.writeUInt16BE(query.readUInt16BE(0), 0);
  header.writeUInt16BE(0x8000, 2);
  header.writeUInt16BE(1, 4);
  header.writeUInt16BE(1, 6);
  const answer = Buffer.alloc(16);
  answer.writeUInt16BE(0xc00c, 0);
  answer.writeUInt16BE(1, 2);
  answer.writeUInt16BE(1, 4);
  answer.writeUInt32BE(30, 6);
  answer.writeUInt16BE(4, 10);
  octets.forEach((n, i) => answer.writeUInt8(n, 12 + i));
  return Buffer.concat([header, query.subarray(12, question.end), answer]);
}

type Active = {
  hostname: string;
  port: number;
  address: string;
  stop: () => void;
};

let active: Active | null = null;

function bindMdns(input: { hostname: string; address: string; port: number }): () => void {
  const mdns = multicastDns({ reuseAddr: true, loopback: true });
  const announce = () => {
    try {
      mdns.respond({ answers: discoveryRecords(input) });
    } catch {
      // A failed announcement must not stop Leave OS.
    }
  };
  mdns.on('query', (query) => {
    const answers = answersForQuery(query.questions ?? [], input);
    if (answers.length === 0) return;
    try {
      mdns.respond({ answers });
    } catch {
      // Ignore a socket that is already closing.
    }
  });
  announce();
  return () => {
    try {
      mdns.destroy();
    } catch {
      // Already closed.
    }
  };
}

function bindLlmnr(hostname: string, address: string): () => void {
  let socket: Socket;
  try {
    socket = createSocket({ type: 'udp4', reuseAddr: true });
  } catch {
    return () => undefined;
  }
  socket.on('error', () => undefined);
  socket.on('message', (msg, rinfo) => {
    const answer = llmnrAnswer(msg, hostname, address);
    if (!answer) return;
    try {
      socket.send(answer, rinfo.port, rinfo.address);
    } catch {
      // The querier went away.
    }
  });
  try {
    socket.bind(LLMNR_PORT, () => {
      try {
        socket.addMembership(LLMNR_ADDR);
      } catch {
        // Another process on this host may already have joined.
      }
    });
  } catch {
    try {
      socket.close();
    } catch {
      // Already closed.
    }
    return () => undefined;
  }
  return () => {
    try {
      socket.close();
    } catch {
      // Already closed.
    }
  };
}

/**
 * Answer mDNS for `<name>.local` and LLMNR for the single-label name.
 * No LAN address means there is nothing to publish yet.
 */
export async function publishLanName(input: {
  hostname: string;
  port: number;
  address: string | null;
}): Promise<{ stop: () => void }> {
  active?.stop();
  active = null;
  if (!input.address) return { stop() {} };
  const stops: Array<() => void> = [];
  try {
    stops.push(bindMdns({ hostname: input.hostname, address: input.address, port: input.port }));
  } catch {
    // mDNS is best-effort. The IP link still works.
  }
  stops.push(bindLlmnr(input.hostname, input.address));
  const stop = () => {
    for (const fn of stops) fn();
  };
  active = { hostname: input.hostname, port: input.port, address: input.address, stop };
  return {
    stop() {
      if (active?.stop === stop) active = null;
      stop();
    },
  };
}

export async function republishHostname(hostname: string): Promise<void> {
  if (!active) return;
  await publishLanName({ hostname, port: active.port, address: active.address });
}
