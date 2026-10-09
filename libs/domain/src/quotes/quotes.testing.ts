import { randomUUID } from 'node:crypto';

import { CURRENT_CONSENT } from '@motor-fix/contracts';

import {
  BOOKING_CONFIRM_LAPSE_HOURS,
  QUOTE_VALIDITY_DAYS,
  REQUEST_VALIDITY_DAYS,
} from './quotes-config';
import { AuditService } from '../audit/audit.service';
import { AccountsService } from '../auth/accounts.service';
import type { Role } from '../auth/capabilities';
import { createPrisma } from '../auth/prisma';
import { noEvents } from '../events/event.port';
import type { PrismaClient } from '../generated/prisma/client';
import type {
  BookingStatus,
  JobStatus,
  QuoteRequestStatus,
  QuoteStatus,
  RecipientStatus,
} from '../generated/prisma/enums';

export const databaseUrl =
  process.env['DATABASE_URL'] ?? 'postgresql://localhost:5432/postgres';

const HOUR = 3_600_000;

// Rows written straight to the tables, in any status, so a spec can start
// from the state it is about. The status-owned columns are filled as the
// database's CHECKs require.
export function quotesWorld(prisma: PrismaClient = createPrisma(databaseUrl)) {
  const accounts = new AccountsService(prisma, new AuditService(), noEvents);

  async function account(name: string, roles: Role[] = ['driver']) {
    const { id } = await accounts.createAccount({
      consent: CURRENT_CONSENT,
      identity: { method: 'google', subject: `${name}-${randomUUID()}` },
      name,
      roles,
    });
    return id;
  }

  async function garage(name: string) {
    return prisma.garage.create({
      data: { name, slug: `garage-${randomUUID()}`, status: 'approved' },
    });
  }

  async function car(ownerId: string, plate: string | null = 'B123ABC') {
    const brand = await prisma.brand.create({
      data: {
        key: `mini-${randomUUID()}`,
        name: `Mini ${randomUUID()}`,
        slug: `mini-${randomUUID()}`,
      },
    });
    return prisma.car.create({
      data: {
        brandId: brand.id,
        engine: '2.0 turbo',
        fuel: 'petrol',
        idempotencyKey: randomUUID(),
        model: 'Cooper S',
        odometerKm: 84_000,
        ownerId,
        plate,
        year: 2019,
      },
    });
  }

  async function jobType(nameRo = 'Schimb ulei', nameEn = 'Oil change') {
    return prisma.jobType.create({
      data: { key: `job-${randomUUID()}`, nameEn, nameRo, status: 'approved' },
    });
  }

  async function request(
    driverId: string,
    options: {
      carId?: string;
      createdAt?: Date;
      description?: string | null;
      status?: QuoteRequestStatus;
    } = {},
  ) {
    const carId = options.carId ?? (await car(driverId)).id;
    const createdAt = options.createdAt ?? new Date();
    const status = options.status ?? 'sent';
    const closed = status === 'closed';
    const row = await prisma.quoteRequest.create({
      data: {
        carBrand: 'Mini',
        carEngine: '2.0 turbo',
        carFuel: 'petrol',
        carId,
        carModel: 'Cooper S',
        carYear: 2019,
        createdAt,
        description:
          options.description === undefined
            ? 'Scârțâie la frânare'
            : options.description,
        driverId,
        expiresAt: new Date(
          createdAt.getTime() + REQUEST_VALIDITY_DAYS * 24 * HOUR,
        ),
        idempotencyKey: randomUUID(),
        status,
        ...(closed && { closedAt: createdAt, closedReason: 'cancelled' }),
      },
    });
    const type = await jobType();
    await prisma.requestJob.create({
      data: { jobTypeId: type.id, position: 0, requestId: row.id },
    });
    return row;
  }

  async function recipient(
    requestId: string,
    garageId: string,
    status: RecipientStatus = 'waiting',
    declinedBy?: string,
  ) {
    const declined = status === 'declined';
    return prisma.requestRecipient.create({
      data: {
        garageId,
        requestId,
        source: 'search',
        status,
        ...(declined && {
          answeredAt: new Date(),
          declinedAt: new Date(),
          declinedBy,
          declineReason: 'fully_booked',
        }),
      },
    });
  }

  async function quote(
    requestId: string,
    garageId: string,
    status: QuoteStatus = 'waiting',
  ) {
    const to =
      (await prisma.requestRecipient.findUnique({
        where: { requestId_garageId: { garageId, requestId } },
      })) ?? (await recipient(requestId, garageId, 'quoted'));
    return prisma.quote.create({
      data: {
        durationMinutes: 90,
        expiresAt: new Date(Date.now() + QUOTE_VALIDITY_DAYS * 24 * HOUR),
        fromBani: 45_000,
        garageId,
        recipientId: to.id,
        requestId,
        slot: new Date(Date.now() + 48 * HOUR),
        status,
        toBani: 60_000,
        ...(status === 'accepted' && { acceptedAt: new Date() }),
        ...(status === 'withdrawn' && { withdrawnAt: new Date() }),
      },
    });
  }

  async function booking(
    quoteId: string,
    status: BookingStatus = 'awaiting_confirmation',
    options: { mechanicId?: string; confirmedBy?: string } = {},
  ) {
    const q = await prisma.quote.findUniqueOrThrow({
      include: { request: true },
      where: { id: quoteId },
    });
    const now = new Date();
    const confirmed = ['confirmed', 'no_show', 'completed'].includes(status);
    return prisma.booking.create({
      data: {
        confirmBy: new Date(now.getTime() + BOOKING_CONFIRM_LAPSE_HOURS * HOUR),
        driverId: q.request.driverId,
        durationMinutes: q.durationMinutes,
        garageId: q.garageId,
        mechanicId: options.mechanicId,
        quoteId,
        requestId: q.requestId,
        startsAt: q.slot,
        status,
        ...(confirmed && {
          confirmedAt: now,
          confirmedBy: options.confirmedBy,
        }),
        ...(status === 'cancelled' && {
          cancelledAt: now,
          cancelledBy: q.request.driverId,
          cancelledBySide: 'driver',
          cancelReason: 'plans_changed',
        }),
        ...(status === 'no_show' && { noShowAt: now }),
        ...(status === 'completed' && { completedAt: now }),
      },
    });
  }

  async function job(
    bookingId: string,
    status: JobStatus = 'to_do',
    options: { mechanicId?: string; createdAt?: Date } = {},
  ) {
    const b = await prisma.booking.findUniqueOrThrow({
      include: { request: true },
      where: { id: bookingId },
    });
    return prisma.job.create({
      data: {
        bookingId,
        carId: b.request.carId,
        createdAt: options.createdAt,
        driverId: b.driverId,
        garageId: b.garageId,
        mechanicId: options.mechanicId ?? b.mechanicId,
        status,
      },
    });
  }

  // A driver's request sent to one garage, quoted, accepted and booked:
  // every row up to the booking, each in the status asked.
  async function chain(
    driverId: string,
    garageId: string,
    statuses: {
      request?: QuoteRequestStatus;
      quote?: QuoteStatus;
      booking?: BookingStatus;
    } = {},
  ) {
    const r = await request(driverId, { status: statuses.request ?? 'booked' });
    const q = await quote(r.id, garageId, statuses.quote ?? 'accepted');
    const b = await booking(q.id, statuses.booking ?? 'confirmed');
    return { booking: b, quote: q, request: r };
  }

  const reset = () =>
    prisma.$executeRawUnsafe(
      'TRUNCATE account, garage, brand, job_type CASCADE',
    );

  return {
    account,
    booking,
    car,
    chain,
    garage,
    job,
    jobType,
    prisma,
    quote,
    recipient,
    request,
    reset,
  };
}
