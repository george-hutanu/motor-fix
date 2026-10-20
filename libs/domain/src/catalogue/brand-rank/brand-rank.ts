import { byCodePoint } from '@motor-fix/contracts/demand-order';

import { addDays, localDay } from '../../bucharest';
import type { PrismaClient } from '../../generated/prisma/client';

// The closed Europe/Bucharest days the ranking counts, ending yesterday.
const WINDOW_DAYS = 30;

type Db = Pick<PrismaClient, '$transaction'>;

interface BrandRanking {
  // Active brands given a rank.
  ranked: number;
  // Brands whose rank the run changed.
  changed: number;
}

// Gives every active brand its own rank from 1: the brands searched in the
// window by their searches, then the rest by the rank they hold (none last),
// then by name. Searches are kept under the name the brand had then, so a
// renamed brand's older searches no longer count for it.
export async function rankBrands(db: Db, now: Date): Promise<BrandRanking> {
  const yesterday = addDays(localDay(now), -1);
  const from = addDays(yesterday, -(WINDOW_DAYS - 1));

  // Read and write under one lock: two runs never interleave, so the order a
  // run writes is the one it read, and a failure leaves every rank as it was.
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('brand_rank'))`;
    const rows = await tx.demandDaily.groupBy({
      _sum: { searches: true },
      by: ['key'],
      where: {
        day: { gte: new Date(from), lte: new Date(yesterday) },
        dimension: 'brand',
        searches: { gt: 0 },
      },
    });
    const searches = new Map(
      rows.map((row) => [row.key, row._sum.searches ?? 0]),
    );
    const brands = await tx.brand.findMany({
      select: { id: true, name: true, popularity: true },
      where: { active: true },
    });
    const order = brands
      .map((brand) => ({ ...brand, searches: searches.get(brand.name) ?? 0 }))
      .sort(
        (a, b) =>
          b.searches - a.searches ||
          (a.popularity ?? Number.POSITIVE_INFINITY) -
            (b.popularity ?? Number.POSITIVE_INFINITY) ||
          byCodePoint(a.name, b.name),
      );
    const ids = order.map((brand) => brand.id);
    const ranks = order.map((_, at) => at + 1);
    const changed = await tx.$executeRaw`
      UPDATE brand AS b SET popularity = r.rank
      FROM unnest(${ids}::uuid[], ${ranks}::int[]) AS r(id, rank)
      WHERE b.id = r.id AND b.popularity IS DISTINCT FROM r.rank`;
    return { changed, ranked: order.length };
  });
}
