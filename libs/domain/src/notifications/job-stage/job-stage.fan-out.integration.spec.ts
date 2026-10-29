import { randomUUID } from 'node:crypto';

import type { OutsideChannel } from '@motor-fix/contracts';
import { Logger } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';

import { JobStageFanOut } from './job-stage.fan-out';
import { serialDatabase } from '../../auth/serial-db.testing';
import type { JobStatus } from '../../generated/prisma/enums';
import { quotesWorld } from '../../quotes/quotes.testing';
import { NotificationsModule } from '../notifications.module';
import { NotificationsService } from '../notifications.service';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
  testConfig,
  testPhone,
  testPhoneConfig,
} from '../notifications.testing';

const redisUrl = redisUrlFor(4);
const { account, car, prisma, reset } = fixtures();
const world = quotesWorld(prisma);
serialDatabase(databaseUrl);

// Noon in Bucharest, and 22:40 in Bucharest (UTC+3 in October).
const NOON = new Date('2026-10-09T09:00:00Z');
const LATE = new Date('2026-10-09T19:40:00Z');

let app: TestingModule | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
  jest.restoreAllMocks();
});

afterAll(() => prisma.$disconnect());

beforeEach(async () => {
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  await reset();
  await prisma.outboxEvent.deleteMany();
});

async function start(now = NOON) {
  app = await Test.createTestingModule({
    imports: [
      NotificationsModule.registerWorker({
        databaseUrl,
        email: testConfig('http://127.0.0.1:9'),
        phone: testPhoneConfig({ PHONE_SENDING: 'off' }),
        push: null,
        redisUrl,
      }),
    ],
  }).compile();
  await app.init();
  app.get(NotificationsService).now = () => now;
  return app.get(JobStageFanOut);
}

// Andrei's Dacia Logan, booked at Garaj Nordic with Mihai Popescu, as a job
// in the given stage.
async function job(
  status: JobStatus,
  options: { mechanic?: boolean; language?: 'ro' | 'en' } = {},
) {
  const driverId = await account('Andrei M', ['driver'], {
    language: options.language,
  });
  const carId = await car(driverId);
  const garage = await world.garage('Garaj Nordic');
  const request = await world.request(driverId, { carId, status: 'booked' });
  const quote = await world.quote(request.id, garage.id, 'accepted');
  const booking = await world.booking(quote.id, 'confirmed');
  const mechanic =
    options.mechanic === false
      ? null
      : await prisma.mechanic.create({
          data: { garageId: garage.id, name: 'Mihai Popescu' },
        });
  const row = await prisma.job.create({
    data: {
      bookingId: booking.id,
      carId,
      driverId,
      garageId: garage.id,
      mechanicId: mechanic?.id ?? null,
      status,
    },
  });
  return { driverId, garageId: garage.id, jobId: row.id, request };
}

async function event(kind: 'job.started' | 'job.done', jobId: string) {
  const payload =
    kind === 'job.done'
      ? { from: 'in_work', to: 'done' }
      : { from: 'to_do', to: 'in_work' };
  const row = await prisma.outboxEvent.create({
    data: { audience: [], kind, payload, subjectId: jobId },
  });
  return { data: { id: String(row.id), kind, payload, subjectId: jobId } };
}

const built = (kind: string) =>
  prisma.notification.findMany({ where: { fallbackOf: null, kind } });
const outside = async (kind: string) =>
  (await built(kind)).filter((m) => m.channel !== 'in_app');

const prefer = (
  accountId: string,
  type: string,
  channel: OutsideChannel,
  enabled: boolean,
) =>
  prisma.notificationPreference.create({
    data: { accountId, channel, enabled, type },
  });

const withPhone = (accountId: string) =>
  prisma.account.update({
    data: { phone: testPhone(7), phoneVerifiedAt: new Date('2026-09-01') },
    where: { id: accountId },
  });

// @traces 277-FR-003
// @traces 277-FR-004
// @traces 277-FR-005
// @traces 277-FR-009
describe('telling the driver the car is ready', () => {
  it('builds JOB_READY for the driver only, naming the garage', async () => {
    const { driverId, jobId } = await job('done');
    const fanOut = await start();

    await fanOut.handle(await event('job.done', jobId));

    const messages = await built('JOB_READY');
    expect(messages.length).toBeGreaterThan(0);
    expect(new Set(messages.map((m) => m.accountId))).toEqual(
      new Set([driverId]),
    );
    const bell = messages.find((m) => m.channel === 'in_app');
    expect(bell?.subjectId).toBe(jobId);
    expect(bell?.params).toMatchObject({ garage: 'Garaj Nordic' });
  });

  it('is sent although the driver turned every channel off', async () => {
    const { driverId, jobId } = await job('done');
    for (const channel of ['email', 'push', 'whatsapp'] as const) {
      await prefer(driverId, 'JOB_READY', channel, false);
    }
    const fanOut = await start();

    await fanOut.handle(await event('job.done', jobId));

    expect((await outside('JOB_READY')).length).toBeGreaterThan(0);
  });

  it('goes at once at 22:40, never held for the morning', async () => {
    const { jobId } = await job('done');
    const fanOut = await start(LATE);

    await fanOut.handle(await event('job.done', jobId));

    const rows = await outside('JOB_READY');
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.status).not.toBe('held');
      expect(row.sendAfter).toBeNull();
    }
  });

  it('goes by WhatsApp when the driver chose it, never by SMS', async () => {
    const { driverId, jobId } = await job('done');
    await withPhone(driverId);
    await prefer(driverId, 'JOB_READY', 'whatsapp', true);
    const fanOut = await start();

    await fanOut.handle(await event('job.done', jobId));

    const channels = (await outside('JOB_READY')).map((m) => m.channel);
    expect(channels).toContain('whatsapp');
    expect(channels).not.toContain('sms');
  });

  it('builds each message once when the same event is handled twice', async () => {
    const { jobId } = await job('done');
    const fanOut = await start();
    const done = await event('job.done', jobId);

    await fanOut.handle(done);
    const once = (await built('JOB_READY')).length;
    await fanOut.handle(done);

    expect(once).toBeGreaterThan(0);
    expect(await built('JOB_READY')).toHaveLength(once);
  });

  it('tells nobody once the job was reopened', async () => {
    const { jobId } = await job('in_work');
    const fanOut = await start();

    await fanOut.handle(await event('job.done', jobId));

    expect(await built('JOB_READY')).toEqual([]);
  });
});

// @traces 277-FR-001
// @traces 277-FR-003
// @traces 277-FR-004
// @traces 277-FR-005
// @traces 277-FR-009
describe('telling the driver work has started', () => {
  it('builds JOB_STARTED naming the mechanic by first name and the car', async () => {
    const { driverId, jobId } = await job('in_work');
    const fanOut = await start();

    await fanOut.handle(await event('job.started', jobId));

    const messages = await built('JOB_STARTED');
    expect(new Set(messages.map((m) => m.accountId))).toEqual(
      new Set([driverId]),
    );
    const bell = messages.find((m) => m.channel === 'in_app');
    expect(bell?.params).toMatchObject({ actor: 'Mihai', car: 'Dacia Logan' });
    expect(JSON.stringify(messages.map((m) => m.params))).not.toContain('B123');
  });

  it('names the garage when the team feature is off or no mechanic is set', async () => {
    const off = await job('in_work');
    await prisma.garageFeature.create({
      data: { enabled: false, garageId: off.garageId, key: 'team_mechanics' },
    });
    const fanOut = await start();

    await fanOut.handle(await event('job.started', off.jobId));
    const bell = (await built('JOB_STARTED')).find(
      (m) => m.channel === 'in_app',
    );
    expect(bell?.params).toMatchObject({ actor: 'Garaj Nordic' });
  });

  it('writes the car in English for an English driver', async () => {
    const { jobId } = await job('in_work', { language: 'en', mechanic: false });
    const fanOut = await start();

    await fanOut.handle(await event('job.started', jobId));

    const bell = (await built('JOB_STARTED')).find(
      (m) => m.channel === 'in_app',
    );
    expect(bell?.params).toMatchObject({
      actor: 'Garaj Nordic',
      car: 'the Dacia Logan',
    });
  });

  it('sends nothing outside when the driver muted it, and keeps the bell entry', async () => {
    const { driverId, jobId } = await job('in_work');
    for (const channel of ['email', 'push', 'whatsapp'] as const) {
      await prefer(driverId, 'JOB_STARTED', channel, false);
    }
    const fanOut = await start();

    await fanOut.handle(await event('job.started', jobId));

    const messages = await built('JOB_STARTED');
    expect(messages.map((m) => m.channel)).toEqual(['in_app']);
  });

  it('goes at once at 22:40, never held for the morning', async () => {
    const { jobId } = await job('in_work');
    const fanOut = await start(LATE);

    await fanOut.handle(await event('job.started', jobId));

    const rows = await outside('JOB_STARTED');
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.status).not.toBe('held');
      expect(row.sendAfter).toBeNull();
    }
  });

  it('builds each message once when the same event is handled twice', async () => {
    const { jobId } = await job('in_work');
    const fanOut = await start();
    const started = await event('job.started', jobId);

    await fanOut.handle(started);
    const once = (await built('JOB_STARTED')).length;
    await fanOut.handle(started);

    expect(once).toBeGreaterThan(0);
    expect(await built('JOB_STARTED')).toHaveLength(once);
    expect((await outside('JOB_STARTED')).map((m) => m.channel)).not.toContain(
      'sms',
    );
  });

  it('sends again for a genuine second start, a new event', async () => {
    const { jobId } = await job('in_work');
    const fanOut = await start();

    await fanOut.handle(await event('job.started', jobId));
    const once = (await built('JOB_STARTED')).length;
    await fanOut.handle(await event('job.started', jobId));

    expect(once).toBeGreaterThan(0);
    expect(await built('JOB_STARTED')).toHaveLength(once * 2);
  });

  it('tells nobody about a job that is gone', async () => {
    const fanOut = await start();

    await fanOut.handle(await event('job.started', randomUUID()));

    expect(await built('JOB_STARTED')).toEqual([]);
  });

  it('tells nobody about a cancelled job', async () => {
    const { jobId } = await job('cancelled');
    const fanOut = await start();

    await fanOut.handle(await event('job.started', jobId));

    expect(await built('JOB_STARTED')).toEqual([]);
  });
});
