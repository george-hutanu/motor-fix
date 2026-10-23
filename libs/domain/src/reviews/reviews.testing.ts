import type { ReviewStatus } from '../generated/prisma/enums';
import type { quotesWorld } from '../quotes/quotes.testing';

// The mechanic-read setting both review specs share: Elena, who worked at
// Atelier Dinamo and moved to Service Nord's profile, and her jobs' reviews.
export function mechanicReviews(world: ReturnType<typeof quotesWorld>) {
  const { prisma } = world;

  async function elena() {
    const dinamo = await world.garage('Atelier Dinamo');
    const nord = await world.garage('Service Nord');
    const account = await world.account('Elena Pop', ['mechanic']);
    const mechanic = await prisma.mechanic.create({
      data: {
        accountId: account,
        garageId: nord.id,
        name: 'Elena',
        onProfile: true,
      },
    });
    const driver = await world.account('Andrei Ion Marin', ['driver']);
    return { account, dinamo, driver, mechanic, nord };
  }

  // One finished job of the driver's at the garage, done by the mechanic,
  // and its review posted `minutesAgo` minutes ago.
  async function reviewed(
    driverId: string,
    garageId: string,
    mechanicId: string | null,
    minutesAgo: number,
    extra: { status?: ReviewStatus; text?: string | null } = {},
  ) {
    const { booking } = await world.chain(driverId, garageId);
    const job = await world.job(booking.id, 'done', {
      mechanicId: mechanicId ?? undefined,
    });
    return prisma.review.create({
      data: {
        driverId,
        garageId,
        jobId: job.id,
        mechanicId,
        postedAt: new Date(Date.now() - minutesAgo * 60_000),
        rating: (minutesAgo % 5) + 1,
        status: extra.status ?? 'published',
        text:
          extra.text !== undefined
            ? extra.text
            : minutesAgo % 2
              ? null
              : `Recenzia ${minutesAgo}`,
      },
    });
  }

  return { elena, reviewed };
}
