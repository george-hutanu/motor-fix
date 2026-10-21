import type { QuoteComparisonDto } from '@motor-fix/contracts';

import type { Actor } from '../../auth/policy';
import { type CacheService, cacheKey } from '../../cache/cache.service';

// What the accept call reads before its transaction: the quote's request,
// found only through the driver's own request.
export interface AcceptOwner {
  requestId: string;
}

const SOFT_SECONDS = 90;

export const acceptKey = (driverId: string, quoteId: string) =>
  cacheKey('accept', driverId, quoteId);

// The comparison the driver opened holds what the accept call would read
// first, for each quote still open; an event to the driver or to the garage
// drops it, and the accept takes it once.
export function warmAccept(
  cache: CacheService,
  actor: Actor,
  comparison: QuoteComparisonDto,
) {
  const requestId = comparison.request.id;
  return cache.warm(() =>
    Promise.all(
      comparison.quotes
        .filter((quote) => quote.status === 'waiting')
        .map((quote) =>
          cache.read<AcceptOwner>({
            key: acceptKey(actor.accountId, quote.id),
            read: async () => ({
              tags: [
                `warm:account:${actor.accountId}`,
                `warm:garage:${quote.garage.id}`,
              ],
              value: { requestId },
            }),
            soft: SOFT_SECONDS,
            stale: false,
          }),
        ),
    ),
  );
}
