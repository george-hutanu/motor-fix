import { generateKeyPairSync } from 'node:crypto';
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';

import { Logger } from '@nestjs/common';

import { CloudflareLiveVideo } from './cloudflare-live-video.provider';

const pem = generateKeyPairSync('rsa', { modulusLength: 2048 })
  .privateKey.export({ format: 'pem', type: 'pkcs8' })
  .toString();
const secrets = {
  CLOUDFLARE_STREAM_ACCOUNT_ID: 'acct-1',
  CLOUDFLARE_STREAM_API_TOKEN: 'secret-api-token',
  CLOUDFLARE_STREAM_CUSTOMER_CODE: 'abc123',
  CLOUDFLARE_STREAM_SIGNING_KEY_ID: 'kid-1',
  CLOUDFLARE_STREAM_SIGNING_KEY_PEM: Buffer.from(pem).toString('base64'),
};

type Answer = (req: IncomingMessage, res: ServerResponse) => void;
let server: Server;
let port: number;
let answer: Answer;
let calls: string[];

beforeAll(async () => {
  server = createServer((req, res) => {
    calls.push(`${req.method} ${req.url}`);
    req.on('data', () => undefined);
    req.on('end', () => answer(req, res));
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  port = (server.address() as AddressInfo).port;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise((done) => server.close(done));
});
beforeEach(() => {
  calls = [];
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

const json =
  (status: number, body: unknown): Answer =>
  (_req, res) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(typeof body === 'string' ? body : JSON.stringify(body));
  };
const cloudflare = () =>
  new CloudflareLiveVideo(secrets, `http://127.0.0.1:${port}`);
const listing = (...uids: unknown[]): Answer =>
  json(200, { result: uids.map((uid) => ({ uid })), success: true });

// @traces 1251-FR-001
describe('deleting a live input’s recordings against hostile answers', () => {
  it('keeps an input id with slashes and a query inside one path segment', async () => {
    answer = listing();

    await cloudflare().deleteRecording('../../other?x=1#frag');

    expect(calls).toHaveLength(1);
    expect(calls[0]).not.toContain('?x=1');
    expect(calls[0]).not.toMatch(/\/\.\.\//);
    expect(calls[0]).toMatch(/^GET \/accounts\/acct-1\/stream\/live_inputs\//);
  });

  it('keeps a hostile video uid inside its own path segment', async () => {
    answer = (req, res) =>
      req.method === 'GET'
        ? listing('../../live_inputs/x?y=1')(req, res)
        : json(200, { success: true })(req, res);

    await cloudflare().deleteRecording('in1');

    const del = calls.find((c) => c.startsWith('DELETE')) ?? '';
    expect(del).not.toContain('?y=1');
    expect(del).not.toMatch(/\/\.\.\//);
  });

  it('deletes every one of five hundred videos', async () => {
    const uids = Array.from({ length: 500 }, (_, i) => `v${i}`);
    answer = (req, res) =>
      req.method === 'GET'
        ? listing(...uids)(req, res)
        : json(200, { success: true })(req, res);

    await cloudflare().deleteRecording('in1');

    expect(calls.filter((c) => c.startsWith('DELETE'))).toHaveLength(500);
  }, 30_000);

  it.each([
    ['an html 200', '<html>maintenance</html>'],
    [
      'a result that is a string',
      JSON.stringify({ result: 'x', success: true }),
    ],
    [
      'a result that is an object',
      JSON.stringify({ result: {}, success: true }),
    ],
    ['success false', JSON.stringify({ result: [], success: false })],
  ])(
    'throws on %s for the list rather than reporting deleted',
    async (_n, body) => {
      answer = json(200, body);

      await expect(cloudflare().deleteRecording('in1')).rejects.toThrow(
        /recording delete failed/,
      );
    },
  );

  it.each([
    ['a numeric uid', 7],
    ['an empty uid', ''],
    ['a null uid', null],
  ])('does not delete a video with %s', async (_n, uid) => {
    answer = (req, res) =>
      req.method === 'GET'
        ? listing(uid)(req, res)
        : json(200, { success: true })(req, res);

    await cloudflare()
      .deleteRecording('in1')
      .catch(() => undefined);

    expect(calls.filter((c) => c.startsWith('DELETE'))).toEqual([]);
  });

  it.each([401, 403, 429, 500])(
    'throws on a %s list and never leaks the token',
    async (status) => {
      answer = json(status, { errors: [{ message: 'secret-api-token' }] });

      const error = await cloudflare()
        .deleteRecording('in1')
        .catch((e: Error) => e);

      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toMatch(/^recording delete failed/);
      expect((error as Error).message).not.toContain('secret-api-token');
    },
  );

  it('gives up on a list that hangs after five seconds', async () => {
    answer = () => undefined;
    const started = Date.now();

    await expect(cloudflare().deleteRecording('in1')).rejects.toBeInstanceOf(
      Error,
    );

    expect(Date.now() - started).toBeGreaterThanOrEqual(4900);
    expect(Date.now() - started).toBeLessThan(7000);
  }, 10_000);

  it('gives up on a delete that hangs after five seconds', async () => {
    answer = (req, res) =>
      req.method === 'GET' ? listing('v1')(req, res) : undefined;
    const started = Date.now();

    await expect(cloudflare().deleteRecording('in1')).rejects.toBeInstanceOf(
      Error,
    );

    expect(Date.now() - started).toBeLessThan(7000);
  }, 10_000);

  it('does not follow a redirect to another host with the api token', async () => {
    let leaked: string | undefined;
    const other = createServer((req, res) => {
      leaked = req.headers.authorization;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"result":[],"success":true}');
    });
    await new Promise<void>((done) => other.listen(0, '127.0.0.1', done));
    const target = `http://127.0.0.1:${(other.address() as AddressInfo).port}/x`;
    answer = (_req, res) => {
      res.writeHead(302, { location: target });
      res.end();
    };
    try {
      await cloudflare()
        .deleteRecording('in1')
        .catch(() => undefined);
      expect(leaked).toBeUndefined();
    } finally {
      other.closeAllConnections();
      await new Promise((done) => other.close(done));
    }
  });
});
