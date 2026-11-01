// @traces 523-FR-001 523-FR-004 523-FR-011 523-FR-012 523-FR-014
import { randomUUID } from 'node:crypto';

import { Logger } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';

import { Brevo } from './brevo/brevo';
import { BrevoMock } from './brevo/brevo-mock.testing';
import { NotificationsProcessor } from './notifications.processor';
import { NotificationsService } from './notifications.service';
import {
  claimAgo,
  databaseUrl,
  fixtures,
  redisUrlFor,
  testConfig,
  testPhoneConfig,
} from './notifications.testing';
import { AuditService } from '../audit/audit.service';
import { serialDatabase } from '../auth/serial-db.testing';
import type { Prisma } from '../generated/prisma/client';

const redisUrl = redisUrlFor(12);
const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);

const mock = new BrevoMock();
const queue = new Queue('notifications', { connection: { url: redisUrl } });
const publisher = new Redis(redisUrl);

const NOW = new Date('2026-10-05T11:00:00Z');
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);
const secondsAgo = (s: number) => new Date(NOW.getTime() - s * 1000);

let service: NotificationsService;
let processor: NotificationsProcessor;
let owner: string;

function build(jobs: unknown = queue) {
  const config = testConfig(mock.url);
  service = new NotificationsService(
    prisma,
    jobs as Queue,
    publisher,
    config,
    null,
    new AuditService(),
  );
  service.now = () => NOW;
  processor = new NotificationsProcessor(
    prisma,
    service,
    new Brevo({ apiKey: config.apiKey ?? '', apiUrl: config.apiUrl }),
    config,
    testPhoneConfig({ PHONE_SENDING: 'off', WHATSAPP_SENDER: '' }),
  );
  processor.now = () => NOW;
}

const QUOTE = {
  garage: 'Atelier Dinamo',
  link: 'https://motorfix.test/app/driver/requests/r-1',
  range: '450–600',
};

const row = (data: Partial<Prisma.NotificationUncheckedCreateInput> = {}) =>
  prisma.notification.create({
    data: {
      accountId: owner,
      channel: 'email',
      createdAt: minutesAgo(20),
      eventId: randomUUID(),
      kind: 'QUOTE_RECEIVED',
      params: QUOTE,
      status: 'queued',
      ...data,
    },
  });

const held = (data: Partial<Prisma.NotificationUncheckedCreateInput> = {}) =>
  row({ sendAfter: minutesAgo(9), status: 'held', ...data });

const reload = (id: string) =>
  prisma.notification.findUniqueOrThrow({ where: { id } });
const flushJob = (leaderId: string) =>
  processor.handle({ attemptsMade: 0, data: { leaderId }, name: 'flush' });
const subjects = () =>
  mock.emails().map((e) => (e.body as { subject: string }).subject);

beforeAll(() => mock.start());

afterAll(async () => {
  await queue.close();
  publisher.disconnect();
  await mock.stop();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await reset();
  await queue.obliterate({ force: true });
  mock.reset();
  build();
  owner = await account('andrei');
});

afterEach(() => vi.restoreAllMocks());

describe('the held sweep at its edges', () => {
  it('answers zero and adds nothing when nothing is held', async () => {
    await expect(service.requeueHeld()).resolves.toBe(0);
    expect(await queue.getJobs()).toEqual([]);
  });

  it('leaves a held row exactly five minutes past its send time', async () => {
    const edge = await held({ sendAfter: minutesAgo(5) });
    await expect(service.requeueHeld()).resolves.toBe(0);
    expect(await queue.getJob(`send-${edge.id}`)).toBeUndefined();
  });

  it('takes a held row one second past five minutes', async () => {
    const past = await held({ sendAfter: secondsAgo(301) });
    await expect(service.requeueHeld()).resolves.toBe(1);
    expect(await queue.getJob(`send-${past.id}`)).toBeDefined();
  });

  it('leaves a held row with no send time', async () => {
    const open = await held({ sendAfter: null });
    await expect(service.requeueHeld()).resolves.toBe(0);
    expect(await queue.getJob(`send-${open.id}`)).toBeUndefined();
  });

  it('leaves a held row whose claim lapsed long ago', async () => {
    const claimed = await held();
    await claimAgo(prisma, claimed.id, 3_600_000);
    await expect(service.requeueHeld()).resolves.toBe(0);
    expect(await queue.getJob(`send-${claimed.id}`)).toBeUndefined();
  });

  it('leaves a held row that carries an SMS being-sent mark', async () => {
    const sms = await held({ channel: 'sms', sendingAt: minutesAgo(9) });
    await expect(service.requeueHeld()).resolves.toBe(0);
    expect(await queue.getJob(`send-${sms.id}`)).toBeUndefined();
  });

  it('leaves queued, sent and failed rows to their own sweep', async () => {
    await Promise.all([
      row({ sendAfter: minutesAgo(9) }),
      row({ sendAfter: minutesAgo(9), sentAt: minutesAgo(9), status: 'sent' }),
      row({
        failure: 'no_address',
        sendAfter: minutesAgo(9),
        status: 'failed',
      }),
    ]);
    await expect(service.requeueHeld()).resolves.toBe(0);
    expect(await queue.getJobs()).toEqual([]);
  });

  it('gives a follower whose leader row was deleted a send job of its own', async () => {
    const leader = await row({ sentAt: minutesAgo(20), status: 'sent' });
    const follower = await held({ groupLeaderId: leader.id });
    await prisma.notification.delete({ where: { id: leader.id } });
    await expect(service.requeueHeld()).resolves.toBe(1);
    expect(await queue.getJob(`send-${follower.id}`)).toBeDefined();
  });

  it('adds nothing for a held row whose job sits in the kept-failed set', async () => {
    const poisoned = await held();
    await queue.add(
      'send',
      { id: poisoned.id },
      { attempts: 1, jobId: `send-${poisoned.id}`, removeOnFail: 1000 },
    );
    const worker = new Worker(
      'notifications',
      () => Promise.reject(new Error('poison')),
      { connection: { url: redisUrl } },
    );
    await new Promise((resolve) => worker.once('failed', resolve));
    await worker.close();
    await service.requeueHeld();
    expect(await queue.getJobCounts('waiting', 'failed')).toEqual({
      failed: 1,
      waiting: 0,
    });
  });

  it('gives eight followers of one leader a single flush job', async () => {
    const leader = await row({ sentAt: minutesAgo(20), status: 'sent' });
    await Promise.all(
      Array.from({ length: 8 }, () => held({ groupLeaderId: leader.id })),
    );
    await service.requeueHeld();
    const jobs = await queue.getJobs(['waiting', 'delayed']);
    expect(jobs.map((j) => j.id)).toEqual([`flush-${leader.id}`]);
  });

  it('twice in a row leaves the same jobs and sends the window once', async () => {
    const leader = await row({ sentAt: minutesAgo(20), status: 'sent' });
    const followers = await Promise.all([
      held({ groupLeaderId: leader.id }),
      held({ groupLeaderId: leader.id }),
    ]);
    await service.requeueHeld();
    await service.requeueHeld();
    expect(await queue.getJobs(['waiting', 'delayed'])).toHaveLength(1);
    await flushJob(leader.id);
    await flushJob(leader.id);
    expect(subjects()).toEqual(['2 oferte noi']);
    for (const f of followers) expect((await reload(f.id)).status).toBe('sent');
  });

  it('names ten ids and the ellipsis when twelve held rows are re-queued', async () => {
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const ids: string[] = [];
    for (let i = 0; i < 12; i += 1) ids.push((await held()).id);
    await expect(service.requeueHeld()).resolves.toBe(12);
    const [line] = warn.mock.calls
      .map(([text]) => String(text))
      .filter((text) => text.includes('re-queued 12 '));
    expect(line).toBeDefined();
    expect(ids.filter((id) => line.includes(id))).toHaveLength(10);
    expect(line).toMatch(/…$/);
  });

  it('names all ten ids and no ellipsis when exactly ten are re-queued', async () => {
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const ids: string[] = [];
    for (let i = 0; i < 10; i += 1) ids.push((await held()).id);
    await service.requeueHeld();
    const [line] = warn.mock.calls
      .map(([text]) => String(text))
      .filter((text) => text.includes('re-queued 10 '));
    expect(ids.every((id) => line.includes(id))).toBe(true);
    expect(line).not.toContain('…');
  });

  it('counts nothing when the queue refuses the add and leaves the rows held', async () => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    build({ addBulk: () => Promise.reject(new Error('Redis down')) });
    const h = await held();
    await expect(service.requeueHeld()).resolves.toBe(0);
    expect(await reload(h.id)).toEqual(h);
  });

  it('does not take a recent held row when given a later time', async () => {
    const h = await held({ sendAfter: minutesAgo(1) });
    await expect(service.requeueHeld(minutesAgo(-10))).resolves.toBe(1);
    expect(await queue.getJob(`send-${h.id}`)).toBeDefined();
  });
});

describe('the flush job on odd windows', () => {
  it('finishes without sending for a leader that does not exist', async () => {
    await expect(flushJob(randomUUID())).resolves.toBeUndefined();
    expect(mock.emails()).toEqual([]);
  });

  it('finishes without sending when every follower is already sent', async () => {
    const leader = await row({ sentAt: minutesAgo(20), status: 'sent' });
    await row({
      groupLeaderId: leader.id,
      sentAt: minutesAgo(9),
      status: 'sent',
    });
    await expect(flushJob(leader.id)).resolves.toBeUndefined();
    expect(mock.emails()).toEqual([]);
  });

  it('sends thirty followers as one e-mail naming their count', async () => {
    const leader = await row({ sentAt: minutesAgo(20), status: 'sent' });
    await Promise.all(
      Array.from({ length: 30 }, () => held({ groupLeaderId: leader.id })),
    );
    await flushJob(leader.id);
    expect(subjects()).toEqual(['30 de oferte noi']);
    expect(
      await prisma.notification.count({
        where: { groupLeaderId: leader.id, status: 'sent' },
      }),
    ).toBe(30);
  });

  it('leaves the held rows of another leader alone', async () => {
    const a = await row({ sentAt: minutesAgo(20), status: 'sent' });
    const b = await row({ sentAt: minutesAgo(20), status: 'sent' });
    const mine = await held({ groupLeaderId: a.id });
    const theirs = await held({ groupLeaderId: b.id });
    await flushJob(a.id);
    expect((await reload(mine.id)).status).toBe('sent');
    expect(await reload(theirs.id)).toMatchObject({
      claimedAt: null,
      status: 'held',
    });
  });

  it('three flushes at once send one e-mail', async () => {
    const leader = await row({ sentAt: minutesAgo(20), status: 'sent' });
    await Promise.all([
      held({ groupLeaderId: leader.id }),
      held({ groupLeaderId: leader.id }),
    ]);
    const results = await Promise.allSettled([
      flushJob(leader.id),
      flushJob(leader.id),
      flushJob(leader.id),
    ]);
    expect(mock.emails()).toHaveLength(1);
    expect(
      results.filter((r) => r.status === 'fulfilled').length,
    ).toBeGreaterThan(0);
    expect(
      await prisma.notification.count({
        where: { groupLeaderId: leader.id, status: 'sent' },
      }),
    ).toBe(2);
  });

  it('fails every follower of a deleted account without calling Brevo', async () => {
    const gone = await account('gone', ['driver'], { status: 'deleted' });
    const leader = await row({
      accountId: gone,
      sentAt: minutesAgo(20),
      status: 'sent',
    });
    const followers = await Promise.all([
      held({ accountId: gone, groupLeaderId: leader.id }),
      held({ accountId: gone, groupLeaderId: leader.id }),
    ]);
    await flushJob(leader.id);
    expect(mock.emails()).toEqual([]);
    for (const f of followers) {
      expect(await reload(f.id)).toMatchObject({
        claimedAt: null,
        failure: 'account_deleted',
        status: 'failed',
      });
    }
  });

  it('releases its claims when the provider refuses for good', async () => {
    const leader = await row({ sentAt: minutesAgo(20), status: 'sent' });
    const followers = await Promise.all([
      held({ groupLeaderId: leader.id }),
      held({ groupLeaderId: leader.id }),
    ]);
    mock.answer({ status: 400 });
    await flushJob(leader.id);
    for (const f of followers) {
      expect(await reload(f.id)).toMatchObject({
        claimedAt: null,
        status: 'failed',
      });
    }
  });

  it('sends followers that join during each of two successive sends', async () => {
    const leader = await row({ sentAt: minutesAgo(20), status: 'sent' });
    await held({ groupLeaderId: leader.id });
    await held({ groupLeaderId: leader.id });
    const send = Brevo.prototype.send;
    let calls = 0;
    vi.spyOn(Brevo.prototype, 'send').mockImplementation(async function (
      this: Brevo,
      mail,
    ) {
      calls += 1;
      if (calls <= 2) {
        await held({ groupLeaderId: leader.id });
        if (calls === 2) await held({ groupLeaderId: leader.id });
      }
      return send.call(this, mail);
    });
    await flushJob(leader.id);
    expect(
      await prisma.notification.count({
        where: { groupLeaderId: leader.id, status: 'held' },
      }),
    ).toBe(0);
    expect(mock.emails().length).toBeGreaterThanOrEqual(3);
  });

  it('does not re-send a row of the window that a second flush already sent', async () => {
    const leader = await row({ sentAt: minutesAgo(20), status: 'sent' });
    await held({ groupLeaderId: leader.id });
    await held({ groupLeaderId: leader.id });
    await flushJob(leader.id);
    await flushJob(leader.id);
    expect(mock.emails()).toHaveLength(1);
  });
});

describe('the requeue job when one pass fails', () => {
  it('still sweeps held rows when the queued pass cannot read', async () => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const h = await held();
    const real = prisma.notification.findMany.bind(prisma.notification);
    let reads = 0;
    vi.spyOn(prisma.notification, 'findMany').mockImplementation(((
      args: never,
    ) =>
      ++reads === 1
        ? Promise.reject(new Error('db down'))
        : real(args)) as never);
    await processor
      .handle({ attemptsMade: 0, data: {}, name: 'requeue' })
      .catch(() => undefined);
    expect(await queue.getJob(`send-${h.id}`)).toBeDefined();
  });

  it('still sweeps queued rows when the held pass cannot add', async () => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const stranded = await row();
    await held();
    let adds = 0;
    build({
      addBulk: (...args: Parameters<Queue['addBulk']>) =>
        ++adds === 2
          ? Promise.reject(new Error('Redis down'))
          : queue.addBulk(...args),
    });
    await processor
      .handle({ attemptsMade: 0, data: {}, name: 'requeue' })
      .catch(() => undefined);
    expect(await queue.getJob(`send-${stranded.id}`)).toBeDefined();
  });
});
