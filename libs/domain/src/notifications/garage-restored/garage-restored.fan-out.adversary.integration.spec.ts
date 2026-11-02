import { countedMetrics, counterTotal } from '@motor-fix/observability/testing';
import { Logger } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';

import { GarageRestoredFanOut } from './garage-restored.fan-out';
import { AuditService } from '../../audit/audit.service';
import { serialDatabase } from '../../auth/serial-db.testing';
import { outbox } from '../../events/event.port';
import { SuspensionService } from '../../garages/verification/suspension/suspension.service';
import { staffedGarage } from '../../garages/verification/suspension/suspension.testing';
import { NotificationsModule } from '../notifications.module';
import {
  databaseUrl,
  fixtures,
  redisUrlFor,
  testConfig,
  testPhoneConfig,
} from '../notifications.testing';

// @traces 067-FR-008 067-FR-013

const redisUrl = redisUrlFor(12);
const { account, prisma, reset } = fixtures();
serialDatabase(databaseUrl);

const reader = countedMetrics();
const counted = (outcome: string) =>
  counterTotal(reader, 'motorfix_garage_restored_notices_total', { outcome });

const REASON = 'Plângeri repetate de la clienți';
const NOTE = 'Discutat cu proprietarul, telefon 0722 000 111.';
const SYSTEM = { accountId: null, role: 'system' } as const;

let app: TestingModule | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
  vi.restoreAllMocks();
});

afterAll(() => prisma.$disconnect());

beforeEach(async () => {
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
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
  return app.get(GarageRestoredFanOut);
}

// A garage suspended by an admin and restored with a note, with a Romanian
// and an English owner, and the job the relay queues for its event.
async function restored(options: { owners?: boolean } = {}) {
  const garage = await staffedGarage(prisma, account);
  const english = await account('Elena Owner', ['garage'], { language: 'en' });
  await prisma.garageMember.create({
    data: { accountId: english, garageId: garage.id, role: 'owner' },
  });
  if (options.owners === false) {
    await prisma.garageMember.deleteMany({
      where: { garageId: garage.id, role: 'owner' },
    });
  }
  const admin = {
    accountId: await account('Ana Popescu', ['admin']),
    garageId: null,
    permissions: {
      canAnswerQuotes: false,
      canMoveBookings: false,
      canRecordFinalPrice: false,
    },
    role: 'admin' as const,
    roles: ['admin' as const],
  };
  const suspensions = new SuspensionService(prisma, new AuditService(), outbox);
  await suspensions.suspend(SYSTEM, garage.id, 'admin', REASON);
  await suspensions.restore(admin, garage.id, { note: NOTE });
  const event = await prisma.outboxEvent.findFirstOrThrow({
    where: { kind: 'garage.restored', subjectId: garage.id },
  });
  const job = {
    data: {
      id: String(event.id),
      kind: event.kind,
      payload: event.payload as never,
      subjectId: garage.id,
    },
  };
  return { english, event, garage, job };
}

const messages = (accountId: string) =>
  prisma.notification.findMany({
    orderBy: { createdAt: 'asc' },
    where: { accountId, fallbackOf: null, kind: 'GARAGE_RESTORED' },
  });

const channels = async (accountId: string) =>
  (await messages(accountId)).map((m) => m.channel).sort();

describe('telling a restored garage’s owners under hostile input', () => {
  it.each([
    ['an id that is not a uuid', 'not-a-uuid'],
    ['a garage that no longer exists', '7d3c1a52-8d6e-4f0b-9d5e-2f7f3c8b1a90'],
    ['an id with a quote in it', "x' OR '1'='1"],
  ])('tells nobody and counts a skip for %s', async (_, garageId) => {
    const { garage, job } = await restored();
    const fanOut = await start();
    const before = await counted('skipped');

    await expect(
      fanOut.handle({ data: { ...job.data, payload: { garageId } as never } }),
    ).resolves.toBeUndefined();

    expect(await messages(garage.ownerId)).toEqual([]);
    expect(await counted('skipped')).toBe(before + 1);
  });

  it('tells nobody and counts a skip for a payload that is null', async () => {
    const { garage, job } = await restored();
    const fanOut = await start();
    const before = await counted('skipped');

    await expect(
      fanOut.handle({ data: { ...job.data, payload: null as never } }),
    ).resolves.toBeUndefined();

    expect(await messages(garage.ownerId)).toEqual([]);
    expect(await counted('skipped')).toBe(before + 1);
  });

  it('tells an owner again for a second restore of the same garage', async () => {
    const { garage, job } = await restored();
    const fanOut = await start();
    await fanOut.handle(job);
    const admin = {
      accountId: await account('Dan Ene', ['admin']),
      garageId: null,
      permissions: {
        canAnswerQuotes: false,
        canMoveBookings: false,
        canRecordFinalPrice: false,
      },
      role: 'admin' as const,
      roles: ['admin' as const],
    };
    const suspensions = new SuspensionService(
      prisma,
      new AuditService(),
      outbox,
    );
    await suspensions.suspend(SYSTEM, garage.id, 'admin', REASON);
    await suspensions.restore(admin, garage.id, { note: NOTE });
    const second = await prisma.outboxEvent.findFirstOrThrow({
      orderBy: { id: 'desc' },
      where: { kind: 'garage.restored', subjectId: garage.id },
    });

    await fanOut.handle({ data: { ...job.data, id: String(second.id) } });

    expect(await channels(garage.ownerId)).toEqual([
      'email',
      'email',
      'in_app',
      'in_app',
    ]);
  });

  it('still tells the other owner when one owner account is suspended', async () => {
    const { english, garage, job } = await restored();
    await prisma.account.update({
      data: { status: 'suspended' },
      where: { id: garage.ownerId },
    });
    const fanOut = await start();

    await expect(fanOut.handle(job)).resolves.toBeUndefined();

    expect(await channels(english)).toEqual(['email', 'in_app']);
  });
});
