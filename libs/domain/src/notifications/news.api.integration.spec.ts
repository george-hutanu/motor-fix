import { NEWS_CONSENT_TEXT_VERSION } from '@motor-fix/contracts';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { unsubscribedAccount, unsubscribeToken } from './news';
import { NewsService } from './news.service';
import { NotificationsModule } from './notifications.module';
import { NotificationsService } from './notifications.service';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
  testConfig,
} from './notifications.testing';
import { signAccessToken } from '../auth/access-token';
import { AuthModule } from '../auth/auth.module';
import type { Role } from '../auth/capabilities';
import { serialDatabase } from '../auth/serial-db.testing';

const redisUrl = redisUrlFor(6);
const tokenSecret = 'test-secret';
const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);

let app: INestApplication;

beforeAll(async () => {
  const auth = AuthModule.register({ databaseUrl, redisUrl, tokenSecret });
  const moduleRef = await Test.createTestingModule({
    imports: [
      auth,
      NotificationsModule.register(
        { databaseUrl, email: testConfig('http://127.0.0.1:9'), redisUrl },
        auth,
      ),
    ],
  }).compile();
  app = moduleRef.createNestApplication();
  app.useGlobalPipes(
    new ValidationPipe({
      forbidNonWhitelisted: true,
      transform: true,
      whitelist: true,
    }),
  );
  await app.init();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await reset();
  await prisma.newsSend.deleteMany();
  clock('2026-11-05T10:00:00Z');
});

// Both the send and the pipeline read the same clock.
function clock(iso: string) {
  const now = () => new Date(iso);
  app.get(NewsService).now = now;
  app.get(NotificationsService).now = now;
}

const bearer = (accountId: string, role: Role) =>
  `Bearer ${signAccessToken({ accountId, role }, tokenSecret)}`;

async function consenting(
  name: string,
  roles: Role[] = ['driver'],
  language: 'ro' | 'en' = 'ro',
) {
  const id = await account(name, roles, { language });
  await prisma.notificationPreference.create({
    data: {
      accountId: id,
      channel: 'email',
      consentGivenAt: new Date('2026-10-10T10:00:00Z'),
      consentSource: 'settings',
      consentTextVersion: NEWS_CONSENT_TEXT_VERSION,
      enabled: true,
      type: 'NEWS',
    },
  });
  return id;
}

const newsRow = (accountId: string) =>
  prisma.notificationPreference.findFirst({
    where: { accountId, type: 'NEWS' },
  });

const unsubscribe = (token?: string) => {
  const call = request(app.getHttpServer()).post(
    '/notification-preferences/unsubscribe',
  );
  return token === undefined ? call : call.query({ token });
};

const NEWS = {
  text: {
    en: 'The first garages in Cluj are on MotorFix.',
    ro: 'Primele service-uri din Cluj sunt pe MotorFix.',
  },
  title: { en: 'News for October', ro: 'Noutăți din octombrie' },
};

const send = (admin: string, body: object = NEWS, role: Role = 'admin') =>
  request(app.getHttpServer())
    .post('/admin/news')
    .set('Authorization', bearer(admin, role))
    .send(body);

interface NewsParams {
  title: string;
  text: string;
  unsubscribe: string;
  oneClick: string;
}

const newsEmails = () =>
  prisma.notification.findMany({
    orderBy: { createdAt: 'asc' },
    where: { channel: 'email', kind: 'NEWS' },
  });

describe('the one-click stop', () => {
  it('withdraws consent with no session and answers 204', async () => {
    const driver = await consenting('andrei');
    const res = await unsubscribe(unsubscribeToken(driver, tokenSecret));
    expect(res.status).toBe(204);
    const row = await newsRow(driver);
    expect(row).toMatchObject({ enabled: false });
    expect(row?.withdrawnAt).toBeInstanceOf(Date);
    expect(row?.consentGivenAt).toEqual(new Date('2026-10-10T10:00:00Z'));
    const entries = await prisma.activityLog.findMany({
      where: { field: 'news_consent', subjectId: driver },
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      actorId: null,
      actorRole: 'system',
      newValue: { state: 'withdrawn', via: 'link' },
    });
  });

  it('takes the form body mail apps post for one-click unsubscribe', async () => {
    const driver = await consenting('andrei');
    const res = await unsubscribe(unsubscribeToken(driver, tokenSecret))
      .type('form')
      .send('List-Unsubscribe=One-Click');
    expect(res.status).toBe(204);
    expect((await newsRow(driver))?.enabled).toBe(false);
  });

  it('answers the same a second time and records nothing more', async () => {
    const driver = await consenting('andrei');
    const token = unsubscribeToken(driver, tokenSecret);
    await unsubscribe(token);
    const first = (await newsRow(driver))?.withdrawnAt;
    expect((await unsubscribe(token)).status).toBe(204);
    expect((await newsRow(driver))?.withdrawnAt).toEqual(first);
    expect(
      await prisma.activityLog.count({
        where: { field: 'news_consent', subjectId: driver },
      }),
    ).toBe(1);
  });

  it('refuses a link with a bad signature and changes nothing', async () => {
    const driver = await consenting('andrei');
    const token = unsubscribeToken(driver, 'another-secret');
    const res = await unsubscribe(token);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_unsubscribe_link');
    expect((await newsRow(driver))?.enabled).toBe(true);
  });

  it('refuses a call with no token', async () => {
    const res = await unsubscribe();
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_unsubscribe_link');
  });

  it('answers 204 and writes nothing for a driver who never consented', async () => {
    const driver = await account('andrei');
    expect(
      (await unsubscribe(unsubscribeToken(driver, tokenSecret))).status,
    ).toBe(204);
    expect(await newsRow(driver)).toBeNull();
  });

  it('answers 204 for an account that does not exist, telling nothing', async () => {
    const token = unsubscribeToken(
      '0b9d6a52-6f3e-4d55-9a57-2f1a3c1b7e10',
      tokenSecret,
    );
    expect((await unsubscribe(token)).status).toBe(204);
  });

  it('stops a news e-mail still held for the morning, and only that driver’s', async () => {
    const admin = await account('admin', ['admin']);
    const driver = await consenting('andrei');
    const other = await consenting('elena');
    clock('2026-11-05T21:00:00Z');
    await send(admin);
    await unsubscribe(unsubscribeToken(driver, tokenSecret));
    const rows = await newsEmails();
    expect(rows.find((r) => r.accountId === driver)).toMatchObject({
      failure: 'unsubscribed',
      status: 'failed',
    });
    expect(rows.find((r) => r.accountId === other)?.status).toBe('held');
  });

  it('leaves the driver’s other messages on', async () => {
    const driver = await consenting('andrei');
    await unsubscribe(unsubscribeToken(driver, tokenSecret));
    expect(
      await prisma.notificationPreference.count({
        where: { accountId: driver, type: { not: 'NEWS' } },
      }),
    ).toBe(0);
  });
});

describe('an admin sending news', () => {
  it('reaches only drivers who consented, each in their own language', async () => {
    const admin = await account('admin', ['admin']);
    const ro = await consenting('ro-driver', ['driver'], 'ro');
    const en = await consenting('en-driver', ['driver'], 'en');
    const both = await consenting('admin-driver', ['admin', 'driver'], 'ro');
    const never = await account('never');
    const withdrawn = await consenting('withdrawn');
    await prisma.notificationPreference.updateMany({
      data: { enabled: false, withdrawnAt: new Date('2026-10-20T10:00:00Z') },
      where: { accountId: withdrawn },
    });
    const owner = await consenting('owner', ['garage']);
    const res = await send(admin);
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ recipients: 3 });
    const rows = await newsEmails();
    expect(rows.map((r) => r.accountId).sort()).toEqual([ro, en, both].sort());
    for (const nobody of [admin, never, withdrawn, owner]) {
      expect(
        await prisma.notification.count({
          where: { accountId: nobody, kind: 'NEWS' },
        }),
      ).toBe(0);
    }
    const toEn = rows.find((r) => r.accountId === en)!;
    const params = toEn.params as unknown as NewsParams;
    expect(params.title).toBe('News for October');
    expect(params.text).toBe('The first garages in Cluj are on MotorFix.');
    expect(params.unsubscribe).toMatch(
      /^https:\/\/motorfix\.test\/en\/unsubscribe\//,
    );
    const token = params.unsubscribe.split('/').at(-1)!;
    expect(unsubscribedAccount(token, tokenSecret)).toBe(en);
    expect(params.oneClick).toBe(
      `https://motorfix.test/api/v1/notification-preferences/unsubscribe?token=${token}`,
    );
    const toRo = rows.find((r) => r.accountId === ro)!;
    expect((toRo.params as unknown as NewsParams).title).toBe(
      'Noutăți din octombrie',
    );
  });

  it('sends nothing but e-mail outside the app', async () => {
    const admin = await account('admin', ['admin']);
    const driver = await consenting('andrei');
    await send(admin);
    const outside = await prisma.notification.findMany({
      where: { accountId: driver, channel: { not: 'in_app' }, kind: 'NEWS' },
    });
    expect(outside.map((r) => r.channel)).toEqual(['email']);
  });

  it('refuses a second send in the same month, and allows the next month', async () => {
    const admin = await account('admin', ['admin']);
    await consenting('andrei');
    expect((await send(admin)).status).toBe(202);
    clock('2026-11-20T10:00:00Z');
    const again = await send(admin);
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('news_already_sent_this_month');
    expect(await newsEmails()).toHaveLength(1);
    clock('2026-12-01T10:00:00Z');
    expect((await send(admin)).status).toBe(202);
    expect(await newsEmails()).toHaveLength(2);
  });

  it('counts the month in Bucharest: 22:30 UTC on 30 November is already December', async () => {
    const admin = await account('admin', ['admin']);
    await consenting('andrei');
    expect((await send(admin)).status).toBe(202);
    clock('2026-11-30T22:30:00Z');
    expect((await send(admin)).status).toBe(202);
  });

  it('lets only one of two sends at once through', async () => {
    const admin = await account('admin', ['admin']);
    await consenting('andrei');
    const answers = await Promise.all([send(admin), send(admin)]);
    expect(answers.map((a) => a.status).sort()).toEqual([202, 409]);
    expect(await newsEmails()).toHaveLength(1);
  });

  it('counts a send to nobody as the month’s send', async () => {
    const admin = await account('admin', ['admin']);
    const res = await send(admin);
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ recipients: 0 });
    expect((await send(admin)).status).toBe(409);
  });

  it('records who sent it, when, and to how many drivers', async () => {
    const admin = await account('admin', ['admin']);
    await consenting('andrei');
    await consenting('elena');
    await send(admin);
    const entries = await prisma.activityLog.findMany({
      where: { subjectId: admin, subjectType: 'news_send' },
    });
    expect(entries).toHaveLength(1);
    const [entry] = entries;
    expect(entry).toMatchObject({
      action: 'create',
      actorId: admin,
      actorRole: 'admin',
      newValue: { month: '2026-11', recipients: 2 },
    });
    expect(entry.at).toBeInstanceOf(Date);
  });

  it('gives the month back when a send fails part-way, and a retry reaches each driver once', async () => {
    const admin = await account('admin', ['admin']);
    await consenting('andrei');
    await consenting('elena');
    const notifications = app.get(NotificationsService);
    const notify = notifications.notify;
    let calls = 0;
    notifications.notify = (input) => {
      calls += 1;
      if (calls === 2) return Promise.reject(new Error('redis down'));
      return notify.call(notifications, input);
    };
    try {
      expect((await send(admin)).status).toBe(500);
    } finally {
      notifications.notify = notify;
    }
    expect(await prisma.newsSend.count()).toBe(0);
    expect(await newsEmails()).toHaveLength(1);
    const entries = await prisma.activityLog.findMany({
      orderBy: { at: 'asc' },
      where: { subjectId: admin, subjectType: 'news_send' },
    });
    expect(entries.map((e) => e.action)).toEqual(['create', 'delete']);
    const retry = await send(admin);
    expect(retry.status).toBe(202);
    expect(retry.body).toEqual({ recipients: 2 });
    expect(await newsEmails()).toHaveLength(2);
    expect(await prisma.newsSend.count()).toBe(1);
  });

  it('holds the e-mails of a send at night until 08:00 in Bucharest', async () => {
    const admin = await account('admin', ['admin']);
    await consenting('andrei');
    clock('2026-11-05T21:00:00Z');
    await send(admin);
    const [row] = await newsEmails();
    expect(row.status).toBe('held');
    expect(row.sendAfter?.toISOString()).toBe('2026-11-06T06:00:00.000Z');
  });

  it.each([
    ['driver', ['driver']],
    ['garage', ['garage']],
  ] as const)('answers 404 to a %s and sends nothing', async (role, roles) => {
    const caller = await account(`caller-${role}`, [...roles]);
    await consenting('andrei');
    const res = await send(caller, NEWS, role);
    expect(res.status).toBe(404);
    expect(await newsEmails()).toEqual([]);
    expect(await prisma.newsSend.count()).toBe(0);
  });

  it('answers 401 without a session', async () => {
    const res = await request(app.getHttpServer())
      .post('/admin/news')
      .send(NEWS);
    expect(res.status).toBe(401);
  });

  it.each([
    ['without an English title', { ...NEWS, title: { ro: 'Noutăți' } }],
    ['with an empty text', { ...NEWS, text: { en: '', ro: '' } }],
    [
      'with a title too long for a subject',
      { ...NEWS, title: { ...NEWS.title, en: 'x'.repeat(151) } },
    ],
    ['with nothing', {}],
  ])('refuses a send %s', async (_, body) => {
    const admin = await account('admin', ['admin']);
    expect((await send(admin, body)).status).toBe(400);
    expect(await prisma.newsSend.count()).toBe(0);
  });
});
