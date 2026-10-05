import { NEWS_CONSENT_TEXT_VERSION } from '@motor-fix/contracts';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { type Job, Queue } from 'bullmq';
import { Redis } from 'ioredis';
import request from 'supertest';

import { unsubscribedAccount, unsubscribeToken } from './news';
import {
  NEWS_CONSUMER,
  NEWS_QUEUE,
  NEWS_RUN,
  type NewsEvent,
  NewsFanOut,
} from './news.fan-out';
import { NewsService } from './news.service';
import { NotificationsModule } from './notifications.module';
import { NotificationsService } from './notifications.service';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
  testConfig,
} from './notifications.testing';
import { AuditService } from '../audit/audit.service';
import { signAccessToken } from '../auth/access-token';
import { AuthModule } from '../auth/auth.module';
import type { Role } from '../auth/capabilities';
import { serialDatabase } from '../auth/serial-db.testing';
import { OutboxRelay } from '../events/outbox-relay';

const redisUrl = redisUrlFor(6);
const tokenSecret = 'test-secret';
const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);

let app: INestApplication;
let fanOut: NewsFanOut;
const newsJobs = new Queue<NewsEvent>(NEWS_QUEUE, {
  connection: { url: redisUrl },
  defaultJobOptions: NEWS_RUN,
});
const publisher = new Redis(redisUrl);
// The worker's relay, handing the outbox's news to the queue.
const relay = new OutboxRelay(prisma, publisher, [
  { kinds: NEWS_CONSUMER.kinds, queue: newsJobs },
]);

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
  fanOut = new NewsFanOut(
    prisma,
    app.get(NotificationsService),
    testConfig('http://127.0.0.1:9'),
    tokenSecret,
    new AuditService(),
  );
});

afterAll(async () => {
  await app.close();
  await newsJobs.close();
  publisher.disconnect();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await reset();
  await prisma.newsSend.deleteMany();
  await prisma.outboxEvent.deleteMany();
  await newsJobs.obliterate({ force: true });
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

const queued = async () => {
  await relay.relay();
  return newsJobs.getJobs(['waiting', 'delayed', 'prioritized']);
};

// What the worker does with each queued run: run it, and drop it once done.
async function deliver() {
  for (const job of await queued()) {
    await fanOut.handle(job);
    await job.remove();
  }
}

const sent = async (admin: string) => {
  const res = await send(admin);
  await deliver();
  return res;
};

// The queue calls `failed` after each failed attempt; `made` is how many
// attempts it has made so far.
const failedAfter = (job: Job<NewsEvent>, made: number) =>
  fanOut.failed(
    { attemptsMade: made, data: job.data, opts: job.opts },
    new Error('redis down'),
  );

const failingOn = (call: number) => {
  const notifications = app.get(NotificationsService);
  const notify = notifications.notify;
  let calls = 0;
  notifications.notify = (input) => {
    calls += 1;
    if (calls === call) return Promise.reject(new Error('redis down'));
    return notify.call(notifications, input);
  };
  return () => {
    notifications.notify = notify;
  };
};

const sendLog = (admin: string) =>
  prisma.activityLog.findMany({
    orderBy: { at: 'asc' },
    where: { subjectId: admin, subjectType: 'news_send' },
  });

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
    await sent(admin);
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
  it('answers with the count and leaves the messages to one queued run of the month', async () => {
    const admin = await account('admin', ['admin']);
    await consenting('andrei');
    await consenting('elena');
    const res = await send(admin);
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ recipients: 2 });
    expect(await newsEmails()).toEqual([]);
    const jobs = await queued();
    expect(jobs).toHaveLength(1);
    const [job] = jobs;
    expect(job.data.payload).toEqual({
      month: '2026-11',
      sentBy: { accountId: admin, role: 'admin' },
      text: NEWS.text,
      title: NEWS.title,
    });
    expect(job.opts.attempts).toBeGreaterThan(1);
    await deliver();
    expect(await newsEmails()).toHaveLength(2);
  });

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
    const res = await sent(admin);
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
    await sent(admin);
    const outside = await prisma.notification.findMany({
      where: { accountId: driver, channel: { not: 'in_app' }, kind: 'NEWS' },
    });
    expect(outside.map((r) => r.channel)).toEqual(['email']);
  });

  it('refuses a second send in the same month, and allows the next month', async () => {
    const admin = await account('admin', ['admin']);
    await consenting('andrei');
    expect((await sent(admin)).status).toBe(202);
    clock('2026-11-20T10:00:00Z');
    const again = await sent(admin);
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('news_already_sent_this_month');
    expect(await newsEmails()).toHaveLength(1);
    clock('2026-12-01T10:00:00Z');
    expect((await sent(admin)).status).toBe(202);
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
    expect(await queued()).toHaveLength(1);
    await deliver();
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
    await sent(admin);
    const entries = await sendLog(admin);
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

  it('keeps the month when a run fails part-way, and its retry reaches each driver once', async () => {
    const admin = await account('admin', ['admin']);
    await consenting('andrei');
    await consenting('elena');
    expect((await send(admin)).status).toBe(202);
    const [job] = await queued();
    const restore = failingOn(2);
    try {
      await expect(fanOut.handle(job)).rejects.toThrow('redis down');
    } finally {
      restore();
    }
    await failedAfter(job, 1);
    expect(await newsEmails()).toHaveLength(1);
    expect(await prisma.newsSend.count()).toBe(1);
    await fanOut.handle(job);
    const rows = await newsEmails();
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.accountId)).size).toBe(2);
    expect(await prisma.newsSend.count()).toBe(1);
    expect((await sendLog(admin)).map((e) => e.action)).toEqual(['create']);
  });

  it('gives the month back when the last attempt fails, and lets the admin send again', async () => {
    const admin = await account('admin', ['admin']);
    await consenting('andrei');
    await consenting('elena');
    expect((await send(admin)).status).toBe(202);
    const [job] = await queued();
    const attempts = job.opts.attempts ?? 1;
    await failedAfter(job, attempts - 1);
    expect(await prisma.newsSend.count()).toBe(1);
    await failedAfter(job, attempts);
    expect(await prisma.newsSend.count()).toBe(0);
    const entries = await sendLog(admin);
    expect(entries.map((e) => e.action)).toEqual(['create', 'delete']);
    expect(entries[1]).toMatchObject({
      actorId: admin,
      actorRole: 'admin',
      oldValue: { month: '2026-11' },
    });
    await job.remove();
    const retry = await sent(admin);
    expect(retry.status).toBe(202);
    expect(retry.body).toEqual({ recipients: 2 });
    expect(await newsEmails()).toHaveLength(2);
    expect(await prisma.newsSend.count()).toBe(1);
  });

  it('saves the run with the claim, so it waits in PostgreSQL until it is queued', async () => {
    const admin = await account('admin', ['admin']);
    await consenting('andrei');
    expect((await send(admin)).status).toBe(202);
    expect((await send(admin)).status).toBe(409);
    expect(await newsJobs.getJobs(['waiting'])).toEqual([]);
    const events = await prisma.outboxEvent.findMany({
      where: { kind: 'news.sent' },
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      audience: ['admin', 'system'],
      payload: {
        month: '2026-11',
        sentBy: { accountId: admin, role: 'admin' },
        text: NEWS.text,
        title: NEWS.title,
      },
      subjectId: '2026-11',
    });
    expect(await queued()).toHaveLength(1);
    await deliver();
    expect(await newsEmails()).toHaveLength(1);
  });

  it('lets only one of ten simultaneous sends through', async () => {
    const admin = await account('admin', ['admin']);
    await consenting('andrei');
    const answers = await Promise.all(
      Array.from({ length: 10 }, () => send(admin)),
    );
    expect(answers.filter((a) => a.status === 202)).toHaveLength(1);
    expect(answers.filter((a) => a.status === 409)).toHaveLength(9);
    expect(await queued()).toHaveLength(1);
    expect(await prisma.newsSend.count()).toBe(1);
  });

  it('takes no month for a body the validation refuses', async () => {
    const admin = await account('admin', ['admin']);
    await consenting('andrei');
    expect((await send(admin, { ...NEWS, extra: 'x' })).status).toBe(400);
    expect(await prisma.newsSend.count()).toBe(0);
    expect(await queued()).toEqual([]);
  });

  it('carries markup and unicode to the message unchanged', async () => {
    const admin = await account('admin', ['admin']);
    await consenting('andrei', ['driver'], 'en');
    const body = {
      text: { en: '<b>Hi</b> \u{1F697} & "quotes"', ro: 'Ștefan și țara' },
      title: { en: 'Ünïcode title', ro: 'Titlu' },
    };
    expect((await send(admin, body)).status).toBe(202);
    await deliver();
    const [row] = await newsEmails();
    const params = row.params as unknown as NewsParams;
    expect(params.title).toBe(body.title.en);
    expect(params.text).toBe(body.text.en);
  });

  it.each([1, 2, 3, 4, 5])(
    'keeps the month after failed attempt %i of 6',
    async (made) => {
      const admin = await account('admin', ['admin']);
      await consenting('andrei');
      await send(admin);
      const [job] = await queued();
      expect(job.opts.attempts).toBe(6);
      await failedAfter(job, made);
      expect(await prisma.newsSend.count()).toBe(1);
      expect((await sendLog(admin)).map((e) => e.action)).toEqual(['create']);
    },
  );

  it('records one release when the last failure is reported twice', async () => {
    const admin = await account('admin', ['admin']);
    await consenting('andrei');
    await send(admin);
    const [job] = await queued();
    await failedAfter(job, 6);
    await failedAfter(job, 6);
    expect((await sendLog(admin)).map((e) => e.action)).toEqual([
      'create',
      'delete',
    ]);
  });

  it('writes nothing more when a finished run is delivered again', async () => {
    const admin = await account('admin', ['admin']);
    await consenting('andrei');
    await consenting('elena');
    await send(admin);
    const [job] = await queued();
    await fanOut.handle(job);
    await fanOut.handle(job);
    expect(await newsEmails()).toHaveLength(2);
  });

  it('leaves out a driver whose account was deleted before the run', async () => {
    const admin = await account('admin', ['admin']);
    const gone = await consenting('gone');
    await consenting('kept');
    await send(admin);
    await prisma.account.update({
      data: { status: 'deleted' },
      where: { id: gone },
    });
    await deliver();
    const rows = await newsEmails();
    expect(rows.map((r) => r.accountId)).not.toContain(gone);
    expect(rows).toHaveLength(1);
  });

  it('leaves out a driver who withdrew between the send and the run', async () => {
    const admin = await account('admin', ['admin']);
    await consenting('andrei');
    const elena = await consenting('elena');
    expect((await send(admin)).body).toEqual({ recipients: 2 });
    await prisma.notificationPreference.updateMany({
      data: { enabled: false, withdrawnAt: new Date('2026-11-05T10:01:00Z') },
      where: { accountId: elena },
    });
    await deliver();
    const rows = await newsEmails();
    expect(rows.map((r) => r.accountId)).not.toContain(elena);
    expect(rows).toHaveLength(1);
  });

  it('holds the e-mails of a send at night until 08:00 in Bucharest', async () => {
    const admin = await account('admin', ['admin']);
    await consenting('andrei');
    clock('2026-11-05T21:00:00Z');
    await sent(admin);
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
    expect(await queued()).toEqual([]);
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
