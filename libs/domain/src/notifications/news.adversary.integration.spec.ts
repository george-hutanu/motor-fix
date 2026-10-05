import { NEWS_CONSENT_TEXT_VERSION } from '@motor-fix/contracts';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { type Job, Queue } from 'bullmq';
import request from 'supertest';

import { unsubscribedAccount } from './news';
import {
  NEWS_JOBS,
  NEWS_QUEUE,
  NewsFanOut,
  type NewsRun,
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

const redisUrl = redisUrlFor(6);
const tokenSecret = 'test-secret';
const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);

let app: INestApplication;
let fanOut: NewsFanOut;
const newsJobs = new Queue<NewsRun>(NEWS_QUEUE, {
  connection: { url: redisUrl },
});

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
  await prisma.$disconnect();
});

beforeEach(async () => {
  await reset();
  await prisma.newsSend.deleteMany();
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

const queued = () => newsJobs.getJobs(['waiting', 'delayed', 'prioritized']);

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
const failedAfter = (job: Job<NewsRun>, made: number) =>
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

const makeAdmin = () => account('admin', ['admin']);

const failingFrom = (call: number) => {
  const notifications = app.get(NotificationsService);
  const notify = notifications.notify;
  let calls = 0;
  notifications.notify = (input) => {
    calls += 1;
    if (calls >= call) return Promise.reject(new Error('redis down'));
    return notify.call(notifications, input);
  };
  return () => {
    notifications.notify = notify;
  };
};

const deletes = async (admin: string) =>
  (await sendLog(admin)).filter((e) => e.action === 'delete');

describe('a send while the month is queued', () => {
  it('refuses a second send and keeps the first job and its content', async () => {
    const admin = await makeAdmin();
    const other = await account('other-admin', ['admin']);
    await consenting('andrei');
    expect((await send(admin)).status).toBe(202);
    const again = await send(other, {
      text: { en: 'Other', ro: 'Altceva' },
      title: { en: 'Other', ro: 'Altceva' },
    });
    expect(again.status).toBe(409);
    const jobs = await queued();
    expect(jobs).toHaveLength(1);
    expect(jobs[0].data).toEqual({
      month: '2026-11',
      sentBy: { accountId: admin, role: 'admin' },
      text: NEWS.text,
      title: NEWS.title,
    });
  });

  it('lets only one of ten simultaneous sends queue a job', async () => {
    const admin = await makeAdmin();
    await consenting('andrei');
    const answers = await Promise.all(
      Array.from({ length: 10 }, () => send(admin)),
    );
    expect(answers.filter((a) => a.status === 202)).toHaveLength(1);
    expect(answers.filter((a) => a.status === 409)).toHaveLength(9);
    expect(await queued()).toHaveLength(1);
    expect(await prisma.newsSend.count()).toBe(1);
  });

  it('queues a separate job for the next month while the first is still waiting', async () => {
    const admin = await makeAdmin();
    await consenting('andrei');
    expect((await send(admin)).status).toBe(202);
    clock('2026-12-02T10:00:00Z');
    expect((await send(admin)).status).toBe(202);
    const ids = (await queued()).map((j) => j.id).sort();
    expect(ids).toEqual(['news-2026-11', 'news-2026-12']);
  });

  it('writes no news message for a large list in the request', async () => {
    const admin = await makeAdmin();
    for (let i = 0; i < 40; i += 1) await consenting(`driver-${i}`);
    const res = await send(admin);
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ recipients: 40 });
    expect(await newsEmails()).toEqual([]);
  });

  it('carries text with markup and unicode to the message unchanged', async () => {
    const admin = await makeAdmin();
    const driver = await consenting('andrei', ['driver'], 'en');
    const body = {
      text: { en: '<b>Hi</b> \u{1F697} & "quotes"', ro: 'Ștefan și țara' },
      title: { en: 'Ünïcode ‮ title', ro: 'Titlu' },
    };
    expect((await send(admin, body)).status).toBe(202);
    await deliver();
    const [row] = await newsEmails();
    expect(row.accountId).toBe(driver);
    const params = row.params as unknown as NewsParams;
    expect(params.title).toBe(body.title.en);
    expect(params.text).toBe(body.text.en);
  });
});

describe('a run that fails and is tried again', () => {
  it.each([1, 2, 3])(
    'reaches each of three drivers once when it fails at message %i and is retried',
    async (failAt) => {
      const admin = await makeAdmin();
      for (const name of ['a', 'b', 'c']) await consenting(name);
      expect((await send(admin)).status).toBe(202);
      const [job] = await queued();
      const restore = failingOn(failAt);
      try {
        await expect(fanOut.handle(job)).rejects.toThrow('redis down');
      } finally {
        restore();
      }
      await failedAfter(job, 1);
      await fanOut.handle(job);
      const rows = await newsEmails();
      expect(rows).toHaveLength(3);
      expect(new Set(rows.map((r) => r.accountId)).size).toBe(3);
    },
  );

  it('survives every retry failing early and still reaches each driver once at the end', async () => {
    const admin = await makeAdmin();
    for (const name of ['a', 'b', 'c']) await consenting(name);
    await send(admin);
    const [job] = await queued();
    for (const made of [1, 2, 3]) {
      const restore = failingOn(made);
      try {
        await expect(fanOut.handle(job)).rejects.toThrow('redis down');
      } finally {
        restore();
      }
      await failedAfter(job, made);
    }
    await fanOut.handle(job);
    const rows = await newsEmails();
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((r) => r.accountId)).size).toBe(3);
    expect(await prisma.newsSend.count()).toBe(1);
  });

  it('writes nothing more when a finished run is delivered a second time', async () => {
    const admin = await makeAdmin();
    await consenting('andrei');
    await consenting('elena');
    await send(admin);
    const [job] = await queued();
    await fanOut.handle(job);
    await fanOut.handle(job);
    expect(await newsEmails()).toHaveLength(2);
  });

  it('keeps each driver on their own unsubscribe link across a retry', async () => {
    const admin = await makeAdmin();
    const a = await consenting('a', ['driver'], 'en');
    const b = await consenting('b', ['driver'], 'ro');
    await send(admin);
    const [job] = await queued();
    const restore = failingOn(2);
    try {
      await expect(fanOut.handle(job)).rejects.toThrow();
    } finally {
      restore();
    }
    await fanOut.handle(job);
    for (const row of await newsEmails()) {
      const params = row.params as unknown as NewsParams;
      const token = params.unsubscribe.split('/').at(-1)!;
      expect(unsubscribedAccount(token, tokenSecret)).toBe(row.accountId);
      expect([a, b]).toContain(row.accountId);
    }
  });

  it('skips a driver who withdrew after the first attempt and before the retry', async () => {
    const admin = await makeAdmin();
    await consenting('a');
    const b = await consenting('b');
    await send(admin);
    const [job] = await queued();
    const restore = failingFrom(2);
    try {
      await expect(fanOut.handle(job)).rejects.toThrow();
    } finally {
      restore();
    }
    const written = (await newsEmails()).map((r) => r.accountId);
    const late = written.includes(b) ? written.find((id) => id !== b)! : b;
    await prisma.notificationPreference.updateMany({
      data: { enabled: false, withdrawnAt: new Date('2026-11-05T10:02:00Z') },
      where: { accountId: late },
    });
    await fanOut.handle(job);
    const rows = await newsEmails();
    expect(rows.filter((r) => r.accountId === late).length).toBeLessThanOrEqual(
      1,
    );
    expect(new Set(rows.map((r) => r.accountId)).size).toBe(rows.length);
  });

  it('does nothing and does not throw for a run with no consenting drivers', async () => {
    const admin = await makeAdmin();
    await send(admin);
    const [job] = await queued();
    await expect(fanOut.handle(job)).resolves.toBeUndefined();
    expect(await newsEmails()).toEqual([]);
    expect(await prisma.newsSend.count()).toBe(1);
  });

  it('leaves out a driver whose account was deleted before the run', async () => {
    const admin = await makeAdmin();
    const gone = await consenting('gone');
    await consenting('kept');
    await send(admin);
    await prisma.account.update({
      data: { status: 'deleted' },
      where: { id: gone },
    });
    await deliver();
    const rows = await newsEmails();
    expect(rows).toHaveLength(1);
    expect(rows[0].accountId).not.toBe(gone);
  });
});

describe('a failure and the month', () => {
  it.each([1, 2, 3, 4, 5])(
    'keeps the month after failed attempt %i of 6',
    async (made) => {
      const admin = await makeAdmin();
      await consenting('andrei');
      await send(admin);
      const [job] = await queued();
      expect(job.opts.attempts).toBe(6);
      await failedAfter(job, made);
      expect(await prisma.newsSend.count()).toBe(1);
      expect(await deletes(admin)).toEqual([]);
      expect((await send(admin)).status).toBe(409);
    },
  );

  it('gives the month back after attempt 6 of 6 and records one release', async () => {
    const admin = await makeAdmin();
    await consenting('andrei');
    await send(admin);
    const [job] = await queued();
    await failedAfter(job, 6);
    expect(await prisma.newsSend.count()).toBe(0);
    const released = await deletes(admin);
    expect(released).toHaveLength(1);
    expect(released[0]).toMatchObject({
      actorId: admin,
      actorRole: 'admin',
      oldValue: { month: '2026-11' },
    });
  });

  it('gives the month back when attempts made exceeds the attempts allowed', async () => {
    const admin = await makeAdmin();
    await consenting('andrei');
    await send(admin);
    const [job] = await queued();
    await failedAfter(job, 9);
    expect(await prisma.newsSend.count()).toBe(0);
  });

  it('gives the month back after one failed attempt when the job allows only one', async () => {
    const admin = await makeAdmin();
    await consenting('andrei');
    await send(admin);
    const [job] = await queued();
    await fanOut.failed(
      { attemptsMade: 1, data: job.data, opts: { attempts: 1 } },
      new Error('redis down'),
    );
    expect(await prisma.newsSend.count()).toBe(0);
  });

  it('treats a job with no attempts setting as a single attempt', async () => {
    const admin = await makeAdmin();
    await consenting('andrei');
    await send(admin);
    const [job] = await queued();
    await fanOut.failed(
      { attemptsMade: 1, data: job.data, opts: {} },
      new Error('redis down'),
    );
    expect(await prisma.newsSend.count()).toBe(0);
  });

  it('records one release when the final failure is reported twice', async () => {
    const admin = await makeAdmin();
    await consenting('andrei');
    await send(admin);
    const [job] = await queued();
    await failedAfter(job, 6);
    await failedAfter(job, 6);
    expect(await deletes(admin)).toHaveLength(1);
  });

  it('gives back only the failed job’s month and leaves another month claimed', async () => {
    const admin = await makeAdmin();
    await consenting('andrei');
    await send(admin);
    const [november] = await queued();
    clock('2026-12-02T10:00:00Z');
    expect((await send(admin)).status).toBe(202);
    await failedAfter(november, 6);
    const months = await prisma.newsSend.findMany();
    expect(months).toHaveLength(1);
    expect(JSON.stringify(months[0])).toContain('2026-12');
  });

  it('records the release against the sender who sent, not whoever failed the job later', async () => {
    const admin = await makeAdmin();
    const other = await account('other-admin', ['admin']);
    await consenting('andrei');
    await send(admin);
    const [job] = await queued();
    await failedAfter(job, 6);
    expect(await deletes(admin)).toHaveLength(1);
    expect(await deletes(other)).toEqual([]);
  });

  it('lets the same month be sent and delivered again after the last attempt failed', async () => {
    const admin = await makeAdmin();
    await consenting('andrei');
    await send(admin);
    const [job] = await queued();
    const restore = failingFrom(1);
    try {
      await expect(fanOut.handle(job)).rejects.toThrow();
    } finally {
      restore();
    }
    await failedAfter(job, 6);
    await job.remove();
    expect((await sent(admin)).status).toBe(202);
    expect(await newsEmails()).toHaveLength(1);
    expect(await queued()).toEqual([]);
  });

  it('does not throw when the last-attempt failure finds the month already given back', async () => {
    const admin = await makeAdmin();
    await consenting('andrei');
    await send(admin);
    const [job] = await queued();
    await prisma.newsSend.deleteMany();
    await expect(failedAfter(job, 6)).resolves.toBeUndefined();
  });
});

describe('a send that cannot be queued', () => {
  const failQueue = (reason: unknown) => {
    const jobs = app.get<Queue>(NEWS_JOBS);
    const add = jobs.add;
    jobs.add = () => Promise.reject(reason);
    return () => {
      jobs.add = add;
    };
  };

  it('gives the month back and answers 500 for a rejection that is not an Error', async () => {
    const admin = await makeAdmin();
    await consenting('andrei');
    const restore = failQueue('connection reset');
    try {
      expect((await send(admin)).status).toBe(500);
    } finally {
      restore();
    }
    expect(await prisma.newsSend.count()).toBe(0);
    expect(await deletes(admin)).toHaveLength(1);
  });

  it('leaves no job and no message behind', async () => {
    const admin = await makeAdmin();
    await consenting('andrei');
    const restore = failQueue(new Error('redis down'));
    try {
      await send(admin);
    } finally {
      restore();
    }
    expect(await queued()).toEqual([]);
    expect(await newsEmails()).toEqual([]);
  });

  it('keeps another month’s claim when this month’s queueing fails', async () => {
    const admin = await makeAdmin();
    await consenting('andrei');
    await send(admin);
    clock('2026-12-02T10:00:00Z');
    const restore = failQueue(new Error('redis down'));
    try {
      expect((await send(admin)).status).toBe(500);
    } finally {
      restore();
    }
    expect(await prisma.newsSend.count()).toBe(1);
    clock('2026-11-20T10:00:00Z');
    expect((await send(admin)).status).toBe(409);
  });

  it('lets a failing and a succeeding send race with exactly one claim left', async () => {
    const admin = await makeAdmin();
    await consenting('andrei');
    const restore = failQueue(new Error('redis down'));
    try {
      await send(admin);
    } finally {
      restore();
    }
    const answers = await Promise.all([send(admin), send(admin)]);
    expect(answers.map((a) => a.status).sort()).toEqual([202, 409]);
    expect(await prisma.newsSend.count()).toBe(1);
    expect(await queued()).toHaveLength(1);
  });

  it('does not take the month for a body the validation refuses', async () => {
    const admin = await makeAdmin();
    await consenting('andrei');
    const res = await send(admin, { ...NEWS, extra: 'x' });
    expect(res.status).toBe(400);
    expect(await prisma.newsSend.count()).toBe(0);
    expect(await queued()).toEqual([]);
  });
});
