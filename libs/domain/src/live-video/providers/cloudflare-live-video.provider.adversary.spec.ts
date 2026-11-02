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
let auths: (string | undefined)[];
let bodies: string[];

beforeAll(async () => {
  server = createServer((req, res) => {
    urls.push(req.url ?? '');
    auths.push(req.headers.authorization);
    let text = '';
    req.on('data', (c) => (text += c));
    req.on('end', () => {
      bodies.push(text);
      answer(req, res);
    });
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
  auths = [];
  bodies = [];
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

// @traces 1250-FR-001 1250-FR-005
describe('the Cloudflare adapter against hostile answers', () => {
  it.each([
    ['an array body', '[]'],
    ['a null body', 'null'],
    ['a number body', '42'],
    ['an empty body', ''],
    [
      'a result that is a string',
      JSON.stringify({ result: 'x', success: true }),
    ],
    [
      'an input id that is a number',
      JSON.stringify({
        result: { uid: 7, webRTC: { url: 'https://x/y' } },
        success: true,
      }),
    ],
    [
      'an input id that is empty',
      JSON.stringify({
        result: { uid: '', webRTC: { url: 'https://x/y' } },
        success: true,
      }),
    ],
    [
      'a publish address that is empty',
      JSON.stringify({
        result: { uid: 'u1', webRTC: { url: '' } },
        success: true,
      }),
    ],
    [
      'a result with no publish address',
      JSON.stringify({ result: { uid: 'u1' }, success: true }),
    ],
  ])('reports %s as malformed', async (_name, body) => {
    answer = json(200, body);

    expect(await cloudflare().createInput({ id: 's1' })).toEqual({
      unavailable: 'malformed',
    });
  });

  it('reports a publish address that is not https as malformed', async () => {
    answer = json(200, {
      result: { uid: 'u1', webRTC: { url: 'javascript:alert(1)' } },
      success: true,
    });

    expect(await cloudflare().createInput({ id: 's1' })).toEqual({
      unavailable: 'malformed',
    });
  });

  it('reports a ten-megabyte body without throwing', async () => {
    answer = json(200, 'x'.repeat(10 * 1024 * 1024));

    const input = await cloudflare().createInput({ id: 's1' });

    expect(input).toEqual({ unavailable: 'malformed' });
  }, 15_000);

  it('does not follow a redirect to another host with the api token', async () => {
    const seenOther: (string | undefined)[] = [];
    const other = createServer((req, res) => {
      seenOther.push(req.headers.authorization);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          result: { uid: 'evil', webRTC: { url: 'https://evil/x' } },
          success: true,
        }),
      );
    });
    await new Promise<void>((done) => other.listen(0, '127.0.0.1', done));
    const otherPort = (other.address() as AddressInfo).port;
    answer = (_req, res) => {
      res.writeHead(302, { location: `http://localhost:${otherPort}/steal` });
      res.end();
    };

    try {
      const input = await cloudflare().createInput({ id: 's1' });

      expect(seenOther.filter(Boolean)).toEqual([]);
      expect(input).toEqual({ unavailable: '302' });
    } finally {
      other.closeAllConnections();
      await new Promise((done) => other.close(done));
    }
  });

  it('gives up on a close that hangs after five seconds', async () => {
    answer = () => undefined;
    const started = Date.now();

    await expect(cloudflare().closeInput('u1')).rejects.toBeInstanceOf(Error);

    expect(Date.now() - started).toBeGreaterThanOrEqual(4900);
    expect(Date.now() - started).toBeLessThan(7000);
  }, 10_000);

  it('keeps an input id with slashes and dots inside its own path segment', async () => {
    answer = json(200, { result: { enabled: false }, success: true });

    await cloudflare().closeInput('../../other/../x?y=1#z');

    expect(urls).toHaveLength(1);
    expect(urls[0]).not.toContain('?y=1');
    expect(urls[0]).not.toMatch(/\/\.\.\//);
  });

  it('puts the session id in the input’s name and nothing else personal', async () => {
    answer = json(200, {});

    await cloudflare().createInput({ id: 'session-42' });

    const body = bodies.join('');
    expect(body).toContain('session-42');
    expect(body).not.toContain('abc123');
    expect(body).not.toContain('secret-api-token');
  });

  it('answers every one of ten simultaneous creates on its own', async () => {
    answer = (req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          result: {
            uid: `u-${Math.random()}`,
            webRTC: { url: 'https://c/x/webRTC/publish' },
          },
          success: true,
        }),
      );
      void req;
    };

    const inputs = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        cloudflare().createInput({ id: `s${i}` }),
      ),
    );

    const ids = inputs.map((i) => ('inputId' in i ? i.inputId : 'missing'));
    expect(new Set(ids).size).toBe(10);
  });

  it('signs a manifest for an expiry with milliseconds in whole seconds', () => {
    const url = cloudflare().viewUrl(
      'input-1',
      new Date('2026-10-26T10:05:00.999Z'),
    );

    const token = new URL(url).pathname.split('/')[1] ?? '';
    const payload = JSON.parse(
      Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8'),
    );
    expect(payload).toEqual({
      exp: Math.floor(Date.parse('2026-10-26T10:05:00.999Z') / 1000),
      sub: 'input-1',
    });
  });
});
