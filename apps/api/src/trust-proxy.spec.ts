import express, {
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import request from 'supertest';

import { trustProxy, trustsHop } from './trust-proxy';

// supertest always connects over loopback, so the socket the API was called on
// is stood in for by a header the test sets and the app reads before Express.
function appSeenFrom() {
  const app = express();
  app.set('trust proxy', trustProxy);
  app.use((req: Request, _res: Response, next: NextFunction) => {
    Object.defineProperty(req.socket, 'remoteAddress', {
      configurable: true,
      value: req.header('x-test-socket'),
    });
    next();
  });
  app.get('/ip', (req: Request, res: Response) => {
    res.json({ ip: req.ip });
  });
  return async (socket: string, forwarded?: string): Promise<string> => {
    const call = request(app).get('/ip').set('x-test-socket', socket);
    if (forwarded !== undefined) call.set('X-Forwarded-For', forwarded);
    return (await call).body.ip;
  };
}

const VISITOR = '86.125.92.213';
const POP = '95.173.1.1';
const WEB = 'fd12:e82::1';

describe('the caller behind Railway edge PoP, internal proxy and the web service', () => {
  const ip = appSeenFrom();

  // @traces 500-FR-016
  it('is the visitor for the real staging chain', async () => {
    expect(await ip(WEB, `${VISITOR}, ${POP}, 100.64.0.5`)).toBe(VISITOR);
  });

  // @traces 500-FR-016
  it('is the visitor behind a US PoP as well', async () => {
    expect(await ip(WEB, `${VISITOR}, 152.233.4.5, 100.64.0.5`)).toBe(VISITOR);
  });

  // @traces 500-FR-017
  it('stays the visitor when the client prepends a forged hop', async () => {
    expect(await ip(WEB, `203.0.113.77, ${VISITOR}, ${POP}, 100.64.0.5`)).toBe(
      VISITOR,
    );
  });

  // @traces 500-FR-017
  it('is the socket address on a direct hit with no proxy', async () => {
    expect(await ip('198.51.100.9')).toBe('198.51.100.9');
  });

  // @traces 500-FR-017
  it('trusts nothing when the socket is public, whatever the header says', async () => {
    expect(await ip('198.51.100.9', `${VISITOR}, ${POP}, 100.64.0.5`)).toBe(
      '198.51.100.9',
    );
    expect(await ip(POP, VISITOR)).toBe(POP);
  });

  // @traces 500-FR-017
  it('trusts only the nearest of two public hops before the private ones', async () => {
    expect(await ip(WEB, `${VISITOR}, 198.51.100.4, ${POP}, 100.64.0.5`)).toBe(
      '198.51.100.4',
    );
    expect(await ip(WEB, `9.9.9.9, 8.8.8.8, 100.64.0.5`)).toBe('9.9.9.9');
  });

  // @traces 500-FR-017
  it('trusts no hop past the trusted public one, a private one included', async () => {
    expect(await ip(WEB, `${VISITOR}, 10.0.0.1, ${POP}, 100.64.0.5`)).toBe(
      '10.0.0.1',
    );
  });

  // @traces 500-FR-017
  it('never trusts an entry that is not an address', async () => {
    expect(await ip(WEB, `${VISITOR}, not-an-ip, 100.64.0.5`)).toBe(
      'not-an-ip',
    );
  });

  // @traces 500-FR-016
  it('reads IPv4-mapped IPv6 sockets and hops as their IPv4 addresses', async () => {
    expect(await ip('::ffff:100.64.0.5', `${VISITOR}, ${POP}`)).toBe(VISITOR);
    expect(await ip(WEB, `${VISITOR}, ::ffff:${POP}, ::ffff:100.64.0.5`)).toBe(
      VISITOR,
    );
    expect(await ip('::ffff:198.51.100.9', `${VISITOR}, ${POP}`)).toBe(
      '::ffff:198.51.100.9',
    );
  });

  // @traces 500-FR-016
  it('is the leftmost hop when every hop is private', async () => {
    expect(await ip(WEB, '10.0.0.1, 192.168.1.1, 100.64.0.5')).toBe('10.0.0.1');
  });
});

describe('trustsHop', () => {
  // @traces 500-FR-016
  it('trusts loopback, link-local, private, CGNAT and ULA hops before a public one', () => {
    for (const addr of [
      '127.0.0.1',
      '::1',
      '169.254.1.1',
      'fe80::1',
      '10.1.2.3',
      '172.16.0.1',
      '192.168.0.1',
      '100.64.0.0',
      '100.127.255.255',
      'fc00::1',
      'fd12:e82::1',
      '::ffff:10.1.2.3',
    ]) {
      expect(trustsHop(addr, 0, false)).toBe(true);
      expect(trustsHop(addr, 3, false)).toBe(true);
      expect(trustsHop(addr, 3, true)).toBe(false);
    }
  });

  // @traces 500-FR-017
  it('trusts one public hop, only right after a private one', () => {
    expect(trustsHop(POP, 1, false)).toBe(true);
    expect(trustsHop(POP, 0, false)).toBe(false);
    expect(trustsHop(POP, 2, true)).toBe(false);
    expect(trustsHop('100.63.255.255', 1, false)).toBe(true);
    expect(trustsHop('100.128.0.0', 0, false)).toBe(false);
  });

  // @traces 500-FR-017
  it('never trusts an entry that is not an address', () => {
    for (const addr of ['', 'not-an-ip', '100.64.1.2:8080', '100.64.1.2/10']) {
      expect(trustsHop(addr, 0, false)).toBe(false);
      expect(trustsHop(addr, 1, false)).toBe(false);
    }
  });
});

describe('trustProxy', () => {
  // @traces 500-FR-017
  it('refuses a hop called out of order', () => {
    expect(trustProxy('fd12::1', 0)).toBe(true);
    expect(trustProxy('100.64.0.5', 2)).toBe(false);
    expect(trustProxy('100.64.0.5', 1)).toBe(false);
  });

  // @traces 500-FR-017
  it('starts each walk afresh at the socket', () => {
    expect(trustProxy('fd12::1', 0)).toBe(true);
    expect(trustProxy(POP, 1)).toBe(true);
    expect(trustProxy('10.0.0.1', 2)).toBe(false);
    expect(trustProxy('fd12::1', 0)).toBe(true);
    expect(trustProxy('10.0.0.1', 1)).toBe(true);
    expect(trustProxy(POP, 2)).toBe(true);
  });
});
