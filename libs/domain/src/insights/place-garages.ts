import { Logger } from '@nestjs/common';

import type { PrismaClient } from '../generated/prisma/client';
import { cityOf } from '../places/city';
import { recordLookup } from '../places/lookup/places/places.metrics';
import type {
  PlacesAnswer,
  PlacesProvider,
} from '../places/providers/places.provider';

export const PLACE_GARAGES_PER_NIGHT = 25;

const logger = new Logger('Insights');

// Gives a city to the garages saved before the address carried one, a few a
// night so the look-up's free quota holds: the listed ones first, then the
// oldest. One the look-up cannot place is asked again the next night; once
// the look-up is down, the rest wait for the next night too.
export async function placeGarages(db: PrismaClient, provider: PlacesProvider) {
  const garages = await db.garage.findMany({
    orderBy: [
      { approvedAt: { nulls: 'last', sort: 'asc' } },
      { createdAt: 'asc' },
    ],
    select: { address: true, id: true, seatAddress: true },
    take: PLACE_GARAGES_PER_NIGHT,
    where: {
      cityKey: null,
      OR: [{ address: { not: null } }, { seatAddress: { not: null } }],
    },
  });
  let placed = 0;
  for (const { address, id, seatAddress } of garages) {
    const started = performance.now();
    const answer = await provider
      .search((address ?? seatAddress) as string, 'ro')
      .catch((): PlacesAnswer => ({ unavailable: 'thrown' }));
    const seconds = (performance.now() - started) / 1_000;
    if ('unavailable' in answer) {
      recordLookup(provider.name, 'unavailable', seconds);
      break;
    }
    recordLookup(
      provider.name,
      answer.items.length ? 'found' : 'empty',
      seconds,
    );
    const city = cityOf(answer.items[0]?.locality);
    if (!city) continue;
    await db.garage.update({
      data: { cityKey: city.key, cityName: city.name },
      where: { id },
    });
    placed += 1;
  }
  const unplaced = garages.length - placed;
  logger.log(`placed ${placed}, unplaced ${unplaced}`);
  return { placed, unplaced };
}
