import { HttpException, Logger } from '@nestjs/common';

import type { AuthOptions } from './actor.guard';
import type { Attempts } from './attempts';
import { type Forwarding, forwardingFields } from './forwarding';
import type { Maintenance } from './maintenance';
import { SignInService } from './sign-in.service';
import type { AuditPort } from '../audit/audit.port';
import type { EventPort } from '../events/event.port';
import type { LivePublisher } from '../events/live/live.hub';
import type { PrismaClient } from '../generated/prisma/client';

const SOCKET = 'fd12:3456:789a::1';
const SOCKET_MASKED = 'fd12:3456:x:x:x:x:x:x';

function chain(count: number) {
  return Array.from(
    { length: count },
    (_, i) => `${(i % 250) + 1}.${(i % 250) + 1}.9.9`,
  );
}

function masked(from: number, to: number) {
  return Array.from(
    { length: to - from + 1 },
    (_, i) => `${((from + i - 1) % 250) + 1}.${((from + i - 1) % 250) + 1}.x.x`,
  );
}

function hopsOf(line: string) {
  return /hops=(\S*)/.exec(line)?.[1];
}

function headersOf(line: string) {
  return /headers=(\S*)/.exec(line)?.[1];
}

describe('forwardingFields with a chain at and past the cap', () => {
  // @traces 500-FR-012
  it('lists exactly 8 entries and the socket without a prefix', () => {
    const line = forwardingFields({
      headers: { 'x-forwarded-for': chain(8).join(', ') },
      socket: SOCKET,
    });

    expect(hopsOf(line)).toBe([...masked(1, 8), SOCKET_MASKED].join(','));
  });

  // @traces 500-FR-012
  it('keeps the rightmost 8 and counts one left out for 9 entries', () => {
    const line = forwardingFields({
      headers: { 'x-forwarded-for': chain(9).join(', ') },
      socket: SOCKET,
    });

    expect(hopsOf(line)).toBe(['+1', ...masked(2, 9), SOCKET_MASKED].join(','));
  });

  // @traces 500-FR-012
  it('keeps the rightmost 8 of hundreds and never the whole header', () => {
    const line = forwardingFields({
      headers: { 'x-forwarded-for': chain(400).join(', ') },
      socket: SOCKET,
    });

    expect(hopsOf(line)).toBe(
      ['+392', ...masked(393, 400), SOCKET_MASKED].join(','),
    );
    expect(line.length).toBeLessThan(400);
  });

  // @traces 500-FR-012
  it('lists the socket alone with no forwarded-for header', () => {
    expect(forwardingFields({ headers: {}, socket: SOCKET })).toBe(
      `hops=${SOCKET_MASKED} headers=none`,
    );
  });

  // @traces 500-FR-012
  it('reads an absent socket as unknown', () => {
    expect(forwardingFields({ headers: {}, socket: undefined })).toBe(
      'hops=unknown headers=none',
    );
  });

  // @traces 500-FR-012
  it('reads an empty socket as unknown', () => {
    expect(forwardingFields({ headers: {}, socket: '' })).toBe(
      'hops=unknown headers=x'.replace(' headers=x', ' headers=none'),
    );
  });

  // @traces 500-FR-012
  it('joins a forwarded-for header received as several values', () => {
    const line = forwardingFields({
      headers: { 'x-forwarded-for': ['1.2.3.4', '5.6.7.8, 9.9.9.9'] },
      socket: SOCKET,
    });

    expect(hopsOf(line)).toBe(`1.2.x.x,5.6.x.x,9.9.x.x,${SOCKET_MASKED}`);
  });

  // @traces 500-FR-012
  it('reads an entry with a port, a name or an e-mail as unknown', () => {
    const line = forwardingFields({
      headers: {
        'x-forwarded-for':
          '86.125.92.213:4711, andrei@example.test, 999.1.1.1, 86.125.1.2',
      },
      socket: SOCKET,
    });

    expect(hopsOf(line)).toBe(
      `unknown,unknown,unknown,86.125.x.x,${SOCKET_MASKED}`,
    );
  });

  // @traces 500-FR-012
  it('gives the same line when called twice on the same request', () => {
    const input = {
      headers: { via: '1.1 edge', 'x-forwarded-for': '1.2.3.4' },
      socket: SOCKET,
    };

    expect(forwardingFields(input)).toBe(forwardingFields(input));
  });
});

describe('forwardingFields with hostile header values', () => {
  // @traces 500-FR-012 500-FR-011
  it('cannot smuggle a token or a line break out of a hop', () => {
    const line = forwardingFields({
      headers: {
        'x-forwarded-for':
          '1.2.3.4 headers=none, 5.6.7.8\nsign-in refused: x, \u001b[31m9.9.9.9',
      },
      socket: SOCKET,
    });

    expect(line).toBe(
      `hops=unknown,unknown,unknown,${SOCKET_MASKED} headers=x-forwarded-for`,
    );
    expect(line.includes('\n') || line.includes('\u001b')).toBe(false);
  });

  // @traces 500-FR-014 500-FR-011
  it('masks a unicode digit lookalike address as unknown', () => {
    const line = forwardingFields({
      headers: { 'x-real-ip': '８６.125.1.2' },
      socket: SOCKET,
    });

    expect(line).toBe(
      `hops=${SOCKET_MASKED} headers=x-real-ip real-ip=unknown`,
    );
  });

  // @traces 500-FR-011
  it('never writes a full address of the request anywhere', () => {
    const line = forwardingFields({
      headers: {
        forwarded: 'for="[2a02:2f0c:1234:5678::9]:4711";by=203.0.113.77',
        'x-81.196.1.2-ip': 'x',
        'x-forwarded-for': '86.125.92.213, 95.173.10.20',
        'x-real-ip': '86.125.92.213',
      },
      socket: '203.0.113.9',
    });

    expect(line).not.toMatch(/92\.213|10\.20|113\.77|113\.9|1234:5678|1\.2-ip/);
  });
});

describe('forwardingFields header names', () => {
  // @traces 500-FR-013
  it('lists none when no forwarding header is present', () => {
    expect(
      forwardingFields({
        headers: { authorization: 'c', cookie: 'b', host: 'a' },
        socket: SOCKET,
      }),
    ).toBe(`hops=${SOCKET_MASKED} headers=none`);
  });

  // @traces 500-FR-013
  it('lists every named header sorted, lower-case and once', () => {
    const line = forwardingFields({
      headers: {
        'cdn-clientip': 'x',
        'cf-connecting-ip': 'x',
        'fastly-client-ip': 'x',
        forwarded: 'x',
        'true-client-ip': 'x',
        Via: 'x',
        via: 'x',
        'X-Real-IP': 'x',
        'x-client-ip': 'x',
        'x-cluster-client-ip': 'x',
        'x-envoy-peer': 'x',
        'x-forwarded-host': 'x',
        'x-railway-edge': 'x',
      },
      socket: SOCKET,
    });

    expect(headersOf(line)).toBe(
      [
        'cdn-clientip',
        'cf-connecting-ip',
        'fastly-client-ip',
        'forwarded',
        'true-client-ip',
        'via',
        'x-client-ip',
        'x-cluster-client-ip',
        'x-envoy-peer',
        'x-forwarded-host',
        'x-railway-edge',
        'x-real-ip',
      ].join(','),
    );
  });

  // @traces 500-FR-013
  it('lists any other name ending in -ip or clientip', () => {
    const line = forwardingFields({
      headers: { 'x-edge-ip': 'x', 'x-foo-clientip': 'x', 'x-ipv': 'x' },
      socket: SOCKET,
    });

    expect(headersOf(line)).toBe('x-edge-ip,x-foo-clientip');
  });

  // @traces 500-FR-013
  it.each([
    ['digits', 'x-81-ip'],
    ['dots', 'x-81.196.1.2-ip'],
    ['an underscore', 'x_real_ip'],
    ['a space', 'x-real ip'],
  ])('never lists a name holding %s', (_, name) => {
    const line = forwardingFields({
      headers: { [name]: 'x' },
      socket: SOCKET,
    });

    expect(headersOf(line)).toBe('none');
  });

  // @traces 500-FR-013
  it('lists a name of exactly 40 characters and not one of 41', () => {
    const at = `x-forwarded-${'a'.repeat(28)}`;
    const past = `x-forwarded-${'a'.repeat(29)}`;
    expect(at).toHaveLength(40);

    const line = forwardingFields({
      headers: { [at]: 'x', [past]: 'x' },
      socket: SOCKET,
    });

    expect(headersOf(line)).toBe(at);
  });

  // @traces 500-FR-013
  it('lists at most 16 names', () => {
    const headers: Record<string, string> = {};
    for (const letter of 'abcdefghijklmnopqrst') {
      headers[`x-forwarded-${letter}`] = 'x';
    }

    const line = forwardingFields({ headers, socket: SOCKET });

    expect(headersOf(line)?.split(',')).toHaveLength(16);
  });

  // @traces 500-FR-013
  it('lists exactly 16 names when 16 are present', () => {
    const headers: Record<string, string> = {};
    for (const letter of 'abcdefghijklmnop') {
      headers[`x-forwarded-${letter}`] = 'x';
    }

    const line = forwardingFields({ headers, socket: SOCKET });

    expect(headersOf(line)).toBe(
      [...'abcdefghijklmnop'].map((l) => `x-forwarded-${l}`).join(','),
    );
  });
});

describe('forwardingFields real-ip and forwarded', () => {
  // @traces 500-FR-014
  it('puts hops, headers, real-ip and forwarded in that order', () => {
    const line = forwardingFields({
      headers: {
        forwarded: 'for=1.2.3.4',
        'x-forwarded-for': '9.9.9.9',
        'x-real-ip': '5.6.7.8',
      },
      socket: SOCKET,
    });

    expect(line).toBe(
      `hops=9.9.x.x,${SOCKET_MASKED} headers=forwarded,x-forwarded-for,x-real-ip real-ip=5.6.x.x forwarded=1.2.x.x`,
    );
  });

  // @traces 500-FR-014
  it('lists every comma-separated x-real-ip entry masked', () => {
    const line = forwardingFields({
      headers: { 'x-real-ip': '86.125.92.213, 95.173.10.20, junk' },
      socket: SOCKET,
    });

    expect(line).toContain(' real-ip=86.125.x.x,95.173.x.x,unknown');
  });

  // @traces 500-FR-014
  it('keeps the rightmost 8 x-real-ip entries with a count', () => {
    const line = forwardingFields({
      headers: { 'x-real-ip': chain(11).join(',') },
      socket: SOCKET,
    });

    expect(line).toContain(` real-ip=${['+3', ...masked(4, 11)].join(',')}`);
  });

  // @traces 500-FR-014
  it('reads a forwarded for= with a port and no brackets', () => {
    const line = forwardingFields({
      headers: { forwarded: 'for=86.125.92.213:4711;proto=https;by=1.1.1.1' },
      socket: SOCKET,
    });

    expect(line).toContain(' forwarded=86.125.x.x');
    expect(line).not.toContain('1.1.x.x');
  });

  // @traces 500-FR-014
  it('reads one for= per element of a forwarded header', () => {
    const line = forwardingFields({
      headers: {
        forwarded:
          'for=86.125.1.2, for="[2a02:2f0c::1]:4711";proto=https, for=_hidden, for=unknown, by=1.1.1.1',
      },
      socket: SOCKET,
    });

    expect(line).toContain(
      ' forwarded=86.125.x.x,2a02:2f0c:x:x:x:x:x:x,unknown,unknown,unknown',
    );
  });

  // @traces 500-FR-014
  it('reads the for= name in any letter case', () => {
    const line = forwardingFields({
      headers: { forwarded: 'For=86.125.1.2' },
      socket: SOCKET,
    });

    expect(line).toContain(' forwarded=86.125.x.x');
  });

  // @traces 500-FR-014
  it('reads a forwarded header with no for= as unknown', () => {
    const line = forwardingFields({
      headers: { forwarded: 'proto=https;host=example.test' },
      socket: SOCKET,
    });

    expect(line).toContain(' forwarded=unknown');
  });

  // @traces 500-FR-014
  it('keeps the rightmost 8 forwarded elements with a count', () => {
    const forwarded = chain(10)
      .map((a) => `for=${a}`)
      .join(', ');

    const line = forwardingFields({ headers: { forwarded }, socket: SOCKET });

    expect(line).toContain(` forwarded=${['+2', ...masked(3, 10)].join(',')}`);
  });

  // @traces 500-FR-014
  it('adds no real-ip or forwarded token when neither header is present', () => {
    const line = forwardingFields({
      headers: { 'x-forwarded-for': '1.2.3.4' },
      socket: SOCKET,
    });

    expect(line).not.toMatch(/real-ip=|forwarded=/);
  });

  // @traces 500-FR-014
  it('masks a quoted obfuscated identifier and a quoted ipv4 alike', () => {
    const line = forwardingFields({
      headers: { forwarded: 'for="_gazonk", for="86.125.1.2:80"' },
      socket: SOCKET,
    });

    expect(line).toContain(' forwarded=unknown,86.125.x.x');
  });
});

const EMAIL = 'andrei@example.test';
const PASSWORD = 'secret-typo';

async function refusal(blocked: boolean, forwarding: Forwarding) {
  const lines: string[] = [];
  for (const level of ['log', 'warn', 'error', 'debug', 'verbose'] as const) {
    jest
      .spyOn(Logger.prototype, level)
      .mockImplementation((...args: unknown[]) => {
        lines.push(String(args[0]));
      });
  }
  const attempts = {
    blocked: jest.fn(async () => blocked),
    clear: jest.fn(async () => undefined),
    fail: jest.fn(async () => undefined),
  };
  const signIns = new SignInService(
    { account: { findUnique: async () => null } } as unknown as PrismaClient,
    { tokenSecret: 'test-secret' } as AuthOptions,
    { on: async () => false } as unknown as Maintenance,
    attempts as unknown as Attempts,
    {} as AuditPort,
    {} as EventPort,
    {} as LivePublisher,
  );
  const error = await signIns
    .signIn({ email: EMAIL, password: PASSWORD }, '203.0.113.9', forwarding)
    .catch((e: unknown) => e);
  return {
    code:
      error instanceof HttpException
        ? (error.getResponse() as { code: string }).code
        : error,
    lines,
  };
}

afterEach(() => jest.restoreAllMocks());

describe('a refused sign-in carries the forwarding facts', () => {
  const forwarding: Forwarding = {
    headers: {
      forwarded: 'for="[2a02:2f0c::1]:4711"',
      'x-forwarded-for': '86.125.92.213, 95.173.10.20',
      'x-forwarded-proto': 'https',
      'x-railway-edge': 'x',
      'x-real-ip': '86.125.92.213',
    },
    socket: SOCKET,
  };

  // @traces 500-FR-011
  it('on wrong credentials, after the caller, in order', async () => {
    const { code, lines } = await refusal(false, forwarding);

    expect(code).toBe('invalid_credentials');
    expect(lines).toEqual([
      'sign-in refused: invalid_credentials caller=203.0.x.x ' +
        `hops=86.125.x.x,95.173.x.x,${SOCKET_MASKED} ` +
        'headers=forwarded,x-forwarded-for,x-forwarded-proto,x-railway-edge,x-real-ip ' +
        'real-ip=86.125.x.x forwarded=2a02:2f0c:x:x:x:x:x:x',
    ]);
  });

  // @traces 500-FR-011
  it('on too many attempts, after the caller, in order', async () => {
    const { code, lines } = await refusal(true, forwarding);

    expect(code).toBe('too_many_attempts');
    expect(lines).toEqual([
      'sign-in refused: too_many_attempts caller=203.0.x.x ' +
        `hops=86.125.x.x,95.173.x.x,${SOCKET_MASKED} ` +
        'headers=forwarded,x-forwarded-for,x-forwarded-proto,x-railway-edge,x-real-ip ' +
        'real-ip=86.125.x.x forwarded=2a02:2f0c:x:x:x:x:x:x',
    ]);
  });

  // @traces 500-FR-011
  it('keeps the caller unchanged for a forged chain', async () => {
    const { lines } = await refusal(false, {
      headers: { 'x-forwarded-for': 'spoof, 1.2.3.4' },
      socket: '203.0.113.9',
    });

    expect(lines).toEqual([
      'sign-in refused: invalid_credentials caller=203.0.x.x ' +
        'hops=unknown,1.2.x.x,203.0.x.x headers=x-forwarded-for',
    ]);
  });

  // @traces 500-FR-011
  it('never writes the e-mail, password or a full address', async () => {
    const { lines } = await refusal(false, {
      headers: {
        forwarded: `for=${PASSWORD}`,
        'x-81.196.1.2-ip': 'x',
        'x-forwarded-for': `${EMAIL}, ${PASSWORD}, 86.125.92.213`,
        'x-real-ip': `${EMAIL}`,
      },
      socket: '203.0.113.9',
    });

    const all = lines.join('\n');
    expect(all).not.toMatch(/andrei|secret-typo|92\.213|113\.9|196\.1\.2/);
    expect(all).toContain('hops=unknown,unknown,86.125.x.x,203.0.x.x');
  });
});
