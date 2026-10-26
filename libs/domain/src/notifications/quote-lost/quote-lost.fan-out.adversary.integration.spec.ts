import { Logger } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';

import { QuoteLostFanOut } from './quote-lost.fan-out';
import { serialDatabase } from '../../auth/serial-db.testing';
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

const redisUrl = redisUrlFor(10);
const { account, prisma, reset } = fixtures();
const world = quotesWorld(prisma);
serialDatabase(databaseUrl);

// 23:00 in Bucharest, inside quiet hours.
const NIGHT = new Date('2026-10-09T20:00:00Z');

let app: TestingModule | undefined;
let phones = 0;

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

async function start() {
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
  app.get(NotificationsService).now = () => NIGHT;
  return app.get(QuoteLostFanOut);
}

// A garage with an owner who chose WhatsApp for lost quotes and has a
// confirmed phone, an English receptionist, and a mechanic who may answer
// quotes.
async function staffed(name: string) {
  const garage = await world.garage(name);
  const owner = await account(`${name} Owner`, ['garage']);
  const desk = await account(`${name} Desk`, ['receptionist'], {
    language: 'en',
  });
  const fixer = await account(`${name} Fixer`, ['mechanic']);
  phones += 1;
  await prisma.account.update({
    data: {
      phone: testPhone(phones % 10),
      phoneVerifiedAt: new Date('2026-09-01T00:00:00Z'),
    },
    where: { id: owner },
  });
  await prisma.garageMember.createMany({
    data: [
      { accountId: owner, garageId: garage.id, role: 'owner' },
      { accountId: desk, garageId: garage.id, role: 'receptionist' },
    ],
  });
  await prisma.mechanic.create({
    data: {
      accountId: fixer,
      canAnswerQuotes: true,
      garageId: garage.id,
      name,
    },
  });
  await prisma.notificationPreference.create({
    data: {
      accountId: owner,
      channel: 'whatsapp',
      enabled: true,
      garageId: garage.id,
      type: 'QUOTE_LOST',
    },
  });
  return { desk, fixer, garage, owner };
}

// Andrei confirmed Atelier Dinamo's quote: the quotes Service Nord and
// Service Vest sent him were closed, and the confirm left the event.
async function closed() {
  phones = 0;
  const driverId = await account('Andrei Ion Marin', ['driver']);
  const dinamo = await staffed('Atelier Dinamo');
  const nord = await staffed('Service Nord');
  const vest = await staffed('Service Vest');
  const request = await world.request(driverId, { status: 'booked' });
  await world.quote(request.id, dinamo.garage.id, 'accepted');
  const nordQuote = await world.quote(request.id, nord.garage.id, 'lost');
  const vestQuote = await world.quote(request.id, vest.garage.id, 'lost');
  const payload = {
    quoteIds: [nordQuote.id, vestQuote.id],
    requestId: request.id,
  };
  const job = await event(request.id, payload, [nord, vest]);
  return { dinamo, driverId, job, nord, nordQuote, request, vest, vestQuote };
}

async function event(
  requestId: string,
  payload: { quoteIds: string[]; requestId: string },
  garages: { garage: { id: string } }[],
) {
  const row = await prisma.outboxEvent.create({
    data: {
      audience: garages.map((g) => `garage:${g.garage.id}`),
      kind: 'quote.closed',
      payload,
      subjectId: requestId,
    },
  });
  return {
    data: { id: String(row.id), kind: row.kind, payload, subjectId: requestId },
  };
}

const rows = (accountId: string) =>
  prisma.notification.findMany({
    where: { accountId, fallbackOf: null, kind: 'QUOTE_LOST' },
  });
const channels = async (accountId: string) =>
  (await rows(accountId)).map((r) => r.channel).sort();

const count = (kind = 'QUOTE_LOST') =>
  prisma.notification.count({ where: { kind } });

// @traces 223-FR-002 223-FR-013
describe('quote lost fan-out under hostile events', () => {
  it('tells a quote id listed twice once', async () => {
    const { job, nordQuote, nord } = await closed();
    const fanOut = await start();
    job.data.payload.quoteIds = [nordQuote.id, nordQuote.id];

    await fanOut.handle(job);

    expect(await channels(nord.desk)).toEqual(['email', 'in_app']);
  });

  it('skips an unknown quote id and still tells the known one', async () => {
    const { job, nordQuote, nord } = await closed();
    const fanOut = await start();
    job.data.payload.quoteIds = [
      '00000000-0000-4000-8000-000000000000',
      nordQuote.id,
    ];

    await fanOut.handle(job);

    expect(await channels(nord.desk)).toEqual(['email', 'in_app']);
  });

  // A corrupt event fails its job loudly (retried, then logged as a final
  // failure) rather than being skipped in silence, and tells nobody.
  it('fails the job on a malformed quote id without writing anything', async () => {
    const { job } = await closed();
    const fanOut = await start();
    job.data.payload.quoteIds = ['not-a-uuid'];

    await expect(fanOut.handle(job)).rejects.toThrow();

    expect(await count()).toBe(0);
  });

  it('fails the job when the payload has no quote ids at all', async () => {
    const { job } = await closed();
    const fanOut = await start();
    job.data.payload = { requestId: job.data.payload.requestId } as never;

    await expect(fanOut.handle(job)).rejects.toThrow();

    expect(await count()).toBe(0);
  });

  it('tells a hundred quotes of a thousand-id event', async () => {
    const { job } = await closed();
    const fanOut = await start();
    const real = job.data.payload.quoteIds;
    job.data.payload.quoteIds = [
      ...real,
      ...Array.from(
        { length: 5000 },
        (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      ),
    ];

    await fanOut.handle(job);

    expect(await count()).toBeGreaterThan(0);
  });

  it('still tells the garage when its quote is no longer lost', async () => {
    const { job, nordQuote, nord } = await closed();
    await prisma.quote.update({
      data: { status: 'withdrawn' },
      where: { id: nordQuote.id },
    });
    const fanOut = await start();

    await fanOut.handle(job);

    expect(await channels(nord.desk)).toEqual(['email', 'in_app']);
  });

  it('gives a person on two losing garages one message per channel', async () => {
    const { job, nord, vest } = await closed();
    await prisma.garageMember.create({
      data: {
        accountId: nord.desk,
        garageId: vest.garage.id,
        role: 'owner',
      },
    });
    const fanOut = await start();

    await fanOut.handle(job);

    expect(await channels(nord.desk)).toEqual(['email', 'in_app']);
  });

  it('tells a suspended-staff garage nothing and the rest still', async () => {
    const { job, nord, vest } = await closed();
    await prisma.garageMember.deleteMany({
      where: { garageId: nord.garage.id },
    });
    const fanOut = await start();

    await fanOut.handle(job);

    expect(await channels(nord.owner)).toEqual([]);
    expect(await channels(vest.owner)).toEqual(['email', 'in_app', 'whatsapp']);
  });

  it('writes an English bell row for an English receptionist and Romanian for the owner', async () => {
    const { job, nord } = await closed();
    const fanOut = await start();

    await fanOut.handle(job);

    const { bellText } = await import('../templates');
    const row = (await rows(nord.desk)).find((r) => r.channel === 'in_app');
    const ownerRow = (await rows(nord.owner)).find(
      (r) => r.channel === 'in_app',
    );
    expect(bellText('QUOTE_LOST', 'en', row?.params as never)).toContain(
      'The customer chose another garage',
    );
    expect(bellText('QUOTE_LOST', 'ro', ownerRow?.params as never)).toContain(
      'Clientul a ales alt service',
    );
  });

  it('builds nothing twice when the event is handled three times concurrently', async () => {
    const { job } = await closed();
    const fanOut = await start();

    await Promise.all([
      fanOut.handle(job),
      fanOut.handle(job),
      fanOut.handle(job),
    ]);

    expect(await count()).toBe(
      await prisma.notification
        .findMany({
          distinct: ['accountId', 'channel'],
          where: { kind: 'QUOTE_LOST' },
        })
        .then((r) => r.length),
    );
  });
});
