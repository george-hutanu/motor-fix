import { randomUUID } from 'node:crypto';

import { Redis } from 'ioredis';

import { createPrisma } from '../../auth/prisma';
import { serialDatabase } from '../../auth/serial-db.testing';
import { audienceOf, type LiveSubject } from '../../events/audience';
import { OutboxRelay } from '../../events/outbox-relay/outbox-relay';

const databaseUrl =
  process.env['DATABASE_URL'] ?? 'postgresql://localhost:5432/postgres';
const prisma = createPrisma(databaseUrl);
const redis = new Redis(process.env['REDIS_URL'] ?? 'redis://localhost:6379');
serialDatabase(databaseUrl);

afterAll(async () => {
  await prisma.$disconnect();
  await redis.quit();
});

beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE outbox_event');
  jest.restoreAllMocks();
});

const generation = (garageId: string) =>
  redis.get(`free-slots-gen:${garageId}`);

const recorded = (kind: string, subject: LiveSubject, subjectId: string) =>
  prisma.outboxEvent.create({
    data: { audience: audienceOf(subject), kind, subjectId },
  });

const slotsChanged = () =>
  prisma.outboxEvent.findMany({
    orderBy: { id: 'asc' },
    where: { kind: 'garage.slots_changed' },
  });

// Each schedule kind with the audience its writer gives it today.
// A garage of its own for each, so every case starts with no generation.
function scheduleEvents(): [string, LiveSubject, string][] {
  const row = (
    kind: string,
    subject: (garageId: string) => LiveSubject,
  ): [string, LiveSubject, string] => {
    const garageId = randomUUID();
    return [kind, subject(garageId), garageId];
  };
  const booking = (garageId: string): LiveSubject => ({
    driverAccountId: randomUUID(),
    garageId,
    mechanicId: randomUUID(),
    type: 'booking',
  });
  const mechanic = (garageId: string): LiveSubject => ({
    garageId,
    mechanicId: randomUUID(),
    public: false,
    type: 'mechanic',
  });
  const block = (garageId: string): LiveSubject => ({
    garageId,
    mechanicId: null,
    type: 'time_block',
  });
  const garage = (garageId: string): LiveSubject => ({
    garageId,
    results: false,
    type: 'public_garage',
  });
  return [
    row('booking.confirmed', booking),
    row('booking.moved', booking),
    row('booking.cancelled', booking),
    row('booking.lapsed', booking),
    row('booking.no_show_recorded', booking),
    row('quote.accepted', (garageId) => ({
      driverAccountId: randomUUID(),
      garageId,
      type: 'quote',
    })),
    row('mechanic.added', mechanic),
    row('mechanic.updated', mechanic),
    row('mechanic.removed', mechanic),
    row('garage.updated', garage),
    row('garage.features_changed', garage),
    row('time_block.created', block),
    row('time_block.updated', block),
    row('time_block.deleted', block),
  ];
}

// @traces 154-FR-012
// @traces 154-FR-013
describe('relaying a schedule event', () => {
  it.each(scheduleEvents())(
    'drops the free slots of the garage and records one garage.slots_changed for %s',
    async (kind, subject, garageId) => {
      await recorded(kind, subject, randomUUID());

      await new OutboxRelay(prisma, redis).relay();

      expect(await generation(garageId)).toBe('1');
      expect(await slotsChanged()).toEqual([
        expect.objectContaining({
          audience: [`garage:${garageId}`, `public:garage:${garageId}`],
          payload: { garageId },
          relayedAt: null,
          subjectId: garageId,
        }),
      ]);
    },
  );

  it('records one event per relayed schedule event, each relayed by the next batch without dropping again', async () => {
    const garageId = randomUUID();
    const block: LiveSubject = {
      garageId,
      mechanicId: null,
      type: 'time_block',
    };
    await recorded('time_block.created', block, randomUUID());
    await recorded('time_block.deleted', block, randomUUID());
    const relay = new OutboxRelay(prisma, redis);

    await relay.relay();
    const first = await slotsChanged();
    await relay.relay();

    expect(first).toHaveLength(2);
    expect(await generation(garageId)).toBe('2');
    expect(await slotsChanged()).toEqual([
      expect.objectContaining({ relayedAt: expect.any(Date) }),
      expect.objectContaining({ relayedAt: expect.any(Date) }),
    ]);
  });

  it.each<[string, (garageId: string) => LiveSubject]>([
    [
      'garage.suspended',
      (garageId) => ({ garageId, results: true, type: 'public_garage' }),
    ],
    [
      'review.posted',
      (garageId) => ({
        authorAccountId: randomUUID(),
        garageId,
        mechanicId: null,
        type: 'review',
      }),
    ],
    [
      'booking.completed',
      (garageId) => ({
        driverAccountId: randomUUID(),
        garageId,
        mechanicId: null,
        type: 'booking',
      }),
    ],
    [
      'garage.slots_changed',
      (garageId) => ({ garageId, results: false, type: 'public_garage' }),
    ],
  ])('neither drops nor records anything for %s', async (kind, subject) => {
    const garageId = randomUUID();
    const own = await recorded(kind, subject(garageId), garageId);

    await new OutboxRelay(prisma, redis).relay();

    expect(await generation(garageId)).toBeNull();
    // Only the event recorded here, when it is a slots_changed itself.
    const after = (await slotsChanged()).map((event) => event.id);
    expect(after).toEqual(kind === 'garage.slots_changed' ? [own.id] : []);
  });

  it('rolls the batch back when Valkey refuses the drop, and drops on the retry', async () => {
    const garageId = randomUUID();
    await recorded(
      'booking.cancelled',
      {
        driverAccountId: randomUUID(),
        garageId,
        mechanicId: null,
        type: 'booking',
      },
      randomUUID(),
    );
    const incr = redis.incr.bind(redis);
    const refusing = jest
      .spyOn(redis, 'incr')
      .mockImplementation(((key: string) =>
        key.startsWith('free-slots-gen:')
          ? Promise.reject(new Error('Connection is closed.'))
          : incr(key)) as never);

    await expect(new OutboxRelay(prisma, redis).relay()).rejects.toThrow(
      'Connection is closed.',
    );
    expect(await slotsChanged()).toEqual([]);
    expect(
      await prisma.outboxEvent.count({
        where: { kind: 'booking.cancelled', relayedAt: null },
      }),
    ).toBe(1);

    refusing.mockRestore();
    await new OutboxRelay(prisma, redis).relay();

    expect(await generation(garageId)).toBe('1');
    expect(await slotsChanged()).toHaveLength(1);
  });
});
