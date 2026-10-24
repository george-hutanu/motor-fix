import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';

import express, {
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import request from 'supertest';

import { trustProxy, trustsHop } from './trust-proxy';

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
  return async (
    socket: string,
    forwarded: string | string[],
    extra: Record<string, string> = {},
  ): Promise<string> => {
    const lines = Array.isArray(forwarded) ? forwarded : [forwarded];
    if (lines.length === 1) {
      let call = request(app)
        .get('/ip')
        .set('x-test-socket', socket)
        .set('X-Forwarded-For', lines[0]);
      for (const [name, value] of Object.entries(extra)) {
        call = call.set(name, value);
      }
      return (await call).body.ip;
    }
    const server = app.listen(0);
    try {
      const { port } = server.address() as AddressInfo;
      return await new Promise<string>((resolve, reject) => {
        const req = httpRequest(
          {
            headers: { 'x-forwarded-for': lines, 'x-test-socket': socket },
            path: '/ip',
            port,
          },
          (res) => {
            let body = '';
            res.on('data', (c) => {
              body += c;
            });
            res.on('end', () => resolve(JSON.parse(body).ip));
          },
        );
        req.on('error', reject);
        req.end();
      });
    } finally {
      server.close();
    }
  };
}

const VISITOR = '86.125.92.213';
const POP = '95.173.1.1';
const RAILWAY = '100.64.0.5';
const WEB = 'fd12:e82::1';

describe('trustsHop, attacked', () => {
  // @traces 500-FR-017
  it('trusts nothing once a public hop has been trusted, whatever it is', () => {
    for (const addr of [
      '127.0.0.1',
      '::1',
      '10.0.0.1',
      '100.64.0.5',
      'fd12::1',
      '8.8.8.8',
      '2a02:2f0c::1',
    ]) {
      expect(trustsHop(addr, 3, true)).toBe(false);
    }
  });

  // @traces 500-FR-017
  it('trusts no public address at the socket position', () => {
    expect(trustsHop('8.8.8.8', 0, false)).toBe(false);
    expect(trustsHop('2a02:2f0c::1', 0, false)).toBe(false);
    expect(trustsHop('::ffff:8.8.8.8', 0, false)).toBe(false);
  });

  // @traces 500-FR-016
  it('trusts a public IPv6 or IPv4-mapped hop as the one PoP after the socket', () => {
    expect(trustsHop('2a02:2f0c::1', 1, false)).toBe(true);
    expect(trustsHop('::ffff:95.173.1.1', 2, false)).toBe(true);
  });

  // @traces 500-FR-016
  it('trusts the private ranges at both edges and refuses the addresses just outside them', () => {
    const inside = [
      '10.255.255.255',
      '172.16.0.0',
      '172.31.255.255',
      '192.168.255.255',
      '169.254.1.1',
      'fc00::1',
      'fdff:ffff::1',
      'FD12:E82::1',
      'fe80::1',
    ];
    for (const addr of inside) expect(trustsHop(addr, 1, true)).toBe(false);
    for (const addr of inside) expect(trustsHop(addr, 1, false)).toBe(true);
    const outside = ['172.15.255.255', '172.32.0.0', '192.169.0.1', 'fbff::1'];
    for (const addr of outside) {
      expect(trustsHop(addr, 0, false)).toBe(false);
    }
  });

  // @traces 500-FR-017
  it.each([
    '',
    ' ',
    'not-an-ip',
    '100.64.1.2:8080',
    '100.64.1.2/10',
    '[fd12::1]',
    '0x7f.0.0.1',
    '2130706433',
    '10.1',
    '10.0.0.1\n',
    '10.0.0.1, 8.8.8.8',
    'localhost',
  ])('never trusts the non-address %j at any position', (addr) => {
    expect(trustsHop(addr, 0, false)).toBe(false);
    expect(trustsHop(addr, 2, false)).toBe(false);
    expect(trustsHop(addr, 2, true)).toBe(false);
  });

  // @traces 500-FR-017
  it('does not trust a non-address that only starts like a trusted range', () => {
    expect(trustsHop('127.0.0.1.evil.example', 1, false)).toBe(false);
    expect(trustsHop('fd12::1/8', 1, false)).toBe(false);
  });
});

describe('trustProxy, attacked', () => {
  // @traces 500-FR-017
  it('refuses calls with an index that is negative, fractional or not a number', () => {
    expect(trustProxy('10.0.0.1', -1)).toBe(false);
    expect(trustProxy('10.0.0.1', 0.5)).toBe(false);
    expect(trustProxy('10.0.0.1', Number.NaN)).toBe(false);
    expect(trustProxy('10.0.0.1', Number.POSITIVE_INFINITY)).toBe(false);
  });

  // @traces 500-FR-017
  it('forgets a walk that ended on a refusal when the next one starts at the socket', () => {
    expect(trustProxy('10.0.0.1', 0)).toBe(true);
    expect(trustProxy('8.8.8.8', 1)).toBe(true);
    expect(trustProxy('1.1.1.1', 2)).toBe(false);
    expect(trustProxy('8.8.8.8', 0)).toBe(false);
    expect(trustProxy('10.0.0.1', 0)).toBe(true);
    expect(trustProxy('8.8.8.8', 1)).toBe(true);
  });

  // @traces 500-FR-017
  it('does not carry a public hop of an abandoned walk into the next one', () => {
    expect(trustProxy('10.0.0.1', 0)).toBe(true);
    expect(trustProxy('8.8.8.8', 1)).toBe(true);
    expect(trustProxy('10.0.0.1', 0)).toBe(true);
    expect(trustProxy('8.8.8.8', 1)).toBe(true);
    expect(trustProxy('1.1.1.1', 2)).toBe(false);
  });

  // @traces 500-FR-017
  it('refuses a repeated index within one walk', () => {
    expect(trustProxy('10.0.0.1', 0)).toBe(true);
    expect(trustProxy('10.0.0.1', 0)).toBe(true);
    expect(trustProxy('10.0.0.1', 2)).toBe(false);
  });

  // @traces 500-FR-017
  it('refuses an index that skips ahead of the walk', () => {
    expect(trustProxy('10.0.0.1', 5)).toBe(false);
    expect(trustProxy('10.0.0.1', 0)).toBe(true);
    expect(trustProxy('10.0.0.1', 2)).toBe(false);
  });
});

describe('the caller behind Railway, from outside', () => {
  const ip = appSeenFrom();

  // @traces 500-FR-016
  it('resolves the staging chain', async () => {
    expect(await ip(WEB, `${VISITOR}, ${POP}, ${RAILWAY}`)).toBe(VISITOR);
  });

  // @traces 500-FR-016
  it('resolves the visitor when the chain is split over several header lines', async () => {
    expect(await ip(WEB, [VISITOR, `${POP}, ${RAILWAY}`])).toBe(VISITOR);
  });

  // @traces 500-FR-017
  it('resolves the visitor when a forged line comes before the real chain in another header line', async () => {
    expect(
      await ip(WEB, ['203.0.113.77', `${VISITOR}, ${POP}, ${RAILWAY}`]),
    ).toBe(VISITOR);
  });

  // @traces 500-FR-017
  it('resolves the visitor when the forged prefix is a private or loopback address', async () => {
    expect(await ip(WEB, `127.0.0.1, ${VISITOR}, ${POP}, ${RAILWAY}`)).toBe(
      VISITOR,
    );
    expect(await ip(WEB, `10.0.0.1, ${VISITOR}, ${POP}, ${RAILWAY}`)).toBe(
      VISITOR,
    );
  });

  // @traces 500-FR-017
  it('resolves the second public hop when the forged prefix is many public addresses', async () => {
    const forged = Array.from({ length: 50 }, (_, n) => `203.0.113.${n}`);
    expect(
      await ip(WEB, `${forged.join(', ')}, ${VISITOR}, ${POP}, ${RAILWAY}`),
    ).toBe(VISITOR);
  });

  // @traces 500-FR-017
  it('reads no header other than X-Forwarded-For', async () => {
    const chain = `${VISITOR}, ${POP}, ${RAILWAY}`;
    expect(
      await ip(WEB, chain, {
        'CF-Connecting-IP': '203.0.113.9',
        Forwarded: 'for=203.0.113.9',
        'True-Client-IP': '203.0.113.9',
        'X-Client-IP': '203.0.113.9',
        'X-Real-IP': '203.0.113.9',
      }),
    ).toBe(VISITOR);
  });

  // @traces 500-FR-017
  it('is the socket address when only X-Real-IP is sent through trusted hops', async () => {
    const res = await request(
      (() => {
        const app = express();
        app.set('trust proxy', trustProxy);
        app.use((req: Request, _res: Response, next: NextFunction) => {
          Object.defineProperty(req.socket, 'remoteAddress', {
            configurable: true,
            value: WEB,
          });
          next();
        });
        app.get('/ip', (req: Request, res: Response) => {
          res.json({ ip: req.ip });
        });
        return app;
      })(),
    )
      .get('/ip')
      .set('X-Real-IP', '203.0.113.9');
    expect(res.body.ip).toBe(WEB);
  });

  // @traces 500-FR-017
  it('is the socket address from a public socket whatever the chain says', async () => {
    expect(await ip('203.0.113.7', `${VISITOR}, ${POP}, ${RAILWAY}`)).toBe(
      '203.0.113.7',
    );
    expect(await ip('2a02:2f0c::7', `${VISITOR}, ${RAILWAY}`)).toBe(
      '2a02:2f0c::7',
    );
  });

  // @traces 500-FR-016
  it('is the PoP-side hop only as the nearest public one when two public hops are the whole header', async () => {
    expect(await ip(WEB, `1.1.1.1, 8.8.8.8`)).toBe('1.1.1.1');
  });

  // @traces 500-FR-016
  it('resolves a single public hop with no PoP in front of the private ones', async () => {
    expect(await ip(WEB, `${VISITOR}, ${RAILWAY}`)).toBe(VISITOR);
  });

  // @traces 500-FR-016
  it('resolves the visitor when the PoP and the private hops are IPv6 or mapped, in any letter case', async () => {
    expect(
      await ip(
        '::ffff:10.0.0.1',
        `${VISITOR}, ::ffff:95.173.1.1, ::ffff:100.64.0.5`,
      ),
    ).toBe(VISITOR);
    expect(await ip('FD12:E82::1', `${VISITOR}, 2A02:2F0C::1, FD00::5`)).toBe(
      VISITOR,
    );
    expect(await ip(WEB, `${VISITOR}, ${POP}, 0:0:0:0:0:ffff:100.64.0.5`)).toBe(
      VISITOR,
    );
    expect(await ip(WEB, `${VISITOR}, ${POP}, ::ffff:6440:5`)).toBe(VISITOR);
  });

  // @traces 500-FR-016
  it('resolves a visitor with an IPv6 address behind the PoP', async () => {
    expect(await ip(WEB, `2a02:2f0c:1::9, ${POP}, ${RAILWAY}`)).toBe(
      '2a02:2f0c:1::9',
    );
  });

  // @traces 500-FR-017
  it('trims spaces around entries without trusting more', async () => {
    expect(await ip(WEB, `1.2.3.4,  ${VISITOR} ,   ${POP}  ,${RAILWAY}`)).toBe(
      VISITOR,
    );
  });

  // @traces 500-FR-017
  it('never lets a forged hop win past a tab-padded entry', async () => {
    expect(await ip(WEB, `1.2.3.4, ${VISITOR}, ${POP}\t, ${RAILWAY}`)).not.toBe(
      '1.2.3.4',
    );
  });

  // @traces 500-FR-017
  it('stops at a hop with an IPv6 zone id instead of walking past it', async () => {
    expect(await ip(WEB, `1.2.3.4, ${VISITOR}, ${POP}, fe80::1%eth0`)).not.toBe(
      '1.2.3.4',
    );
  });

  // @traces 500-FR-017
  it('stops at a numeric-looking non-address like a decimal or hex IPv4', async () => {
    expect(await ip(WEB, `1.2.3.4, 2130706433, ${RAILWAY}`)).toBe('2130706433');
    expect(await ip(WEB, `1.2.3.4, 0x7f.0.0.1, ${RAILWAY}`)).toBe('0x7f.0.0.1');
  });

  // @traces 500-FR-017
  it('resolves the same answer on a repeated and a reversed order of calls', async () => {
    const chain = `203.0.113.77, ${VISITOR}, ${POP}, ${RAILWAY}`;
    const first = await ip(WEB, chain);
    const direct = await ip('203.0.113.7', chain);
    const second = await ip(WEB, chain);
    expect([first, direct, second]).toEqual([VISITOR, '203.0.113.7', VISITOR]);
  });

  // @traces 500-FR-017
  it('resolves concurrent requests without one walk leaking into another', async () => {
    const chain = `203.0.113.77, ${VISITOR}, ${POP}, ${RAILWAY}`;
    const results = await Promise.all(
      Array.from({ length: 40 }, (_, n) =>
        n % 2 === 0 ? ip(WEB, chain) : ip('203.0.113.7', chain),
      ),
    );
    expect(results).toEqual(
      Array.from({ length: 40 }, (_, n) =>
        n % 2 === 0 ? VISITOR : '203.0.113.7',
      ),
    );
  });

  // @traces 500-FR-017
  it('resolves a thousand-hop private chain to its leftmost hop', async () => {
    const hops = Array.from({ length: 1000 }, () => '10.0.0.1').join(', ');
    expect(await ip(WEB, `${VISITOR}, ${hops}`)).toMatch(
      /^(86\.125\.92\.213|10\.0\.0\.1)$/,
    );
  });

  // @traces 500-FR-017
  it('is the socket address with no header at all from a trusted socket', async () => {
    expect(await ip(WEB, '')).toBe(WEB);
  });

  // @traces 500-FR-017
  it('is the public hop next to the socket when the chain has an address that is public only by being unspecified', async () => {
    expect(await ip(WEB, `1.2.3.4, 0.0.0.0, ${RAILWAY}`)).toBe('1.2.3.4');
  });
});
