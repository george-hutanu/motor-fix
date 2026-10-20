import { randomUUID } from 'node:crypto';

import { Logger } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';

import {
  CATALOGUE_JOB_PENDING_CONSUMER,
  CatalogueJobPendingFanOut,
} from './catalogue-job-pending.fan-out';
import { AuditService } from '../../audit/audit.service';
import { serialDatabase } from '../../auth/serial-db.testing';
import { outbox } from '../../events/event.port';
import { GaragePricesService } from '../../garages/prices/garage-prices/garage-prices.service';
import { NotificationsModule } from '../notifications.module';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
  testConfig,
  testPhoneConfig,
} from '../notifications.testing';
import { bellText } from '../templates';

// @traces 1352-FR-015

const redisUrl = redisUrlFor(13);
const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);

const KIND = 'ADMIN_CATALOGUE_JOB_PENDING';
const NAME = 'Recondiționare injectoare';

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
  await prisma.$executeRawUnsafe('TRUNCATE job_type CASCADE');
  await prisma.outboxEvent.deleteMany();
});

async function start() {
  app = await Test.createTestingModule({
    imports: [
      NotificationsModule.registerWorker({
        databaseUrl,
        email: testConfig('http://127.0.0.1:9'),
        phone: testPhoneConfig({ PHONE_SENDING: 'off' }),
        push: {
          privateKey: 'private',
          publicKey: 'public',
          subject: 'mailto:ops@example.test',
        },
        redisUrl,
      }),
    ],
  }).compile();
  await app.init();
  return app.get(CatalogueJobPendingFanOut);
}

// Service Auto Nord and its owner, and the two admins MotorFix has: Ioana
// in Romanian and Dan in English; a third admin is suspended.
async function people() {
  const garage = await prisma.garage.create({
    data: { name: 'Service Auto Nord', slug: `nord-${randomUUID()}` },
  });
  const owner = await account('mihai', ['garage']);
  await prisma.garageMember.create({
    data: { accountId: owner, garageId: garage.id, role: 'owner' },
  });
  return {
    dan: await account('Dan', ['admin'], { language: 'en' }),
    garage,
    gone: await account('Gone', ['admin'], { status: 'suspended' }),
    ioana: await account('Ioana', ['admin']),
    owner,
  };
}

// The relay's job for the event a proposal saved.
async function jobFor(jobTypeId: string) {
  const event = await prisma.outboxEvent.findFirstOrThrow({
    where: { kind: 'catalogue_job.proposed', subjectId: jobTypeId },
  });
  return {
    event,
    job: {
      data: {
        id: String(event.id),
        kind: event.kind,
        payload: event.payload as never,
        subjectId: jobTypeId,
      },
    },
  };
}

// A proposal as the owner's own write saves it: the pending job and the
// admins' event.
async function proposed(garageId: string) {
  const jobType = await prisma.jobType.create({
    data: {
      key: `injectoare-${randomUUID()}`,
      nameEn: NAME,
      nameRo: NAME,
      proposedByGarageId: garageId,
      status: 'pending',
    },
  });
  await prisma.outboxEvent.create({
    data: {
      audience: ['admin'],
      kind: 'catalogue_job.proposed',
      payload: { garageId, jobTypeId: jobType.id },
      subjectId: jobType.id,
    },
  });
  return { jobType, ...(await jobFor(jobType.id)) };
}

const messages = (accountId: string) =>
  prisma.notification.findMany({
    orderBy: { createdAt: 'asc' },
    where: { accountId, fallbackOf: null, kind: KIND },
  });

const channels = async (accountId: string) =>
  (await messages(accountId)).map((m) => m.channel).sort();

const bellOf = async (accountId: string) =>
  (await messages(accountId)).find((m) => m.channel === 'in_app');

describe('telling the admins a garage proposed a job for the catalogue', () => {
  it('listens to catalogue_job.proposed alone, on its own queue', () => {
    expect(CATALOGUE_JOB_PENDING_CONSUMER.kinds).toEqual([
      'catalogue_job.proposed',
    ]);
    expect(CATALOGUE_JOB_PENDING_CONSUMER.queue).toBe('catalogue-job-pending');
  });

  it('tells every active admin once, naming the garage and the job, and nobody else', async () => {
    const { dan, garage, gone, ioana, owner } = await people();
    const { event, job, jobType } = await proposed(garage.id);
    const fanOut = await start();

    await fanOut.handle(job);

    for (const admin of [ioana, dan]) {
      const rows = await messages(admin);
      // The bell and the e-mail; a push needs a device.
      expect(rows.map((r) => r.channel).sort()).toEqual(['email', 'in_app']);
      for (const row of rows) {
        expect(row.eventId).toBe(String(event.id));
        expect(row.subjectId).toBe(jobType.id);
      }
      expect(rows[0]?.params).toEqual({
        dashboard: 'https://motorfix.test/app/admin',
        garage: 'Service Auto Nord',
        job: NAME,
      });
    }
    expect(await messages(gone)).toEqual([]);
    expect(await messages(owner)).toEqual([]);
  });

  it('words the bell in each admin’s language', async () => {
    const { dan, garage, ioana } = await people();
    const { job } = await proposed(garage.id);
    const fanOut = await start();

    await fanOut.handle(job);

    expect(bellText(KIND, 'ro', (await bellOf(ioana))?.params as never)).toBe(
      `Service Auto Nord a propus lucrarea „${NAME}”`,
    );
    expect(bellText(KIND, 'en', (await bellOf(dan))?.params as never)).toBe(
      `Service Auto Nord proposed the job "${NAME}"`,
    );
  });

  it('sends only the bell to an admin who turned the type off', async () => {
    const { dan, garage, ioana } = await people();
    await prisma.notificationPreference.create({
      data: { accountId: ioana, channel: 'email', enabled: false, type: KIND },
    });
    const { job } = await proposed(garage.id);
    const fanOut = await start();

    await fanOut.handle(job);

    expect(await channels(ioana)).toEqual(['in_app']);
    expect(await channels(dan)).toEqual(['email', 'in_app']);
  });

  it('builds each message once when the same event is handled twice', async () => {
    const { garage, ioana } = await people();
    const { job } = await proposed(garage.id);
    const fanOut = await start();

    await fanOut.handle(job);
    await fanOut.handle(job);

    expect(await channels(ioana)).toEqual(['email', 'in_app']);
  });

  it('tells them of a job the garage proposed with its listing', async () => {
    const { garage, ioana, owner } = await people();
    await prisma.$transaction((tx) =>
      new GaragePricesService(new AuditService(), outbox).saveStarting(
        tx,
        garage.id,
        owner,
        {
          jobs: [{ fromBani: 60_000, name: NAME, toBani: 90_000 }],
          labour: { fromBani: 15_000, toBani: 25_000 },
        },
      ),
    );
    const jobType = await prisma.jobType.findFirstOrThrow({
      where: { proposedByGarageId: garage.id },
    });
    const { job } = await jobFor(jobType.id);
    const fanOut = await start();

    await fanOut.handle(job);

    expect(await channels(ioana)).toEqual(['email', 'in_app']);
    expect((await bellOf(ioana))?.params).toMatchObject({
      garage: 'Service Auto Nord',
      job: NAME,
    });
  });

  it.each([
    ['no job id', (garageId: string) => ({ garageId })],
    [
      'a job id that is not a uuid',
      (garageId: string) => ({ garageId, jobTypeId: 'injectoare' }),
    ],
    [
      'a job the catalogue does not hold',
      (garageId: string) => ({ garageId, jobTypeId: randomUUID() }),
    ],
  ])('tells nobody for %s', async (_, payload) => {
    const { garage, ioana } = await people();
    const { job } = await proposed(garage.id);
    const fanOut = await start();

    await expect(
      fanOut.handle({
        data: { ...job.data, payload: payload(garage.id) as never },
      }),
    ).resolves.toBeUndefined();

    expect(await messages(ioana)).toEqual([]);
  });

  it('logs one line with the job and how many admins, never a name', async () => {
    const { garage } = await people();
    const { job, jobType } = await proposed(garage.id);
    const log = jest.spyOn(Logger.prototype, 'log');
    const fanOut = await start();

    await fanOut.handle(job);

    const lines = log.mock.calls
      .map(([line]) => String(line))
      .filter((line) => line.includes(jobType.id));
    expect(lines).toEqual([
      `catalogue job ${jobType.id} proposed: told to 2 admins`,
    ]);
  });
});
