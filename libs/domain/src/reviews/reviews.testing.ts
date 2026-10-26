import type {
  ReviewReplyStatus,
  ReviewStatus,
} from '../generated/prisma/enums';
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

interface GarageReviewOptions {
  rating?: number;
  minutesAgo?: number;
  status?: ReviewStatus;
  text?: string | null;
  source?: 'job' | 'profile';
  quote?: { fromBani: number; toBani: number };
  finalPriceBani?: number;
  paidBani?: number;
  editedAt?: Date;
  // The quote's jobs, in request order; only the included ones name it.
  jobs?: { nameRo: string; nameEn: string; included?: boolean }[];
}

// A garage's reviews as its profile reads them: each one a finished job on a
// BMW 320d, quoted with the jobs asked.
export function garageReviews(world: ReturnType<typeof quotesWorld>) {
  const { prisma } = world;

  // The quote's ends and the job's final price the options name.
  async function priced(
    quoteId: string,
    jobId: string,
    { finalPriceBani, quote }: GarageReviewOptions,
  ) {
    if (quote) {
      await prisma.quote.update({ data: quote, where: { id: quoteId } });
    }
    if (finalPriceBani !== undefined) {
      await prisma.job.update({
        data: { finalPriceBani },
        where: { id: jobId },
      });
    }
  }

  async function review(
    garageId: string,
    driverId: string,
    options: GarageReviewOptions = {},
  ) {
    const { booking, quote, request } = await world.chain(driverId, garageId);
    await prisma.quoteRequest.update({
      data: { carBrand: 'BMW', carModel: '320d' },
      where: { id: request.id },
    });
    const jobs = options.jobs ?? [
      { nameEn: 'Timing chain kit', nameRo: 'Kit lanț distribuție' },
    ];
    for (const [position, one] of jobs.entries()) {
      const type = await world.jobType(one.nameRo, one.nameEn);
      const asked = await prisma.requestJob.create({
        data: {
          jobTypeId: type.id,
          position: position + 1,
          requestId: request.id,
        },
      });
      await prisma.quoteJob.create({
        data: {
          included: one.included ?? true,
          quoteId: quote.id,
          requestJobId: asked.id,
        },
      });
    }
    const job = await world.job(booking.id, 'done');
    await priced(quote.id, job.id, options);
    return prisma.review.create({
      data: {
        driverId,
        editedAt: options.editedAt,
        garageId,
        jobId: job.id,
        paidBani: options.paidBani,
        postedAt: new Date(Date.now() - (options.minutesAgo ?? 1) * 60_000),
        rating: options.rating ?? 5,
        source: options.source ?? 'job',
        status: options.status ?? 'published',
        text: options.text === undefined ? 'Treabă curată.' : options.text,
      },
    });
  }

  return { review };
}

// A garage's reply on one of its reviews, as the owner's POST or an admin's
// decision leaves it.
export function reviewReply(world: ReturnType<typeof quotesWorld>) {
  return (
    reviewId: string,
    options: {
      status?: ReviewReplyStatus;
      text?: string;
      postedAt?: Date;
      editedAt?: Date | null;
    } = {},
  ) =>
    world.prisma.review
      .findUniqueOrThrow({ where: { id: reviewId } })
      .then((review) =>
        world.prisma.reviewReply.create({
          data: {
            editedAt: options.editedAt ?? null,
            garageId: review.garageId,
            postedAt: options.postedAt ?? new Date(),
            reviewId,
            status: options.status ?? 'published',
            text: options.text ?? 'Mulțumim, Andrei!',
            ...(options.status === 'removed' && {
              removedAt: new Date(),
              removedCause: 'report_upheld' as const,
            }),
          },
        }),
      );
}
