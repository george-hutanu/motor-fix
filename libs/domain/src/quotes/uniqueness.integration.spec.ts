import { HttpException } from '@nestjs/common';

import { databaseUrl, quotesWorld } from './quotes.testing';
import { moveQuote } from './transitions';
import { AuditService } from '../audit/audit.service';
import { serialDatabase } from '../auth/serial-db.testing';
import { outbox } from '../events/event.port';
import type { Prisma } from '../generated/prisma/client';
import { type TransitionEntity, uniqueConflict } from '../transitions';

const world = quotesWorld();
const { prisma } = world;
serialDatabase(databaseUrl);
afterAll(() => prisma.$disconnect());

const HOUR = 3_600_000;

let driver: string;
let garageId: string;
let otherGarageId: string;

beforeAll(async () => {
  await world.reset();
  driver = await world.account('Andrei Marin', ['driver']);
  garageId = (await world.garage('Atelier Dinamo')).id;
  otherGarageId = (await world.garage('Service Militari')).id;
});

// The one write of two that lost.
function loser(results: PromiseSettledResult<unknown>[]): HttpException {
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  const lost = results.find(
    (r): r is PromiseRejectedResult => r.status === 'rejected',
  );
  expect(lost?.reason).toBeInstanceOf(HttpException);
  return (lost as PromiseRejectedResult).reason as HttpException;
}

// Both writes are in flight at once; the database lets one commit and the
// other must come back as a conflict the caller can show, never a 500.
async function race(
  entity: TransitionEntity,
  write: (tx: Prisma.TransactionClient) => Promise<unknown>,
) {
  const attempt = () =>
    prisma.$transaction(async (tx) => {
      try {
        await write(tx);
      } catch (error) {
        uniqueConflict(error, entity);
      }
    });
  const lost = loser(await Promise.allSettled([attempt(), attempt()]));
  return { body: lost.getResponse(), status: lost.getStatus() };
}

const conflict = (entity: TransitionEntity, rule: string) => ({
  body: expect.objectContaining({ code: 'invalid_transition', entity, rule }),
  status: 409,
});

// @traces 220-FR-009
describe('the one-of rules under concurrent writes', () => {
  it('lets one recipient row per garage on a request', async () => {
    const request = await world.request(driver);

    expect(
      await race('request_recipient', (tx) =>
        tx.requestRecipient.create({
          data: { garageId, requestId: request.id, source: 'search' },
        }),
      ),
    ).toEqual(conflict('request_recipient', 'one_recipient_per_garage'));
  });

  it('lets one quote per garage on a request', async () => {
    const request = await world.request(driver);
    const recipient = await world.recipient(request.id, garageId, 'quoted');

    expect(
      await race('quote', (tx) =>
        tx.quote.create({
          data: {
            durationMinutes: 60,
            expiresAt: new Date(Date.now() + 7 * 24 * HOUR),
            fromBani: 30_000,
            garageId,
            idempotencyKey: crypto.randomUUID(),
            recipientId: recipient.id,
            requestId: request.id,
            slot: new Date(Date.now() + 24 * HOUR),
            toBani: 40_000,
          },
        }),
      ),
    ).toEqual(conflict('quote', 'one_quote_per_garage'));
  });

  it('lets one booking per quote', async () => {
    const request = await world.request(driver, { status: 'booked' });
    const quote = await world.quote(request.id, garageId, 'accepted');

    expect(
      await race('booking', (tx) =>
        tx.booking.create({
          data: {
            confirmBy: new Date(Date.now() + 24 * HOUR),
            driverId: driver,
            durationMinutes: quote.durationMinutes,
            garageId,
            quoteId: quote.id,
            requestId: request.id,
            startsAt: quote.slot,
          },
        }),
      ),
    ).toEqual(conflict('booking', 'one_booking_per_quote'));
  });

  it('lets one job per booking', async () => {
    const { booking, request } = await world.chain(driver, garageId);

    expect(
      await race('job', (tx) =>
        tx.job.create({
          data: {
            bookingId: booking.id,
            carId: request.carId,
            driverId: driver,
            garageId,
          },
        }),
      ),
    ).toEqual(conflict('job', 'one_job_per_booking'));
  });

  it('lets one accepted quote per request when two are accepted at once', async () => {
    const request = await world.request(driver, { status: 'quoted' });
    const first = await world.quote(request.id, garageId);
    const second = await world.quote(request.id, otherGarageId);
    const accept = (id: string, quoteGarageId: string) =>
      prisma.$transaction((tx) =>
        moveQuote(
          tx,
          { audit: new AuditService(), events: outbox },
          {
            actor: { accountId: driver, role: 'driver' },
            event: {
              audience: {
                driverAccountId: driver,
                garageId: quoteGarageId,
                type: 'quote',
              },
              kind: 'quote.accepted',
            },
            id,
            to: 'accepted',
          },
        ),
      );

    const results = await Promise.allSettled([
      accept(first.id, garageId),
      accept(second.id, otherGarageId),
    ]);

    const lost = loser(results);
    expect(lost.getStatus()).toBe(409);
    expect(lost.getResponse()).toMatchObject({
      code: 'invalid_transition',
      currentStatus: 'waiting',
      entity: 'quote',
      rule: 'one_accepted_quote_per_request',
    });
    expect(
      await prisma.quote.count({
        where: { requestId: request.id, status: 'accepted' },
      }),
    ).toBe(1);
  });

  it('passes on an error that is not one of the rules', async () => {
    const error = new Error('connection reset');

    expect(() => uniqueConflict(error, 'quote')).toThrow(error);
  });
});
