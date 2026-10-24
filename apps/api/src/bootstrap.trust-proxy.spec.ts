import express, {
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import request from 'supertest';

import { TRUSTED_PROXIES } from './bootstrap';

// supertest always connects over loopback, so the hop that reached the API is
// stood in for by a header the test sets and the app reads before Express does.
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
  return async (socket: string, forwarded: string) =>
    (
      await request(app)
        .get('/ip')
        .set('x-test-socket', socket)
        .set('X-Forwarded-For', forwarded)
    ).body.ip;
}

describe('the caller address behind Railway and the web edge', () => {
  const ip = appSeenFrom();

  // @traces 500-FR-008
  it('is the visitor when the web edge forwards a chain ending at Railway', async () => {
    expect(await ip('fd12::1', '86.125.92.213, 100.64.1.2')).toBe(
      '86.125.92.213',
    );
  });

  // @traces 500-FR-008
  it('is the visitor when Railway calls the API itself', async () => {
    expect(await ip('100.64.1.2', '86.125.92.213')).toBe('86.125.92.213');
  });

  // @traces 500-FR-009
  it('stays the visitor when the visitor forges an earlier hop', async () => {
    expect(await ip('fd12::1', '1.2.3.4, 86.125.92.213, 100.64.1.2')).toBe(
      '86.125.92.213',
    );
  });

  // @traces 500-FR-009
  it('does not trust an address just outside Railway', async () => {
    expect(await ip('fd12::1', '86.125.92.213, 100.128.0.1')).toBe(
      '100.128.0.1',
    );
  });

  // @traces 500-FR-010
  it('is the socket address when a public caller forges the header', async () => {
    expect(await ip('203.0.113.7', '86.125.92.213, 100.64.1.2')).toBe(
      '203.0.113.7',
    );
  });
});
