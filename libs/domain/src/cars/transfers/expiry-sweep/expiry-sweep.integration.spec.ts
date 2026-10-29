import { createHash, randomBytes } from 'node:crypto';

import { countedMetrics, counterTotal } from '@motor-fix/observability/testing';
import { Logger } from '@nestjs/common';

import { CarTransferExpirySweep } from './expiry-sweep';
import { AuditService } from '../../../audit/audit.service';
import { serialDatabase } from '../../../auth/serial-db.testing';
import { outbox } from '../../../events/event.port';
import { databaseUrl } from '../../../notifications/notifications.testing';
import { transfersWorld } from '../transfers.testing';

const world = transfersWorld();
const { prisma } = world;
serialDatabase(databaseUrl);

const DAY_MS = 86_400_000;
const NOW = new Date('2026-10-26T06:00:00Z');
const sweep = new CarTransferExpirySweep(prisma, new AuditService(), outbox);

let since: Date;
let mark: bigint;

beforeEach(async () => {
  await world.reset();
  ({ mark, since } = await world.marks());
});
afterEach(() => jest.restoreAllMocks());
afterAll(() => prisma.$disconnect());

// A transfer of a new car of a new seller, expiring at `expiresAt`.
async function transfer(
  expiresAt: Date,
  status: 'sent' | 'cancelled' | 'accepted' | 'expired' = 'sent',
) {
  const seller = await world.driver(
    `vanzator-${randomBytes(4).toString('hex')}`,
  );
  const car = await world.car(seller.id);
  return prisma.carTransfer.create({
    data: {
      buyerPhone: '+40722123456',
      carId: car.id,
      expiresAt,
      sellerId: seller.id,
      sentAt: new Date(expiresAt.getTime() - 7 * DAY_MS),
      status,
      tokenHash: createHash('sha256').update(randomBytes(32)).digest('hex'),
    },
  });
}

const statusOf = async (id: string) =>
  (await prisma.carTransfer.findUniqueOrThrow({ where: { id } })).status;

// @traces 415-FR-010
describe('the daily transfer expiry', () => {
  it('expires the sent transfers past their time and at the expiry instant, and no other', async () => {
    const past = await transfer(new Date(NOW.getTime() - DAY_MS));
    const atNow = await transfer(NOW);
    const ahead = await transfer(new Date(NOW.getTime() + 1000));
    const cancelled = await transfer(
      new Date(NOW.getTime() - DAY_MS),
      'cancelled',
    );
    const accepted = await transfer(
      new Date(NOW.getTime() - DAY_MS),
      'accepted',
    );

    await sweep.run(NOW);

    expect(await statusOf(past.id)).toBe('expired');
    expect(await statusOf(atNow.id)).toBe('expired');
    expect(await statusOf(ahead.id)).toBe('sent');
    expect(await statusOf(cancelled.id)).toBe('cancelled');
    expect(await statusOf(accepted.id)).toBe('accepted');
  });

  it('writes a system update entry and car_transfer.expired for each', async () => {
    const past = await transfer(new Date(NOW.getTime() - DAY_MS));

    await sweep.run(NOW);

    const entries = await world.transferAudit(since);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      action: 'update',
      actorId: null,
      actorRole: 'system',
      carId: past.carId,
      field: 'status',
      newValue: 'expired',
      oldValue: 'sent',
      subjectId: past.id,
    });
    const events = await world.transferEvents(mark);
    expect(events.map((e) => e.kind)).toEqual(['car_transfer.expired']);
    expect(events[0].payload).toEqual({
      carId: past.carId,
      sellerAccountId: past.sellerId,
      status: 'expired',
      transferId: past.id,
    });
    expect(events[0].audience).toEqual([`account:${past.sellerId}`]);
    expect(
      JSON.stringify([entries, events], (_, v) =>
        typeof v === 'bigint' ? String(v) : v,
      ),
    ).not.toContain('722123456');
  });

  it('expires the others when one fails, and expires it on the next run', async () => {
    const first = await transfer(new Date(NOW.getTime() - DAY_MS));
    const second = await transfer(new Date(NOW.getTime() - 2 * DAY_MS));
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const record = AuditService.prototype.record;
    let failed = false;
    jest.spyOn(AuditService.prototype, 'record').mockImplementation(function (
      this: AuditService,
      tx,
      entry,
    ) {
      if (!failed && entry.subjectId === first.id) {
        failed = true;
        return Promise.reject(new Error('audit down'));
      }
      return record.call(this, tx, entry);
    });

    await sweep.run(NOW);

    expect(await statusOf(first.id)).toBe('sent');
    expect(await statusOf(second.id)).toBe('expired');

    await sweep.run(NOW);

    expect(await statusOf(first.id)).toBe('expired');
  });

  it('leaves a transfer the seller cancelled meanwhile cancelled, writing nothing for it', async () => {
    const past = await transfer(new Date(NOW.getTime() - DAY_MS));
    const findMany = prisma.carTransfer.findMany.bind(prisma.carTransfer);
    jest.spyOn(prisma.carTransfer, 'findMany').mockImplementationOnce((async (
      args: unknown,
    ) => {
      const rows = await findMany(args as never);
      await prisma.carTransfer.update({
        data: { status: 'cancelled' },
        where: { id: past.id },
      });
      return rows;
    }) as never);

    await sweep.run(NOW);

    expect(await statusOf(past.id)).toBe('cancelled');
    expect(await world.transferAudit(since)).toHaveLength(0);
    expect(await world.transferEvents(mark)).toHaveLength(0);
  });

  it('logs and counts how many it expired', async () => {
    const reader = countedMetrics();
    await transfer(new Date(NOW.getTime() - DAY_MS));
    await transfer(new Date(NOW.getTime() - DAY_MS));
    const lines: string[] = [];
    jest.spyOn(Logger.prototype, 'log').mockImplementation((message) => {
      lines.push(String(message));
    });

    await sweep.run(NOW);

    expect(lines).toContain('expired 2 car transfers');
    expect(
      await counterTotal(reader, 'motorfix_car_transfer_expiries_total'),
    ).toBe(2);
  });
});
