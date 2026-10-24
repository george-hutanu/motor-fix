import express, {
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import request from 'supertest';

import { TRUSTED_PROXIES } from './bootstrap';

function appSeenFrom() {
  const app = express();
  app.set('trust proxy', TRUSTED_PROXIES);
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
  return async (socket: string, forwarded: string): Promise<string> =>
    (
      await request(app)
        .get('/ip')
        .set('x-test-socket', socket)
        .set('X-Forwarded-For', forwarded)
    ).body.ip;
}

const VISITOR = '86.125.92.213';

describe('the caller address behind Railway, attacked', () => {
  const ip = appSeenFrom();

  // @traces 500-FR-008
  it('trusts the first and last addresses of the Railway range', async () => {
    expect(await ip('fd12::1', `${VISITOR}, 100.64.0.0`)).toBe(VISITOR);
    expect(await ip('fd12::1', `${VISITOR}, 100.127.255.255`)).toBe(VISITOR);
  });

  // @traces 500-FR-009
  it('does not trust the address just below the Railway range', async () => {
    expect(await ip('fd12::1', `${VISITOR}, 100.63.255.255`)).toBe(
      '100.63.255.255',
    );
  });

  // @traces 500-FR-009
  it('does not trust the address just above the Railway range', async () => {
    expect(await ip('fd12::1', `${VISITOR}, 100.128.0.0`)).toBe('100.128.0.0');
  });

  // @traces 500-FR-010
  it('is the socket address when the socket sits just outside the Railway range', async () => {
    expect(await ip('100.63.255.255', `${VISITOR}`)).toBe('100.63.255.255');
    expect(await ip('100.128.0.0', `${VISITOR}`)).toBe('100.128.0.0');
  });

  // @traces 500-FR-008
  it('trusts a Railway socket written as an IPv4-mapped IPv6 address', async () => {
    expect(await ip('::ffff:100.64.1.2', VISITOR)).toBe(VISITOR);
  });

  // @traces 500-FR-008
  it('trusts a Railway hop in the chain written as an IPv4-mapped IPv6 address', async () => {
    expect(await ip('fd12::1', `${VISITOR}, ::ffff:100.64.1.2`)).toBe(VISITOR);
  });

  // @traces 500-FR-009
  it('does not trust an IPv4-mapped address outside the Railway range', async () => {
    expect(await ip('fd12::1', `${VISITOR}, ::ffff:100.128.0.1`)).toMatch(
      /100\.128\.0\.1$/,
    );
  });

  // @traces 500-FR-010
  it('is the socket address when a public socket is written as an IPv4-mapped IPv6 address', async () => {
    expect(await ip('::ffff:203.0.113.7', `${VISITOR}, 100.64.1.2`)).toMatch(
      /203\.0\.113\.7$/,
    );
  });

  // @traces 500-FR-009
  it('stops at a public address between trusted hops', async () => {
    expect(
      await ip('fd12::1', `1.2.3.4, ${VISITOR}, 8.8.8.8, 100.64.1.2`),
    ).toBe('8.8.8.8');
  });

  // @traces 500-FR-009
  it('never trusts a public address even when it is repeated through the chain', async () => {
    expect(await ip('fd12::1', '8.8.8.8, 8.8.8.8, 100.64.1.2')).toBe('8.8.8.8');
  });

  // @traces 500-FR-008
  it('is the leftmost hop when every hop in the chain is trusted', async () => {
    expect(
      await ip('fd12::1', '100.64.1.2, 100.64.9.9, 10.0.0.1, fe80::1'),
    ).toBe('100.64.1.2');
  });

  // @traces 500-FR-009
  it('does not let a garbage entry hide a forged earlier hop', async () => {
    expect(
      await ip('fd12::1', `1.2.3.4, ${VISITOR}, not-an-ip, 100.64.1.2`),
    ).toBe('not-an-ip');
  });

  // @traces 500-FR-009
  it('ignores an empty entry between a public hop and a trusted hop', async () => {
    expect(await ip('fd12::1', `9.9.9.9, 1.2.3.4, , 100.64.1.2`)).toBe(
      '1.2.3.4',
    );
  });

  // @traces 500-FR-009
  it('does not resolve to an earlier hop past an entry with an injected port', async () => {
    expect(
      await ip('fd12::1', `1.2.3.4, 100.64.1.2:8080, 100.64.1.2`),
    ).not.toBe('1.2.3.4');
  });

  // @traces 500-FR-009
  it('does not trust a Railway-looking address with trailing junk', async () => {
    expect(await ip('fd12::1', `${VISITOR}, 100.64.1.2/10`)).not.toBe(VISITOR);
  });

  // @traces 500-FR-010
  it('is the socket address when a public socket sends only the header of a Railway hop', async () => {
    expect(await ip('198.51.100.9', '100.64.1.2')).toBe('198.51.100.9');
  });

  // @traces 500-FR-010
  it('is the socket address when a public socket sends an empty header', async () => {
    expect(await ip('198.51.100.9', '')).toBe('198.51.100.9');
  });

  // @traces 500-FR-009
  it('resolves the visitor through a long chain of trusted hops', async () => {
    const hops = Array.from({ length: 900 }, () => '100.64.1.2').join(', ');
    expect(await ip('fd12::1', `1.2.3.4, ${VISITOR}, ${hops}`)).toBe(VISITOR);
  });

  // @traces 500-FR-009
  it('stops at a public address buried under a long chain of trusted hops', async () => {
    const hops = Array.from({ length: 600 }, () => '100.64.1.2').join(', ');
    expect(await ip('fd12::1', `${hops}, 8.8.8.8, ${hops}`)).toBe('8.8.8.8');
  });
});
