import type { JobStatus } from '../../generated/prisma/enums';
import type { quotesApp } from '../quotes-api.testing';

const MINUTE = 60_000;

// Andrei's confirmed booking at Volt Auto with Fixer on lift 1, starting
// `minutes` from now (30 minutes ago by default), holding its one segment,
// with its job when asked.
export function noShowWorld({ team, world }: ReturnType<typeof quotesApp>) {
  const { prisma } = world;

  async function due(
    options: { minutes?: number; job?: JobStatus; garage?: string } = {},
  ) {
    const volt = await team(options.garage ?? 'Volt Auto');
    const startsAt = new Date(Date.now() + (options.minutes ?? -30) * MINUTE);
    const booking = await world.booked(
      volt.garage.id,
      startsAt.toISOString(),
      'confirmed',
      { lift: 1, mechanicId: volt.answeringMechanic.id },
    );
    const job = options.job
      ? await world.job(booking.id, options.job, {
          mechanicId: volt.answeringMechanic.id,
        })
      : null;
    return { booking, job, volt };
  }

  // What a refusal must leave as it was.
  const snapshot = async (bookingId: string) => {
    const booking = await prisma.booking.findUniqueOrThrow({
      where: { id: bookingId },
    });
    return {
      audit: await prisma.activityLog.count(),
      booking,
      job: await prisma.job.findUnique({ where: { bookingId } }),
      outbox: await prisma.outboxEvent.count(),
      request: await prisma.quoteRequest.findUniqueOrThrow({
        where: { id: booking.requestId },
      }),
      segments: await prisma.bookingSegment.findMany({ where: { bookingId } }),
    };
  };

  return { due, snapshot };
}
