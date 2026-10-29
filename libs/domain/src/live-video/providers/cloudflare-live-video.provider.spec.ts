import { generateKeyPairSync, verify } from 'node:crypto';
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';

import { Logger } from '@nestjs/common';

import { CloudflareLiveVideo } from './cloudflare-live-video.provider';

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
});
const pem = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();

const secrets = {
  CLOUDFLARE_STREAM_ACCOUNT_ID: 'acct-1',
  CLOUDFLARE_STREAM_API_TOKEN: 'secret-api-token',
  CLOUDFLARE_STREAM_CUSTOMER_CODE: 'abc123',
  CLOUDFLARE_STREAM_SIGNING_KEY_ID: 'kid-1',
  CLOUDFLARE_STREAM_SIGNING_KEY_PEM: Buffer.from(pem).toString('base64'),
};

type Seen = { method?: string; url?: string; auth?: string; body: unknown };
type Answer = (req: IncomingMessage, res: ServerResponse) => void;

let server: Server;
let base: string;
let seen: Seen[];
let answer: Answer;

beforeAll(async () => {
  server = createServer((req, res) => {
    let text = '';
    req.on('data', (chunk) => (text += chunk));
    req.on('end', () => {
      seen.push({
        auth: req.headers.authorization,
        body: text ? JSON.parse(text) : undefined,
        method: req.method,
        url: req.url,
      });
      answer(req, res);
    });
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise((done) => server.close(done));
});

beforeEach(() => {
  seen = [];
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

const json =
  (status: number, body: unknown): Answer =>
  (_req, res) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(typeof body === 'string' ? body : JSON.stringify(body));
  };

const created = json(201, {
  result: {
    uid: 'input-uid-1',
    webRTC: {
      url: 'https://customer-abc123.cloudflarestream.com/x/webRTC/publish',
    },
  },
  success: true,
});

const cloudflare = () => new CloudflareLiveVideo(secrets, base);

const parts = (url: string) => {
  const found = new URL(url);
  const [, token, ...rest] = found.pathname.split('/');
  return { found, rest: rest.join('/'), token: token ?? '' };
};

const decoded = (part: string) =>
  JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));

// @traces 1250-FR-001 1250-FR-011
describe('the Cloudflare live video provider', () => {
  it('opens a low-latency, signed, recorded live input for the session', async () => {
    answer = created;

    const input = await cloudflare().createInput({ id: 'session-1' });

    expect(input).toEqual({
      inputId: 'input-uid-1',
      publishUrl:
        'https://customer-abc123.cloudflarestream.com/x/webRTC/publish',
    });
    expect(seen).toEqual([
      {
        auth: 'Bearer secret-api-token',
        body: {
          meta: { name: 'motorfix live session session-1' },
          preferLowLatency: true,
          recording: { mode: 'automatic', requireSignedURLs: true },
        },
        method: 'POST',
        url: '/accounts/acct-1/stream/live_inputs',
      },
    ]);
  });

  it('closes an input by its id', async () => {
    answer = json(200, { result: null, success: true });

    await cloudflare().closeInput('input-uid-1');

    expect(seen).toEqual([
      expect.objectContaining({
        auth: 'Bearer secret-api-token',
        method: 'DELETE',
        url: '/accounts/acct-1/stream/live_inputs/input-uid-1',
      }),
    ]);
  });

  it('throws when an input cannot be closed', async () => {
    answer = json(500, { success: false });

    await expect(cloudflare().closeInput('input-uid-1')).rejects.toThrow();
  });

  it('gives up after five seconds and says it timed out', async () => {
    answer = () => undefined;
    const started = Date.now();

    const input = await cloudflare().createInput({ id: 'session-1' });

    expect(input).toEqual({ unavailable: 'timeout' });
    expect(Date.now() - started).toBeGreaterThanOrEqual(4900);
    expect(Date.now() - started).toBeLessThan(7000);
  }, 10_000);

  it.each([
    ['a server error', json(502, 'bad gateway'), '502'],
    [
      'a refusal',
      json(200, { errors: [], result: null, success: false }),
      'rejected',
    ],
    ['a body that is not JSON', json(200, 'not json'), 'malformed'],
    [
      'an answer with no input id',
      json(200, { result: {}, success: true }),
      'malformed',
    ],
  ])('reports %s as unavailable', async (_name, reply, reason) => {
    answer = reply;

    expect(await cloudflare().createInput({ id: 'session-1' })).toEqual({
      unavailable: reason,
    });
  });

  it('reports an unreachable host as a network failure', async () => {
    const away = new CloudflareLiveVideo(secrets, 'http://127.0.0.1:9');

    expect(await away.createInput({ id: 'session-1' })).toEqual({
      unavailable: 'network',
    });
  });

  it('never logs the api token', async () => {
    answer = json(403, { success: false });
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);

    await cloudflare().createInput({ id: 'session-1' });

    expect(JSON.stringify(warn.mock.calls)).not.toContain('secret-api-token');
  });

  it('signs a low-latency manifest URL that names the input and nothing else', () => {
    const expiresAt = new Date('2026-10-26T10:05:00.000Z');

    const url = cloudflare().viewUrl('input-uid-1', expiresAt);

    const { found, rest, token } = parts(url);
    expect(found.origin).toBe('https://customer-abc123.cloudflarestream.com');
    expect(rest).toBe('manifest/video.m3u8');
    expect(found.search).toBe('?protocol=llhls');
    const [header, payload, signature] = token.split('.');
    expect(decoded(header ?? '')).toEqual({ alg: 'RS256', kid: 'kid-1' });
    expect(decoded(payload ?? '')).toEqual({
      exp: expiresAt.getTime() / 1000,
      sub: 'input-uid-1',
    });
    expect(
      verify(
        'sha256',
        Buffer.from(`${header}.${payload}`),
        publicKey,
        Buffer.from(signature ?? '', 'base64url'),
      ),
    ).toBe(true);
  });

  it('signs with a raw PEM key as well', () => {
    const raw = new CloudflareLiveVideo(
      { ...secrets, CLOUDFLARE_STREAM_SIGNING_KEY_PEM: pem },
      base,
    );

    const [header, payload, signature] = parts(
      raw.viewUrl('input-uid-1', new Date()),
    ).token.split('.');

    expect(
      verify(
        'sha256',
        Buffer.from(`${header}.${payload}`),
        publicKey,
        Buffer.from(signature ?? '', 'base64url'),
      ),
    ).toBe(true);
  });
});

// @traces 333-media-storage-FR-018
describe('deleting a kept recording at Cloudflare', () => {
  it('deletes the recording by its uid', async () => {
    answer = json(200, { result: null, success: true });

    await cloudflare().deleteRecording('video-uid-1');

    expect(seen).toEqual([
      expect.objectContaining({
        auth: 'Bearer secret-api-token',
        method: 'DELETE',
        url: '/accounts/acct-1/stream/video-uid-1',
      }),
    ]);
  });

  it('takes an empty answer as deleted', async () => {
    answer = (_req, res) => {
      res.writeHead(200);
      res.end();
    };

    await expect(cloudflare().deleteRecording('video-uid-1')).resolves.toBe(
      undefined,
    );
  });

  it('counts a recording already gone as deleted', async () => {
    answer = json(404, { success: false });

    await expect(cloudflare().deleteRecording('video-uid-1')).resolves.toBe(
      undefined,
    );
  });

  it('throws when the provider refuses or fails', async () => {
    answer = json(500, { success: false });

    await expect(cloudflare().deleteRecording('video-uid-1')).rejects.toThrow(
      /500/,
    );
  });

  it('gives up after five seconds', async () => {
    answer = () => undefined;
    const started = Date.now();

    await expect(cloudflare().deleteRecording('video-uid-1')).rejects.toThrow(
      /timeout/,
    );
    expect(Date.now() - started).toBeLessThan(7000);
  }, 10_000);
});
