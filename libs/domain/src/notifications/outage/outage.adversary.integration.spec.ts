import { INestApplication, Logger, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AuthModule } from '../../auth/auth.module';
import { serialDatabase } from '../../auth/serial-db.testing';
import { NotificationsModule } from '../notifications.module';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
  testConfig,
} from '../notifications.testing';

const redisUrl = redisUrlFor(14);
const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);

const TOKEN = 'outage-token';
const KIND = 'ADMIN_OUTAGE_ALERT';

async function boot(outageWebhookToken: string | undefined) {
  const auth = AuthModule.register({ databaseUrl, redisUrl, tokenSecret: 's' });
  const moduleRef = await Test.createTestingModule({
    imports: [
      auth,
      NotificationsModule.register(
        {
          databaseUrl,
          email: testConfig('http://127.0.0.1:9'),
          outageWebhookToken,
          push: {
            privateKey: 'private',
            publicKey: 'public',
            subject: 'mailto:ops@example.test',
          },
          redisUrl,
        },
        auth,
      ),
    ],
  }).compile();
  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(
    new ValidationPipe({
      forbidNonWhitelisted: true,
      transform: true,
      whitelist: true,
    }),
  );
  await app.init();
  return app;
}

let app: INestApplication;

beforeAll(async () => {
  app = await boot(TOKEN);
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

beforeEach(() => reset());
afterEach(() => jest.restoreAllMocks());

const AUTH = `Bearer ${TOKEN}`;

const post = (body: unknown, header: string | undefined = AUTH) => {
  const call = request(app.getHttpServer())
    .post('/monitoring/outage-alerts')
    .send(body as object);
  return header === undefined ? call : call.set('Authorization', header);
};

const alert = (overrides: Record<string, unknown> = {}) => ({
  endsAt: '0001-01-01T00:00:00Z',
  fingerprint: 'f1',
  labels: { alertname: 'outage', outage: 'true', service: 'api' },
  startsAt: '2026-10-10T03:04:05Z',
  status: 'firing',
  ...overrides,
});

const withDevice = async (accountId: string) => {
  await prisma.pushSubscription.create({
    data: {
      accountId,
      auth: 'a',
      endpoint: `https://push.example.test/${accountId}`,
      p256dh: 'p',
    },
  });
  return accountId;
};

const oneAdmin = async () => withDevice(await account('ana', ['admin']));

const rows = () =>
  prisma.notification.findMany({
    orderBy: [{ channel: 'asc' }],
    where: { channel: { in: ['email', 'push'] }, kind: KIND },
  });

const params = (r: { params: unknown }) =>
  r.params as { at: string; service: string; state: string };

// @traces 251-FR-005
describe('the outage webhook credentials under attack', () => {
  it.each([
    ['an empty bearer value', 'Bearer '],
    ['two spaces before the token', `Bearer  ${TOKEN}`],
    ['a prefix of the token', 'Bearer outage-toke'],
    ['the token with more characters', `Bearer ${TOKEN}x`],
    ['a different case token', `Bearer ${TOKEN.toUpperCase()}`],
    ['a basic scheme', `Basic ${TOKEN}`],
    ['an empty header', ''],
  ])('answers 401 with the contract body for %s', async (_, header) => {
    await oneAdmin();

    const res = await post({ alerts: [alert()] }, header);

    expect(res.status).toBe(401);
    expect(res.body).toEqual({
      code: 'sign_in_required',
      message: 'Unknown webhook caller',
    });
    expect(await rows()).toHaveLength(0);
  });

  it('refuses an empty bearer when the configured token is the empty string', async () => {
    const empty = await boot('');
    try {
      const res = await request(empty.getHttpServer())
        .post('/monitoring/outage-alerts')
        .set('Authorization', 'Bearer ')
        .send({ alerts: [] });
      expect(res.status).toBe(401);
    } finally {
      await empty.close();
    }
  });

  it('never writes the token to the log when it is refused', async () => {
    const log = jest.spyOn(Logger.prototype, 'log');
    const warn = jest.spyOn(Logger.prototype, 'warn');
    const error = jest.spyOn(Logger.prototype, 'error');
    await post({ alerts: [alert()] }, 'Bearer wrong-secret-value');
    const written = JSON.stringify([
      ...log.mock.calls,
      ...warn.mock.calls,
      ...error.mock.calls,
    ]);
    expect(written).not.toContain('wrong-secret-value');
    expect(written).not.toContain(TOKEN);
  });

  it('answers the contract body for a payload without alerts', async () => {
    const res = await post({ status: 'firing' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      code: 'validation_failed',
      message: 'Not a Grafana alert payload',
    });
  });
});

// @traces 251-FR-005
describe('payloads that are not Grafana alert payloads', () => {
  it.each([
    ['null alerts', { alerts: null }],
    ['an object as alerts', { alerts: {} }],
    ['a number as alerts', { alerts: 3 }],
    ['an empty body object', {}],
    ['a top-level array', [alert()]],
    ['a top-level null', null],
    ['a top-level string', 'alerts'],
  ])('answers 400 and sends nothing for %s', async (_, body) => {
    await oneAdmin();

    const res = await post(body);

    expect(res.status).toBe(400);
    expect(await rows()).toHaveLength(0);
  });

  it('answers 400 for a text body that is not JSON', async () => {
    const res = await request(app.getHttpServer())
      .post('/monitoring/outage-alerts')
      .set('Authorization', AUTH)
      .set('Content-Type', 'text/plain')
      .send('alerts');
    expect(res.status).toBe(400);
  });

  it('answers 204 and sends nothing for an empty list', async () => {
    await oneAdmin();
    const res = await post({ alerts: [] });
    expect(res.status).toBe(204);
    expect(res.text).toBe('');
    expect(await rows()).toHaveLength(0);
  });
});

// @traces 251-FR-006
describe('alerts the endpoint must skip without failing', () => {
  it.each([
    ['a null entry', null],
    ['a string entry', 'firing'],
    ['a number entry', 7],
    ['an entry with null labels', alert({ labels: null })],
    ['an entry with no labels', alert({ labels: undefined })],
    [
      'a boolean outage label',
      alert({ labels: { outage: true, service: 'api' } }),
    ],
    [
      'an upper-case outage label',
      alert({ labels: { outage: 'TRUE', service: 'api' } }),
    ],
    ['no fingerprint', alert({ fingerprint: undefined })],
    ['an empty fingerprint', alert({ fingerprint: '' })],
    ['a numeric fingerprint', alert({ fingerprint: 12345 })],
    ['an unparseable startsAt', alert({ startsAt: 'last tuesday' })],
    ['no startsAt', alert({ startsAt: undefined })],
    ['a null startsAt', alert({ startsAt: null })],
    [
      'a resolved alert with an unparseable endsAt',
      alert({ endsAt: 'soon', status: 'resolved' }),
    ],
    [
      'a resolved alert with no endsAt',
      alert({ endsAt: undefined, status: 'resolved' }),
    ],
  ])('acknowledges %s and sends nothing', async (_, entry) => {
    await oneAdmin();

    const res = await post({ alerts: [entry] });

    expect(res.status).toBe(204);
    expect(await rows()).toHaveLength(0);
  });

  it('still handles the good alert that follows a broken one', async () => {
    await oneAdmin();

    const res = await post({
      alerts: [
        null,
        alert({ fingerprint: undefined }),
        alert({ fingerprint: 'good' }),
      ],
    });

    expect(res.status).toBe(204);
    expect(await rows()).toHaveLength(2);
  });

  it('logs the reason for a skipped alert', async () => {
    const log = jest.spyOn(Logger.prototype, 'log');
    const warn = jest.spyOn(Logger.prototype, 'warn');
    await post({ alerts: [alert({ fingerprint: undefined })] });
    const written = JSON.stringify([...log.mock.calls, ...warn.mock.calls]);
    expect(written).toContain('alert skipped');
  });

  it('sends a firing alert whose endsAt is garbage, since only startsAt is read', async () => {
    await oneAdmin();

    const res = await post({ alerts: [alert({ endsAt: 'garbage' })] });

    expect(res.status).toBe(204);
    expect(await rows()).toHaveLength(2);
  });
});

// @traces 251-FR-006
describe('what the endpoint reads from a valid alert', () => {
  it('reads resolved as back at endsAt and sends nothing for any other status', async () => {
    await oneAdmin();

    await post({
      alerts: [
        alert({
          endsAt: '2026-10-10T03:09:00Z',
          fingerprint: 'g',
          status: 'resolved',
        }),
        alert({
          endsAt: '2026-10-10T03:10:00Z',
          fingerprint: 'h',
          status: 'Firing',
        }),
        alert({
          endsAt: '2026-10-10T03:11:00Z',
          fingerprint: 'i',
          status: undefined,
        }),
      ],
    });

    const all = await rows();
    expect(all).toHaveLength(2);
    expect(new Set(all.map((r) => params(r).state))).toEqual(new Set(['back']));
    expect(new Set(all.map((r) => params(r).at))).toEqual(
      new Set(['2026-10-10T03:09:00.000Z']),
    );
  });

  it('names the service unknown when the label is missing', async () => {
    await oneAdmin();
    await post({
      alerts: [alert({ labels: { outage: 'true' } })],
    });
    const all = await rows();
    expect(all).toHaveLength(2);
    expect(all.every((r) => params(r).service === 'unknown')).toBe(true);
  });

  it('keeps a Romanian service name as given', async () => {
    await oneAdmin();
    await post({
      alerts: [
        alert({ labels: { outage: 'true', service: 'servicii-șțăîâ' } }),
      ],
    });
    expect((await rows()).map((r) => params(r).service)).toEqual([
      'servicii-șțăîâ',
      'servicii-șțăîâ',
    ]);
  });

  it('keeps a 40-character service whole', async () => {
    await oneAdmin();
    const service = 's'.repeat(40);
    await post({ alerts: [alert({ labels: { outage: 'true', service } })] });
    expect((await rows()).map((r) => params(r).service)).toEqual([
      service,
      service,
    ]);
  });

  it('never stores a service longer than 40 characters', async () => {
    await oneAdmin();
    const res = await post({
      alerts: [alert({ labels: { outage: 'true', service: 's'.repeat(41) } })],
    });
    expect(res.status).toBe(204);
    for (const r of await rows()) {
      expect(params(r).service.length).toBeLessThanOrEqual(40);
    }
  });

  it('never stores a 10000-character service', async () => {
    await oneAdmin();
    const res = await post({
      alerts: [
        alert({ labels: { outage: 'true', service: 'z'.repeat(10_000) } }),
      ],
    });
    expect(res.status).toBe(204);
    for (const r of await rows()) {
      expect(params(r).service.length).toBeLessThanOrEqual(40);
    }
  });

  it('ignores extra fields on the alert and on the payload', async () => {
    await oneAdmin();
    const res = await post({
      alerts: [alert({ generatorURL: 'http://x', values: { B: 0 } })],
      commonLabels: { a: 'b' },
      externalURL: 'http://grafana',
      title: 'x',
    });
    expect(res.status).toBe(204);
    expect(await rows()).toHaveLength(2);
  });

  it('sends nothing, and still answers 204, when no admin is active', async () => {
    await account('dana', ['garage']);
    await account('cristi', ['admin'], { status: 'suspended' });
    const res = await post({ alerts: [alert()] });
    expect(res.status).toBe(204);
    expect(await rows()).toHaveLength(0);
  });

  it('sends to an admin who also holds another role', async () => {
    const id = await withDevice(await account('ana', ['admin', 'garage']));
    await post({ alerts: [alert()] });
    expect((await rows()).map((r) => r.accountId)).toEqual([id, id]);
  });
});

// @traces 251-FR-007
describe('one message pair per outage', () => {
  it('writes one pair when the same payload arrives five times at once', async () => {
    await oneAdmin();

    const results = await Promise.all(
      Array.from({ length: 5 }, () => post({ alerts: [alert()] })),
    );

    expect(results.map((r) => r.status)).toEqual([204, 204, 204, 204, 204]);
    expect(await rows()).toHaveLength(2);
  });

  it('writes one pair when the same alert is twice in one payload', async () => {
    await oneAdmin();
    const res = await post({ alerts: [alert(), alert()] });
    expect(res.status).toBe(204);
    expect(await rows()).toHaveLength(2);
  });

  it('treats another fingerprint as another outage', async () => {
    await oneAdmin();
    await post({ alerts: [alert(), alert({ fingerprint: 'other' })] });
    expect(await rows()).toHaveLength(4);
  });

  it('treats another start time as another outage', async () => {
    await oneAdmin();
    await post({
      alerts: [alert(), alert({ startsAt: '2026-10-10T03:04:06Z' })],
    });
    expect(await rows()).toHaveLength(4);
  });

  it('does not let a resolved repeat of a firing event suppress either message', async () => {
    await oneAdmin();
    await post({ alerts: [alert()] });
    await post({
      alerts: [alert({ endsAt: '2026-10-10T03:09:00Z', status: 'resolved' })],
    });
    await post({
      alerts: [alert({ endsAt: '2026-10-10T03:19:00Z', status: 'resolved' })],
    });
    const states = (await rows()).map((r) => params(r).state);
    expect(states.filter((s) => s === 'down')).toHaveLength(2);
    expect(states.filter((s) => s === 'back')).toHaveLength(2);
  });

  it('still sends to an admin added after an earlier payload', async () => {
    await oneAdmin();
    await post({ alerts: [alert()] });
    await withDevice(await account('bogdan', ['admin']));
    await post({ alerts: [alert()] });
    expect(await rows()).toHaveLength(4);
  });

  it('handles two hundred alerts in one payload', async () => {
    await oneAdmin();
    const alerts = Array.from({ length: 200 }, (_, i) =>
      alert({ fingerprint: `fp-${i}` }),
    );
    const res = await post({ alerts });
    expect(res.status).toBe(204);
    expect(await rows()).toHaveLength(400);
  }, 60_000);
});

// @traces 251-FR-009
describe('the log line', () => {
  it('writes one line per alert in the contract wording', async () => {
    await oneAdmin();
    const log = jest.spyOn(Logger.prototype, 'log');

    await post({ alerts: [alert(), alert({ fingerprint: 'f2' })] });

    const lines = log.mock.calls
      .map((c) => String(c[0]))
      .filter((m) => m.includes('fingerprint='));
    expect(lines).toEqual([
      'api down fingerprint=f1 admins=1 sent=true',
      'api down fingerprint=f2 admins=1 sent=true',
    ]);
  });

  it('says sent=false for a repeat', async () => {
    await oneAdmin();
    await post({ alerts: [alert()] });
    const log = jest.spyOn(Logger.prototype, 'log');

    await post({ alerts: [alert()] });

    const lines = log.mock.calls.map((c) => String(c[0]));
    expect(lines).toContain('api down fingerprint=f1 admins=1 sent=false');
  });

  it('never writes a push endpoint or the body', async () => {
    await oneAdmin();
    const log = jest.spyOn(Logger.prototype, 'log');
    await post({
      alerts: [alert({ generatorURL: 'http://secret-body-marker' })],
    });
    const written = JSON.stringify(log.mock.calls);
    expect(written).not.toContain('push.example.test');
    expect(written).not.toContain('secret-body-marker');
    expect(written).not.toContain(TOKEN);
  });
});
