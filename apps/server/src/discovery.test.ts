import { describe, expect, it } from 'vitest';
import { lanHostnameSettingsSchema } from '@sns/contracts';
import {
  answersForQuery,
  encodeDnsQuestion,
  llmnrAnswer,
  setupStaffUrls,
  staffUrls,
} from './discovery.js';

describe('office name', () => {
  it('builds the staff links and keeps the IP as a fallback', () => {
    const links = staffUrls({ hostname: 'sns-leave', port: 8443, tls: true, address: '10.0.0.8' });
    expect(links.hostname).toBe('https://sns-leave:8443');
    expect(links.mdns).toBe('https://sns-leave.local:8443');
    expect(links.ip).toBe('https://10.0.0.8:8443');
    expect(staffUrls({ port: 8443, tls: true, address: null }).name).toBe('sns-leave');
    expect(setupStaffUrls({ hostname: 'sns-leave', setupPort: 80, address: '10.0.0.8' })).toEqual({
      name: 'sns-leave',
      hostname: 'http://sns-leave',
      mdns: 'http://sns-leave.local',
      ip: 'http://10.0.0.8',
    });
    expect(setupStaffUrls({ hostname: 'sns-leave', setupPort: 8080, address: '10.0.0.8' })).toEqual(
      {
        name: 'sns-leave',
        hostname: 'http://sns-leave:8080',
        mdns: 'http://sns-leave.local:8080',
        ip: 'http://10.0.0.8:8080',
      },
    );
  });

  it('answers an A query for sns-leave.local and publishes the https service', () => {
    const answers = answersForQuery([{ name: 'sns-leave.local', type: 'A' }], {
      hostname: 'sns-leave',
      address: '10.0.0.8',
      port: 8443,
    });
    expect(answers).toEqual([{ name: 'sns-leave.local', type: 'A', ttl: 120, data: '10.0.0.8' }]);
    const service = answersForQuery([{ name: '_https._tcp.local.', type: 'PTR' }], {
      hostname: 'sns-leave',
      address: '10.0.0.8',
      port: 8443,
    });
    expect(service[0]?.data).toBe('sns-leave._https._tcp.local');
    expect(
      answersForQuery([{ name: 'other.local', type: 'A' }], {
        hostname: 'sns-leave',
        address: '10.0.0.8',
        port: 8443,
      }),
    ).toEqual([]);
  });

  it('answers LLMNR for the single-label name only', () => {
    const query = encodeDnsQuestion(0x1234, 'sns-leave');
    const answer = llmnrAnswer(query, 'sns-leave', '10.0.0.8');
    expect(answer).not.toBeNull();
    expect(answer!.readUInt16BE(0)).toBe(0x1234);
    expect(answer!.readUInt16BE(2) & 0x8000).toBe(0x8000);
    expect([...answer!.subarray(answer!.length - 4)]).toEqual([10, 0, 0, 8]);
    expect(llmnrAnswer(query, 'other-host', '10.0.0.8')).toBeNull();
    expect(
      llmnrAnswer(encodeDnsQuestion(1, 'sns-leave.local'), 'sns-leave', '10.0.0.8'),
    ).toBeNull();
  });

  it('accepts a configured name and rejects a sentence', () => {
    expect(lanHostnameSettingsSchema.parse({ hostname: 'Front-Desk.local' }).hostname).toBe(
      'front-desk',
    );
    expect(lanHostnameSettingsSchema.safeParse({ hostname: 'not a name' }).success).toBe(false);
    expect(
      lanHostnameSettingsSchema.safeParse({ hostname: 'sns-leave', extra: true }).success,
    ).toBe(false);
  });
});
