import { Queue } from 'bullmq';
import { Redis } from 'ioredis';

import { NotificationsService } from './notifications.service';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
  testConfig,
} from './notifications.testing';
import { AuditService } from '../audit/audit.service';
import { serialDatabase } from '../auth/serial-db.testing';

const redisUrl = redisUrlFor(12);
const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);

const queue = new Queue('notifications', { connection: { url: redisUrl } });
const publisher = new Redis(redisUrl);
const pushConfig = {
  privateKey: 'private',
  publicKey: 'public',
  subject: 'mailto:ops@example.test',
};

let service: NotificationsService;

afterAll(async () => {
  await queue.close();
  publisher.disconnect();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await reset();
  await queue.obliterate({ force: true });
  service = new NotificationsService(
    prisma,
    queue,
    publisher,
    testConfig('http://127.0.0.1:1'),
    pushConfig,
    new AuditService(),
  );
  // 14:00 in Bucharest, outside quiet hours.
  service.now = () => new Date('2026-10-05T11:00:00Z');
});

const written = async (accountId: string) =>
  (
    await prisma.notification.findMany({
      orderBy: [{ kind: 'asc' }, { channel: 'asc' }],
      where: { accountId },
    })
  ).map((row) => [row.kind, row.channel, row.status]);

const queuedFor = async (accountId: string) => {
  const ids = new Set(
    (
      await prisma.notification.findMany({
        select: { id: true },
        where: { accountId },
      })
    ).map((row) => row.id),
  );
  return (await queue.getJobs(['waiting', 'delayed', 'prioritized'])).filter(
    (job) => ids.has((job.data as { id: string }).id),
  ).length;
};

// @traces 1204-FR-006
describe('messages to an account that has not accepted the texts in force', () => {
  it('are written and handed to their channels as for an account that has', async () => {
    const current = await account('current');
    const pending = await account('pending');
    await prisma.accountConsent.updateMany({
      data: { textVersion: '2026-10-11' },
      where: { accountId: pending },
    });

    for (const kind of ['JOB_READY', 'BOOKING_REMINDER'] as const) {
      await service.notify({
        eventId: `evt-${kind}`,
        kind,
        recipients: [current, pending],
      });
    }

    const rows = await written(current);
    expect(rows.length).toBeGreaterThan(0);
    expect(await written(pending)).toEqual(rows);
    expect(await queuedFor(pending)).toBe(await queuedFor(current));
    expect(await queuedFor(pending)).toBeGreaterThan(0);
  });
});
