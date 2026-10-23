import { randomUUID } from 'node:crypto';

import { Logger } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';

import {
  CATALOGUE_JOB_DECIDED_CONSUMER,
  CatalogueJobDecidedFanOut,
} from './catalogue-job-decided.fan-out';
import { serialDatabase } from '../../auth/serial-db.testing';
import { outbox } from '../../events/event.port';
import { staffedGarage } from '../../garages/verification/suspension/suspension.testing';
import { NotificationsModule } from '../notifications.module';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
  testConfig,
  testPhoneConfig,
} from '../notifications.testing';
import { bellText } from '../templates';

// @traces 414-FR-009

const redisUrl = redisUrlFor(13);
const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);

const KIND = 'CATALOGUE_JOB_DECIDED';
const PRICES = 'https://motorfix.test/app/garage/prices';
const PROPOSED = 'Recondiționare injectoare';
const REASON = 'Există deja ca „Curățare injectoare”.';

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
        redisUrl,
      }),
    ],
  }).compile();
  await app.init();
  return app.get(CatalogueJobDecidedFanOut);
}

// A job Atelier Dinamo proposed, decided as an admin's write leaves it, and
// the job the relay queues for its event.
async function decided(decision: 'approved' | 'rejected') {
  const garage = await staffedGarage(prisma, account);
  const jobType = await prisma.jobType.create({
    data: {
      decidedAt: new Date(),
      key: `injectoare-${randomUUID()}`,
      nameEn: decision === 'approved' ? 'Injector reconditioning' : PROPOSED,
      nameRo: PROPOSED,
      proposedByGarageId: garage.id,
      status: decision,
      ...(decision === 'rejected' && { rejectionReason: REASON }),
    },
  });
  await prisma.$transaction((tx) =>
    outbox.record(tx, {
      audience: { garageId: garage.id, type: 'catalogue_job' },
      kind: 'catalogue_job.decided',
      payload: { decision, garageId: garage.id, jobTypeId: jobType.id },
      subjectId: jobType.id,
    }),
  );
  const event = await prisma.outboxEvent.findFirstOrThrow({
    where: { kind: 'catalogue_job.decided', subjectId: jobType.id },
  });
  const job = {
    data: { id: String(event.id), payload: event.payload as never },
  };
  return { event, garage, job, jobType };
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

describe('telling a garage owner what became of the job they proposed', () => {
  it('listens to catalogue_job.decided alone, on its own queue', () => {
    expect(CATALOGUE_JOB_DECIDED_CONSUMER.kinds).toEqual([
      'catalogue_job.decided',
    ]);
    expect(CATALOGUE_JOB_DECIDED_CONSUMER.queue).toBe('catalogue-job-decided');
  });

  it.each(['approved', 'rejected'] as const)(
    'builds one notice for the owner alone when the job is %s, keyed by the event and the job',
    async (decision) => {
      const { event, garage, job, jobType } = await decided(decision);
      const fanOut = await start();

      await fanOut.handle(job);

      // The bell and the e-mail; a push needs a device.
      expect(await channels(garage.ownerId)).toEqual(['email', 'in_app']);
      for (const row of await messages(garage.ownerId)) {
        expect(row.eventId).toBe(String(event.id));
        expect(row.subjectId).toBe(jobType.id);
      }
      for (const other of [
        garage.receptionistId,
        garage.mechanicId,
        garage.driverId,
      ]) {
        expect(await messages(other)).toEqual([]);
      }
    },
  );

  it('names the approved job in the owner’s language and links Prețuri', async () => {
    const { garage, job } = await decided('approved');
    const fanOut = await start();

    await fanOut.handle(job);

    const bell = await bellOf(garage.ownerId);
    expect(bell?.params).toEqual({
      decision: 'approved',
      job: PROPOSED,
      prices: PRICES,
    });
    expect(bellText(KIND, 'ro', bell?.params as never)).toBe(
      `Lucrarea „${PROPOSED}” a fost aprobată și apare pe profilul tău.`,
    );
  });

  it('names the approved job in English to an English owner', async () => {
    const { garage, job } = await decided('approved');
    await prisma.account.update({
      data: { language: 'en' },
      where: { id: garage.ownerId },
    });
    const fanOut = await start();

    await fanOut.handle(job);

    expect((await bellOf(garage.ownerId))?.params).toMatchObject({
      job: 'Injector reconditioning',
    });
  });

  it('gives the rejection its reason', async () => {
    const { garage, job } = await decided('rejected');
    const fanOut = await start();

    await fanOut.handle(job);

    const bell = await bellOf(garage.ownerId);
    expect(bell?.params).toEqual({
      decision: 'rejected',
      job: PROPOSED,
      prices: PRICES,
      reason: REASON,
    });
    expect(bellText(KIND, 'ro', bell?.params as never)).toBe(
      `Lucrarea „${PROPOSED}” a fost respinsă: ${REASON}`,
    );
  });

  it('builds each message once when the same event is handled twice', async () => {
    const { garage, job } = await decided('rejected');
    const fanOut = await start();

    await fanOut.handle(job);
    await fanOut.handle(job);

    expect(await channels(garage.ownerId)).toEqual(['email', 'in_app']);
  });

  it('keeps the bell for an owner who muted the type', async () => {
    const { garage, job } = await decided('approved');
    await prisma.notificationPreference.createMany({
      data: (['email', 'push'] as const).map((channel) => ({
        accountId: garage.ownerId,
        channel,
        enabled: false,
        garageId: garage.id,
        type: KIND,
      })),
    });
    const fanOut = await start();

    await fanOut.handle(job);

    expect(await channels(garage.ownerId)).toEqual(['in_app']);
  });

  it('tells nobody when the garage no longer exists', async () => {
    const { garage, job } = await decided('rejected');
    await prisma.garage.delete({ where: { id: garage.id } });
    const fanOut = await start();

    await expect(fanOut.handle(job)).resolves.toBeUndefined();

    expect(await prisma.notification.count({ where: { kind: KIND } })).toBe(0);
  });

  it.each([
    ['no job id', () => ({ decision: 'approved' })],
    ['a job id that is not a uuid', () => ({ jobTypeId: 'injectoare' })],
    ['a job the catalogue does not hold', () => ({ jobTypeId: randomUUID() })],
  ])('tells nobody for %s', async (_, payload) => {
    const { garage, job } = await decided('approved');
    const fanOut = await start();

    await expect(
      fanOut.handle({ data: { ...job.data, payload: payload() as never } }),
    ).resolves.toBeUndefined();

    expect(await messages(garage.ownerId)).toEqual([]);
  });

  it('tells nobody about a job still waiting for a decision', async () => {
    const { garage, job, jobType } = await decided('approved');
    await prisma.jobType.update({
      data: { decidedAt: null, status: 'pending' },
      where: { id: jobType.id },
    });
    const fanOut = await start();

    await fanOut.handle(job);

    expect(await messages(garage.ownerId)).toEqual([]);
  });

  it('logs one line with the job and the decision, never the reason', async () => {
    const { job, jobType } = await decided('rejected');
    const log = jest.spyOn(Logger.prototype, 'log');
    const fanOut = await start();

    await fanOut.handle(job);

    const lines = log.mock.calls
      .map(([line]) => String(line))
      .filter((line) => line.includes(jobType.id));
    expect(lines).toEqual([
      `catalogue job ${jobType.id} rejected: told to 1 owners`,
    ]);
    expect(lines.join()).not.toContain(REASON);
  });
});
