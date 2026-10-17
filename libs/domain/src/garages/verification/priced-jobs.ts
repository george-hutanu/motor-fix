import type { VerificationFileJobDto } from '@motor-fix/contracts';

import type { Prisma } from '../../generated/prisma/client';

// Every job of the garage's price list once, in the list's order, whatever
// its status or visibility.
export async function pricedJobs(
  client: Pick<Prisma.TransactionClient, 'garagePrice'>,
  garageId: string,
): Promise<VerificationFileJobDto[]> {
  const prices = await client.garagePrice.findMany({
    orderBy: [{ position: 'asc' }, { id: 'asc' }],
    select: {
      jobType: {
        select: { id: true, nameEn: true, nameRo: true, rarActivity: true },
      },
    },
    where: { garageId },
  });
  return jobsOf(prices);
}

// A job priced for several brands is one job.
function jobsOf(
  prices: {
    jobType: {
      id: string;
      nameEn: string;
      nameRo: string;
      rarActivity: string | null;
    };
  }[],
) {
  const jobs = new Map<string, VerificationFileJobDto>();
  for (const { jobType } of prices) {
    if (jobs.has(jobType.id)) continue;
    jobs.set(jobType.id, {
      jobTypeId: jobType.id,
      nameEn: jobType.nameEn,
      nameRo: jobType.nameRo,
      rarActivity: jobType.rarActivity,
    });
  }
  return [...jobs.values()];
}
