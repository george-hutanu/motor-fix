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
let urls: string[];
let methods: string[];

beforeAll(async () => {
  server = createServer((req, res) => {
    urls.push(req.url ?? '');
    methods.push(req.method ?? '');
    req.resume();
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
  urls = [];
  methods = [];
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

// @traces 1390-FR-002
describe('closing a live input against hostile answers', () => {
  it.each([
    ['a string "false"', { result: { enabled: 'false' }, success: true }],
    ['null', { result: { enabled: null }, success: true }],
    ['0', { result: { enabled: 0 }, success: true }],
    ['a missing field', { result: {}, success: true }],
    ['a result that is a string', { result: 'x', success: true }],
    ['a result that is an array', { result: [], success: true }],
  ])('throws still_enabled when result.enabled is %s', async (_n, body) => {
    answer = json(200, body);

    await expect(cloudflare().closeInput('i1')).rejects.toThrow(
      new Error('live input close failed: still_enabled'),
    );
  });

  it.each([
    ['an array', '[]'],
    ['null', 'null'],
    ['a number', '42'],
    ['an empty body', ''],
  ])('throws on a 200 answer whose body is %s', async (_n, body) => {
    answer = json(200, body);

    await expect(cloudflare().closeInput('i1')).rejects.toThrow(
      /^live input close failed: (malformed|still_enabled)$/,
    );
  });

  it.each([401, 403, 429, 500, 502, 503])(
    'throws with the status token on %i',
    async (status) => {
      answer = json(status, { success: false });

      await expect(cloudflare().closeInput('i1')).rejects.toThrow(
        new Error(`live input close failed: ${status}`),
      );
    },
  );

  it('throws network when the connection is dropped', async () => {
    answer = (req) => req.socket.destroy();

    await expect(cloudflare().closeInput('i1')).rejects.toThrow(
      new Error('live input close failed: network'),
    );
  });

  it('throws network when nothing listens on the address', async () => {
    const dead = new CloudflareLiveVideo(secrets, 'http://127.0.0.1:1');

    await expect(dead.closeInput('i1')).rejects.toThrow(
      new Error('live input close failed: network'),
    );
  });

  it('keeps an input id with slashes and a query inside one path segment', async () => {
    answer = json(200, { result: { enabled: false }, success: true });

    await cloudflare().closeInput('a/../b?x=1#f');

    expect(urls).toEqual([
      '/accounts/acct-1/stream/live_inputs/a%2F..%2Fb%3Fx%3D1%23f',
    ]);
  });

  it('does not follow a redirect to another host', async () => {
    let hits = 0;
    const other = createServer((_req, res) => {
      hits += 1;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ result: { enabled: false }, success: true }));
    });
    await new Promise<void>((done) => other.listen(0, '127.0.0.1', done));
    const otherPort = (other.address() as AddressInfo).port;
    answer = (_req, res) => {
      res.writeHead(307, { location: `http://127.0.0.1:${otherPort}/x` });
      res.end();
    };

    try {
      await expect(cloudflare().closeInput('i1')).rejects.toThrow(
        /^live input close failed: /,
      );
      expect(hits).toBe(0);
    } finally {
      other.closeAllConnections();
      await new Promise((done) => other.close(done));
    }
  });

  it('never puts the token or the provider message in the thrown error', async () => {
    answer = json(500, { errors: [{ message: 'secret-api-token leaked' }] });

    const error = await cloudflare()
      .closeInput('i1')
      .catch((e: Error) => e);

    expect((error as Error).message).toBe('live input close failed: 500');
  });

  it('sends exactly one PUT and no delete for a close', async () => {
    answer = json(200, { result: { enabled: false }, success: true });

    await cloudflare().closeInput('i1');

    expect(methods).toEqual(['PUT']);
  });

  it('closes the same input twice with the same outcome', async () => {
    answer = json(200, { result: { enabled: false }, success: true });
    const provider = cloudflare();

    await provider.closeInput('i1');
    await expect(provider.closeInput('i1')).resolves.toBeUndefined();
    expect(methods).toEqual(['PUT', 'PUT']);
  });

  it('treats a 404 with a non-JSON body as closed', async () => {
    answer = json(404, '<html>not found</html>');

    await expect(cloudflare().closeInput('i1')).resolves.toBeUndefined();
  });
});
