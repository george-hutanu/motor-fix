import { NEWS_CONSENT_TEXT_VERSION } from '@motor-fix/contracts';
import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Queue } from 'bullmq';

import { NEWS_QUEUE, NEWS_RUN, type NewsRun } from './news.fan-out';
import { NotificationsModule } from './notifications.module';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
  testConfig,
  testPhoneConfig,
} from './notifications.testing';
import { serialDatabase } from '../auth/serial-db.testing';

const redisUrl = redisUrlFor(6);
const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);

const newsJobs = new Queue<NewsRun>(NEWS_QUEUE, {
  connection: { url: redisUrl },
});

afterAll(async () => {
  await newsJobs.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await reset();
  await newsJobs.obliterate({ force: true });
});

async function consenting(name: string) {
  const id = await account(name, ['driver']);
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

const worker = (tokenSecret?: string) =>
  Test.createTestingModule({
    imports: [
      NotificationsModule.registerWorker({
        databaseUrl,
        email: testConfig('http://127.0.0.1:9', { EMAIL_SENDING: 'off' }),
        phone: testPhoneConfig({ PHONE_SENDING: 'off' }),
        redisUrl,
        tokenSecret,
      }),
    ],
  }).compile();

async function queueRun(admin: string) {
  const run: NewsRun = {
    month: '2026-11',
    sentBy: { accountId: admin, role: 'admin' },
    text: { en: 'News', ro: 'Noutăți' },
    title: { en: 'News for November', ro: 'Noutăți din noiembrie' },
  };
  await newsJobs.add('fan-out', run, { ...NEWS_RUN, jobId: 'news-2026-11' });
}

const newsEmails = () =>
  prisma.notification.findMany({ where: { channel: 'email', kind: 'NEWS' } });

describe('the news worker', () => {
  it('runs a queued news run, one message per consenting driver', async () => {
    const admin = await account('admin', ['admin']);
    const andrei = await consenting('andrei');
    const elena = await consenting('elena');
    const app = await worker('test-secret');
    await app.init();
    try {
      await queueRun(admin);
      const deadline = Date.now() + 10_000;
      while ((await newsEmails()).length < 2 && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 100));
      }
    } finally {
      await app.close();
    }
    const rows = await newsEmails();
    expect(rows.map((r) => r.accountId).sort()).toEqual([andrei, elena].sort());
  }, 20_000);

  it('leaves the run queued and says why when it has no token secret', async () => {
    const error = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const admin = await account('admin', ['admin']);
    await consenting('andrei');
    const app = await worker(undefined);
    await app.init();
    try {
      await queueRun(admin);
      await new Promise((r) => setTimeout(r, 1_000));
    } finally {
      await app.close();
    }
    const logged = error.mock.calls.flat().join('\n');
    error.mockRestore();
    expect(await newsEmails()).toEqual([]);
    expect(await newsJobs.getJobState('news-2026-11')).toBe('waiting');
    expect(logged).toContain('AUTH_TOKEN_SECRET');
  }, 20_000);
});
