import { createECDH, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { generateVAPIDKeys } from 'web-push';

import { PushSender, pushPayload, pushResult } from './push';
import { plainAgent } from './push.testing';

const vapid = generateVAPIDKeys();
const config = {
  privateKey: vapid.privateKey,
  publicKey: vapid.publicKey,
  subject: 'mailto:ops@example.test',
};

const ecdh = createECDH('prime256v1');
ecdh.generateKeys();
const keys = {
  auth: randomBytes(16).toString('base64url'),
  p256dh: ecdh.getPublicKey().toString('base64url'),
};

let server: Server;
let status = 201;
let hang = false;
const seen: IncomingMessage[] = [];
let base = '';

beforeAll(async () => {
  server = createServer((req, res) => {
    seen.push(req);
    req.resume();
    if (hang) return;
    res.statusCode = status;
    res.end();
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.closeAllConnections();
  server.close();
});

beforeEach(() => {
  seen.length = 0;
  status = 201;
  hang = false;
});

const device = () => ({ endpoint: `${base}/push/abc`, ...keys });

describe('PushSender', () => {
  const sender = new PushSender(config, 300, plainAgent());

  it('posts an encrypted message with VAPID, a day of time to live and the urgency', async () => {
    expect(await sender.send(device(), '{"a":1}', true)).toBe('sent');
    expect(await sender.send(device(), '{"a":1}', false)).toBe('sent');
    const [high, normal] = seen;
    expect(high.headers['ttl']).toBe('86400');
    expect(high.headers['urgency']).toBe('high');
    expect(normal.headers['urgency']).toBe('normal');
    expect(high.headers['content-encoding']).toBe('aes128gcm');
    expect(high.headers['authorization']).toMatch(/^vapid t=/);
  });

  it.each([404, 410])('says gone for %s', async (code) => {
    status = code;
    expect(await sender.send(device(), '{}', false)).toBe('gone');
  });

  it.each([429, 500, 503])('says retry for %s', async (code) => {
    status = code;
    expect(await sender.send(device(), '{}', false)).toBe('retry');
  });

  it.each([400, 401, 403, 413])('says refused for %s', async (code) => {
    status = code;
    expect(await sender.send(device(), '{}', false)).toBe('refused');
  });

  it('says retry when nothing answers in time or the host is down', async () => {
    hang = true;
    expect(await sender.send(device(), '{}', false)).toBe('retry');
    expect(
      await sender.send(
        { ...device(), endpoint: 'http://127.0.0.1:9/x' },
        '{}',
        false,
      ),
    ).toBe('retry');
  });

  it('says refused for keys the browser could not have made', async () => {
    expect(
      await sender.send({ ...device(), p256dh: 'AAAA' }, '{}', false),
    ).toBe('refused');
  });
});

describe('pushPayload', () => {
  it('is the notification the service worker shows, opening the link', () => {
    expect(
      JSON.parse(
        pushPayload(
          { body: 'b', link: 'https://x.test/a', title: 't' },
          'https://x.test/i.png',
        ),
      ),
    ).toEqual({
      notification: {
        body: 'b',
        data: {
          onActionClick: {
            default: {
              operation: 'navigateLastFocusedOrOpen',
              url: 'https://x.test/a',
            },
          },
        },
        icon: 'https://x.test/i.png',
        title: 't',
      },
    });
  });
});

describe('pushResult', () => {
  it('says retry for a network error whatever its message names', () => {
    const error = Object.assign(
      new Error('socket hang up while reading auth key'),
      {
        code: 'ECONNRESET',
      },
    );
    expect(pushResult(error)).toBe('retry');
  });

  it('says refused for a web-push validation error with no network code', () => {
    expect(
      pushResult(
        new Error('The subscription p256dh value should be 65 bytes long.'),
      ),
    ).toBe('refused');
  });
});
