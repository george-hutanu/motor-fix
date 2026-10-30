import { addDays, localDay } from '../../bucharest';
import type { PrismaClient, ReviewStatus } from '../../generated/prisma/client';
import { quotesWorld } from '../../quotes/quotes.testing';

export interface MotorFixRepairOptions {
  daysAgo?: number;
  garageName?: string;
  // The jobs of the accepted quote, in Romanian and English, by asked order.
  jobs?: [string, string][];
  // The job's mechanic; null for a job that records none.
  mechanic?: { name: string; isOwner?: boolean; onProfile?: boolean } | null;
  review?: { status: ReviewStatus; rating: number };
  what?: string;
}

// A repair a garage did through MotorFix on `carId`: the request, its
// accepted quote with its included jobs, the booking, the job done by its
// mechanic, the repair row the handover left and, when asked, the review.
export async function motorFixRepair(
  prisma: PrismaClient,
  driverId: string,
  carId: string,
  options: MotorFixRepairOptions = {},
) {
  const world = quotesWorld(prisma);
  const garage = await world.garage(options.garageName ?? 'Garaj Nordic');
  const mechanic =
    options.mechanic === null
      ? null
      : await prisma.mechanic.create({
          data: {
            garageId: garage.id,
            isOwner: options.mechanic?.isOwner ?? false,
            name: options.mechanic?.name ?? 'Mihai Dumitru',
            onProfile: options.mechanic?.onProfile ?? true,
          },
        });
  const request = await world.request(driverId, { carId, status: 'done' });
  const quote = await world.quote(request.id, garage.id, 'accepted');
  const jobs = options.jobs ?? [
    ['Plăcuțe și discuri față', 'Front pads and discs'],
  ];
  for (const [index, [nameRo, nameEn]] of jobs.entries()) {
    const type = await world.jobType(nameRo, nameEn);
    const asked = await prisma.requestJob.create({
      data: { jobTypeId: type.id, position: index + 1, requestId: request.id },
    });
    await prisma.quoteJob.create({
      data: { included: true, quoteId: quote.id, requestJobId: asked.id },
    });
  }
  const booking = await world.booking(quote.id, 'completed');
  const job = await world.job(booking.id, 'done', {
    mechanicId: mechanic?.id,
  });
  const day = addDays(localDay(new Date()), -(options.daysAgo ?? 10));
  const repair = await prisma.repair.create({
    data: {
      carId,
      costBani: 125_000,
      doneOn: new Date(`${day}T00:00:00Z`),
      garageId: garage.id,
      garageName: garage.name,
      jobId: job.id,
      odometerKm: 148_250,
      source: 'motorfix',
      what: options.what ?? jobs.map(([nameRo]) => nameRo).join(', '),
    },
  });
  if (options.review) {
    await prisma.review.create({
      data: {
        driverId,
        garageId: garage.id,
        jobId: job.id,
        mechanicId: mechanic?.id,
        rating: options.review.rating,
        status: options.review.status,
        text: 'Foarte bine, recomand',
      },
    });
  }
  return { garage, job, mechanic, repair };
}
