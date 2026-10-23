import { randomUUID } from 'node:crypto';

import { Logger } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';

import {
  DOCUMENT_REFUSED_CONSUMER,
  DocumentRefusedFanOut,
} from './document-refused.fan-out';
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

// @traces 068-FR-010
// @traces 068-FR-017

const redisUrl = redisUrlFor(5);
const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);

const NOTE = 'Pagina a doua nu se citește';

let app: TestingModule | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
  jest.restoreAllMocks();
});

afterAll(() => prisma.$disconnect());

beforeEach(async () => {
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  await reset();
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
  return app.get(DocumentRefusedFanOut);
}

// An approved garage with a Romanian and an English owner, its RAR
// authorisation refused, and the job the relay queues for the event.
async function refused() {
  const garage = await staffedGarage(prisma, account);
  const english = await account('Elena Owner', ['garage'], { language: 'en' });
  await prisma.garageMember.create({
    data: { accountId: english, garageId: garage.id, role: 'owner' },
  });
  const file = await prisma.verificationFile.create({
    data: { garageId: garage.id, status: 'approved' },
  });
  const document = await prisma.legalDocument.create({
    data: {
      decidedAt: new Date(),
      kind: 'rar_authorisation',
      pages: ['p2'],
      refusalNote: NOTE,
      refusalReason: 'documents',
      status: 'refused',
      verificationFileId: file.id,
    },
  });
  await prisma.$transaction((tx) =>
    outbox.record(tx, {
      audience: { garageIds: [garage.id], type: 'garage' },
      kind: 'document.refused',
      payload: {
        documentId: document.id,
        garageId: garage.id,
        kind: 'rar_authorisation',
        reason: 'documents',
      },
      subjectId: document.id,
    }),
  );
  const event = await prisma.outboxEvent.findFirstOrThrow({
    where: { kind: 'document.refused', subjectId: document.id },
  });
  const job = {
    data: { id: String(event.id), payload: event.payload as never },
  };
  return { document, english, event, garage, job };
}

const messages = (accountId: string) =>
  prisma.notification.findMany({
    orderBy: { createdAt: 'asc' },
    where: { accountId, fallbackOf: null, kind: 'DOCUMENT_REFUSED' },
  });

const channels = async (accountId: string) =>
  (await messages(accountId)).map((m) => m.channel).sort();

describe('telling a garage’s owners a yearly document was refused', () => {
  it('listens to document.refused alone', () => {
    expect(DOCUMENT_REFUSED_CONSUMER.kinds).toEqual(['document.refused']);
    expect(DOCUMENT_REFUSED_CONSUMER.queue).toBe('document-refused');
  });

  it('builds one DOCUMENT_REFUSED for each owner only, keyed by the event', async () => {
    const { document, english, event, garage, job } = await refused();
    const fanOut = await start();

    await fanOut.handle(job);

    for (const person of [garage.ownerId, english]) {
      expect(await channels(person)).toEqual(['email', 'in_app']);
      for (const message of await messages(person)) {
        expect(message.eventId).toBe(String(event.id));
        expect(message.subjectId).toBe(document.id);
      }
    }
    expect(await messages(garage.receptionistId)).toEqual([]);
    expect(await messages(garage.mechanicId)).toEqual([]);
    expect(await messages(garage.driverId)).toEqual([]);
  });

  it('names the document in each owner’s language, with the note, and links the dashboard', async () => {
    const { english, garage, job } = await refused();
    const fanOut = await start();

    await fanOut.handle(job);

    const email = async (accountId: string) =>
      (await messages(accountId)).find((m) => m.channel === 'email')?.params;
    expect(await email(garage.ownerId)).toEqual({
      dashboard: 'https://motorfix.test/app/garage',
      document: 'Autorizația RAR',
      note: NOTE,
    });
    expect(await email(english)).toMatchObject({
      document: 'RAR authorisation',
      note: NOTE,
    });
    const bell = (await messages(garage.ownerId)).find(
      (m) => m.channel === 'in_app',
    );
    expect(bellText('DOCUMENT_REFUSED', 'ro', bell?.params as never)).toBe(
      `Document refuzat: Autorizația RAR. ${NOTE}`,
    );
  });

  it('builds nothing more when the same event is handled again', async () => {
    const { garage, job } = await refused();
    const fanOut = await start();

    await fanOut.handle(job);
    await fanOut.handle(job);

    expect(await channels(garage.ownerId)).toEqual(['email', 'in_app']);
  });

  it('lets an owner mute the e-mail', async () => {
    const { english, garage, job } = await refused();
    await prisma.notificationPreference.create({
      data: {
        accountId: garage.ownerId,
        channel: 'email',
        enabled: false,
        garageId: garage.id,
        type: 'DOCUMENT_REFUSED',
      },
    });
    const fanOut = await start();

    await fanOut.handle(job);

    expect(await channels(garage.ownerId)).toEqual(['in_app']);
    expect(await channels(english)).toEqual(['email', 'in_app']);
  });

  it.each([
    ['no garage id', (job: Job) => ({ ...job.payload, garageId: undefined })],
    [
      'a document of another garage',
      (job: Job) => ({ ...job.payload, garageId: randomUUID() }),
    ],
    [
      'a document that does not exist',
      (job: Job) => ({ ...job.payload, documentId: randomUUID() }),
    ],
  ])('tells nobody for %s', async (_, payloadOf) => {
    const { garage, job } = await refused();
    const fanOut = await start();

    await expect(
      fanOut.handle({ data: { ...job.data, payload: payloadOf(job.data) } }),
    ).resolves.toBeUndefined();

    expect(await messages(garage.ownerId)).toEqual([]);
  });

  it('tells nobody once the document is no longer refused', async () => {
    const { document, garage, job } = await refused();
    await prisma.legalDocument.update({
      data: { status: 'in_review' },
      where: { id: document.id },
    });
    const fanOut = await start();

    await fanOut.handle(job);

    expect(await messages(garage.ownerId)).toEqual([]);
  });
});

type Job = { payload: Record<string, unknown> };
