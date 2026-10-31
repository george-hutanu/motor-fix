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

// @traces 333-FR-018
// @traces 1251-FR-001
describe('deleting the recordings of a live input at Cloudflare', () => {
  const list = '/accounts/acct-1/stream/live_inputs/input-uid-1/videos';
  const videos = (...uids: string[]) =>
    json(200, { result: uids.map((uid) => ({ uid })), success: true });
  const route =
    (listReply: Answer, deleteReply: Answer = json(200, { success: true })) =>
    (req: IncomingMessage, res: ServerResponse) =>
      req.method === 'GET' ? listReply(req, res) : deleteReply(req, res);
  const calls = () => seen.map(({ method, url }) => `${method} ${url}`);

  it('lists the input videos and deletes each by its uid', async () => {
    answer = route(videos('video-1', 'video-2'));

    await cloudflare().deleteRecording('input-uid-1');

    expect(calls()).toEqual([
      `GET ${list}`,
      'DELETE /accounts/acct-1/stream/video-1',
      'DELETE /accounts/acct-1/stream/video-2',
    ]);
    expect(seen.every(({ auth }) => auth === 'Bearer secret-api-token')).toBe(
      true,
    );
  });

  it('takes an empty list as deleted', async () => {
    answer = route(videos());

    await expect(cloudflare().deleteRecording('input-uid-1')).resolves.toBe(
      undefined,
    );
    expect(calls()).toEqual([`GET ${list}`]);
  });

  it('takes an input already gone as deleted', async () => {
    answer = route(json(404, { success: false }));

    await expect(cloudflare().deleteRecording('input-uid-1')).resolves.toBe(
      undefined,
    );
    expect(calls()).toEqual([`GET ${list}`]);
  });

  it('counts a video already gone as deleted', async () => {
    answer = route(videos('video-1'), json(404, { success: false }));

    await expect(cloudflare().deleteRecording('input-uid-1')).resolves.toBe(
      undefined,
    );
    expect(calls()).toEqual([
      `GET ${list}`,
      'DELETE /accounts/acct-1/stream/video-1',
    ]);
  });

  it('takes an empty delete answer as deleted', async () => {
    answer = route(videos('video-1'), (_req, res) => {
      res.writeHead(200);
      res.end();
    });

    await expect(cloudflare().deleteRecording('input-uid-1')).resolves.toBe(
      undefined,
    );
    expect(calls()).toEqual([
      `GET ${list}`,
      'DELETE /accounts/acct-1/stream/video-1',
    ]);
  });

  it('throws when the list fails', async () => {
    answer = route(json(500, { success: false }));

    await expect(cloudflare().deleteRecording('input-uid-1')).rejects.toThrow(
      /500/,
    );
  });

  it('throws when a video delete fails', async () => {
    answer = route(videos('video-1'), json(502, { success: false }));

    await expect(cloudflare().deleteRecording('input-uid-1')).rejects.toThrow(
      /502/,
    );
    expect(calls()).toEqual([
      `GET ${list}`,
      'DELETE /accounts/acct-1/stream/video-1',
    ]);
  });

  it('does nothing more the second time once the videos are gone', async () => {
    let left = ['video-1'];
    answer = (req, res) => {
      if (req.method === 'GET') return videos(...left)(req, res);
      left = [];
      json(200, { success: true })(req, res);
    };

    await cloudflare().deleteRecording('input-uid-1');
    await cloudflare().deleteRecording('input-uid-1');

    expect(calls()).toEqual([
      `GET ${list}`,
      'DELETE /accounts/acct-1/stream/video-1',
      `GET ${list}`,
    ]);
  });

  it('gives up after five seconds', async () => {
    answer = () => undefined;
    const started = Date.now();

    await expect(cloudflare().deleteRecording('input-uid-1')).rejects.toThrow(
      /timeout/,
    );
    expect(Date.now() - started).toBeLessThan(7000);
  }, 10_000);
});

// @traces 1251-FR-011
describe('reading the publisher state of a live input at Cloudflare', () => {
  const status = (current: unknown) =>
    json(200, {
      result: { status: current, uid: 'input-uid-1' },
      success: true,
    });

  it('reads the input and takes a connected state as a publisher, since its entry', async () => {
    answer = status({
      current: {
        state: 'connected',
        statusEnteredAt: '2026-10-29T10:00:00.000Z',
      },
    });

    await expect(cloudflare().inputStatus('input-uid-1')).resolves.toEqual({
      connected: true,
      since: new Date('2026-10-29T10:00:00.000Z'),
    });
    expect(seen).toEqual([
      expect.objectContaining({
        auth: 'Bearer secret-api-token',
        method: 'GET',
        url: '/accounts/acct-1/stream/live_inputs/input-uid-1',
      }),
    ]);
  });

  it('takes a reconnected state as a publisher too', async () => {
    answer = status({
      current: {
        state: 'reconnected',
        statusEnteredAt: '2026-10-29T10:05:00.000Z',
      },
    });

    await expect(
      cloudflare().inputStatus('input-uid-1'),
    ).resolves.toMatchObject({ connected: true });
  });

  it('takes a disconnect as no publisher since the state was entered', async () => {
    answer = status({
      current: {
        state: 'client_disconnect',
        statusEnteredAt: '2026-10-29T10:07:00.000Z',
      },
    });

    await expect(cloudflare().inputStatus('input-uid-1')).resolves.toEqual({
      connected: false,
      since: new Date('2026-10-29T10:07:00.000Z'),
    });
  });

  it('takes an input that never had a publisher as never connected', async () => {
    answer = status(null);

    await expect(cloudflare().inputStatus('input-uid-1')).resolves.toEqual({
      connected: false,
      since: null,
    });
  });

  it('takes an input already gone as never connected', async () => {
    answer = json(404, { success: false });

    await expect(cloudflare().inputStatus('input-uid-1')).resolves.toEqual({
      connected: false,
      since: null,
    });
  });

  it('drops an unreadable entry time', async () => {
    answer = status({
      current: { state: 'client_disconnect', statusEnteredAt: 'soon' },
    });

    await expect(cloudflare().inputStatus('input-uid-1')).resolves.toEqual({
      connected: false,
      since: null,
    });
  });

  it.each([
    ['a failing answer', json(500, { success: false })],
    ['a refused answer', json(200, { success: false })],
    ['a body with no input', json(200, { success: true })],
  ])('throws on %s, so the session is not stopped on a guess', async (_, a) => {
    answer = a;

    await expect(cloudflare().inputStatus('input-uid-1')).rejects.toThrow(
      'input status failed',
    );
  });
});

// @traces 1390-FR-002 1390-FR-005
describe('closing a live input at Cloudflare', () => {
  const closedAnswer = json(200, {
    result: { enabled: false, uid: 'input-uid-1' },
    success: true,
  });

  it('disables the input, keeping its signed recording settings, and leaves it in place', async () => {
    answer = closedAnswer;

    await cloudflare().closeInput('input-uid-1');

    expect(seen).toEqual([
      {
        auth: 'Bearer secret-api-token',
        body: {
          enabled: false,
          recording: { mode: 'automatic', requireSignedURLs: true },
        },
        method: 'PUT',
        url: '/accounts/acct-1/stream/live_inputs/input-uid-1',
      },
    ]);
  });

  it('counts an input the provider no longer has as closed', async () => {
    answer = json(404, { success: false });

    await expect(cloudflare().closeInput('input-uid-1')).resolves.toBe(
      undefined,
    );
  });

  it.each([
    ['a server error', json(500, { success: false }), '500'],
    ['a refusal', json(200, { result: null, success: false }), 'rejected'],
    [
      'an input still enabled',
      json(200, { result: { enabled: true }, success: true }),
      'still_enabled',
    ],
    [
      'an answer without the input',
      json(200, { result: null, success: true }),
      'still_enabled',
    ],
    ['an answer that is not JSON', json(200, 'ok'), 'malformed'],
  ])('throws on %s, naming only the reason', async (_name, given, reason) => {
    answer = given;

    await expect(cloudflare().closeInput('input-uid-1')).rejects.toThrow(
      new Error(`live input close failed: ${reason}`),
    );
  });

  it('gives up after five seconds and says it timed out', async () => {
    answer = () => undefined;

    await expect(cloudflare().closeInput('input-uid-1')).rejects.toThrow(
      new Error('live input close failed: timeout'),
    );
  }, 10_000);

  it('still lists the recordings of an input after closing it', async () => {
    const provider = cloudflare();
    answer = closedAnswer;
    await provider.closeInput('input-uid-1');
    answer = json(200, { result: [], success: true });

    await provider.deleteRecording('input-uid-1');

    expect(seen.map((call) => `${call.method} ${call.url}`)).toEqual([
      'PUT /accounts/acct-1/stream/live_inputs/input-uid-1',
      'GET /accounts/acct-1/stream/live_inputs/input-uid-1/videos',
    ]);
  });
});
