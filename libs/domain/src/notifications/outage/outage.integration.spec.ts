import { INestApplication, Logger, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AuthModule } from '../../auth/auth.module';
import { serialDatabase } from '../../auth/serial-db.testing';
import { NotificationsModule } from '../notifications.module';
import { NotificationsService } from '../notifications.service';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
  testConfig,
} from '../notifications.testing';

// Shares the Brevo webhook spec's database: this file reads rows, never jobs.
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

const post = (target: INestApplication, body: unknown, header?: string) => {
  const call = request(target.getHttpServer())
    .post('/monitoring/outage-alerts')
    .send(body as object);
  return header === undefined ? call : call.set('Authorization', header);
};

const alert = (
  status: 'firing' | 'resolved',
  overrides: Record<string, unknown> = {},
) => ({
  endsAt: status === 'firing' ? '0001-01-01T00:00:00Z' : '2026-10-10T03:09:00Z',
  fingerprint: '5f1a2b3c4d5e6f70',
  labels: { alertname: 'outage', outage: 'true', service: 'api' },
  startsAt: '2026-10-10T03:04:05Z',
  status,
  ...overrides,
});

const payload = (...alerts: unknown[]) => ({
  alerts,
  receiver: 'motorfix-outage',
  status: 'firing',
  version: '1',
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

async function people() {
  const admins = [
    await withDevice(await account('ana', ['admin'])),
    await withDevice(await account('bogdan', ['admin'])),
  ];
  const suspended = await withDevice(
    await account('cristi', ['admin'], { status: 'suspended' }),
  );
  const owner = await withDevice(await account('dana', ['garage']));
  return { admins, others: [suspended, owner] };
}

const outsideRows = () =>
  prisma.notification.findMany({
    orderBy: [{ accountId: 'asc' }, { channel: 'asc' }],
    where: { channel: { in: ['email', 'push'] }, kind: KIND },
  });

// @traces 251-FR-005 251-FR-006 251-FR-007 251-FR-008
describe('the outage webhook', () => {
  it('sends every active admin one e-mail and one push when a check goes down', async () => {
    const { admins, others } = await people();

    const res = await post(app, payload(alert('firing')), `Bearer ${TOKEN}`);

    expect(res.status).toBe(204);
    const rows = await outsideRows();
    expect(rows).toHaveLength(4);
    for (const id of admins) {
      expect(
        rows
          .filter((r) => r.accountId === id)
          .map((r) => r.channel)
          .sort(),
      ).toEqual(['email', 'push']);
    }
    expect(rows.some((r) => others.includes(r.accountId ?? ''))).toBe(false);
    expect(rows[0]?.params).toMatchObject({
      at: '2026-10-10T03:04:05.000Z',
      service: 'api',
      state: 'down',
    });
    expect(rows.every((r) => r.status === 'queued')).toBe(true);
  });

  it('sends nothing more when the same outage is posted again', async () => {
    await people();
    await post(app, payload(alert('firing')), `Bearer ${TOKEN}`);

    const res = await post(app, payload(alert('firing')), `Bearer ${TOKEN}`);

    expect(res.status).toBe(204);
    expect(await outsideRows()).toHaveLength(4);
  });

  it('sends "back" once the alert resolves, and a later outage again', async () => {
    await people();
    await post(app, payload(alert('firing')), `Bearer ${TOKEN}`);
    await post(app, payload(alert('resolved')), `Bearer ${TOKEN}`);
    await post(
      app,
      payload(alert('firing', { startsAt: '2026-10-11T08:00:00Z' })),
      `Bearer ${TOKEN}`,
    );

    const states = (await outsideRows()).map(
      (r) => (r.params as { state: string }).state,
    );
    expect(states.filter((s) => s === 'back')).toHaveLength(4);
    expect(states.filter((s) => s === 'down')).toHaveLength(8);
  });

  it('handles each alert of a payload on its own', async () => {
    await people();
    const web = alert('firing', {
      fingerprint: 'aa11',
      labels: { outage: 'true', service: 'web' },
    });

    await post(app, payload(alert('firing'), web), `Bearer ${TOKEN}`);

    const services = new Set(
      (await outsideRows()).map(
        (r) => (r.params as { service: string }).service,
      ),
    );
    expect(services).toEqual(new Set(['api', 'web']));
  });

  it('acknowledges an alert that is not an outage and sends nothing', async () => {
    await people();
    const other = alert('firing', { labels: { alertname: 'mcp-errors' } });

    const res = await post(app, payload(other), `Bearer ${TOKEN}`);

    expect(res.status).toBe(204);
    expect(await outsideRows()).toHaveLength(0);
  });

  it('reaches an admin who switched the alert off', async () => {
    const { admins } = await people();
    for (const channel of ['email', 'push'] as const) {
      await prisma.notificationPreference.create({
        data: {
          accountId: admins[0] as string,
          channel,
          enabled: false,
          type: KIND,
        },
      });
    }

    await post(app, payload(alert('firing')), `Bearer ${TOKEN}`);

    const mine = (await outsideRows()).filter((r) => r.accountId === admins[0]);
    expect(mine.map((r) => r.channel).sort()).toEqual(['email', 'push']);
    expect(mine.every((r) => r.status === 'queued')).toBe(true);
  });

  it('sends at once during quiet hours', async () => {
    await people();
    const service = app.get(NotificationsService);
    // 23:10 in Bucharest.
    service.now = () => new Date('2026-10-04T20:10:00Z');
    try {
      await post(app, payload(alert('firing')), `Bearer ${TOKEN}`);
    } finally {
      service.now = () => new Date();
    }

    const sent = await outsideRows();
    expect(sent.length).toBeGreaterThan(0);
    expect(sent.every((r) => r.status === 'queued' && !r.sendAfter)).toBe(true);
  });

  it.each([
    ['no token', undefined],
    ['a wrong token', 'Bearer not-the-token'],
    ['a token that is not a bearer one', TOKEN],
  ])('refuses %s and sends nothing', async (_label, header) => {
    await people();

    const res = await post(app, payload(alert('firing')), header);

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ code: 'sign_in_required' });
    expect(await outsideRows()).toHaveLength(0);
  });

  it('refuses every call when no token is configured', async () => {
    await people();
    const closed = await boot(undefined);
    try {
      const res = await post(closed, payload(alert('firing')), 'Bearer ');
      expect(res.status).toBe(401);
      const guessed = await post(
        closed,
        payload(alert('firing')),
        'Bearer undefined',
      );
      expect(guessed.status).toBe(401);
    } finally {
      await closed.close();
    }
    expect(await outsideRows()).toHaveLength(0);
  });

  it.each([
    ['no alerts', { status: 'firing' }],
    ['alerts that are not a list', { alerts: 'down' }],
  ])(
    'answers 400 to a body with %s and sends nothing',
    async (_label, body) => {
      await people();

      const res = await post(app, body, `Bearer ${TOKEN}`);

      expect(res.status).toBe(400);
      expect(await outsideRows()).toHaveLength(0);
    },
  );

  it('checks the token before the body', async () => {
    const res = await post(app, { alerts: 'down' }, 'Bearer wrong');
    expect(res.status).toBe(401);
  });
});

// @traces 251-FR-009
describe('the outage log', () => {
  it('writes one line per alert naming service, state, fingerprint and admin count, never the token or an address', async () => {
    await people();
    const log = jest.spyOn(Logger.prototype, 'log');

    await post(
      app,
      payload(alert('firing'), alert('firing', { fingerprint: 'aa11bb22' })),
      `Bearer ${TOKEN}`,
    );

    const lines = log.mock.calls
      .map(([message]) => String(message))
      .filter((message) => message.includes('fingerprint='));
    log.mockRestore();
    expect(lines).toEqual([
      'api down fingerprint=5f1a2b3c4d5e6f70 admins=2 sent=true',
      'api down fingerprint=aa11bb22 admins=2 sent=true',
    ]);
    expect(lines.join()).not.toMatch(new RegExp(`${TOKEN}|@`));
  });
});
