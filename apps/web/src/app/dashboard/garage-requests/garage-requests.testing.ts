import { signal } from '@angular/core';
import type { EventKind, LiveMessage } from '@motor-fix/contracts';
import type {
  GarageRequestListDto,
  GarageRequestSummaryDto,
} from '@motor-fix/data-access';
import { filter, Subject } from 'rxjs';

import type { LiveState } from '../live';

export const wait = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

export const requestRow = (
  over: Partial<GarageRequestSummaryDto> = {},
): GarageRequestSummaryDto => ({
  car: {
    brand: 'Dacia',
    engine: '1.0 TCe',
    fuel: 'petrol',
    model: 'Logan',
    year: 2018,
  },
  closedAt: null,
  closedReason: null,
  createdAt: new Date(Date.now() - 5 * 60_000).toISOString(),
  descriptionLine: null,
  driver: { shortName: 'Vlad P.' },
  expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
  id: 'req-1',
  jobs: [
    {
      id: 'rj-1',
      jobTypeId: 'job-oil',
      nameEn: 'Oil and filter change',
      nameRo: 'Schimb de ulei și filtre',
      offered: true,
      position: 0,
    },
  ],
  quote: null,
  recipient: {
    answeredAt: null,
    declinedAt: null,
    declineReason: null,
    source: 'search',
    status: 'waiting',
  },
  status: 'sent',
  ...over,
});

export const listOf = (
  items: GarageRequestSummaryDto[],
  { nextCursor = null, total = items.length } = {} as {
    nextCursor?: string | null;
    total?: number;
  },
): GarageRequestListDto => ({ items, nextCursor, total });

// The live service as the views see it: messages are pushed by the test.
export function fakeLive() {
  const events = new Subject<LiveMessage>();
  const resync = new Subject<void>();
  return {
    emit: (kind: EventKind, id = 'req-1') =>
      events.next({ at: new Date().toISOString(), id, kind } as LiveMessage),
    events,
    offline: signal(false),
    on: (kinds: readonly EventKind[]) =>
      events.pipe(filter((m) => (kinds as readonly string[]).includes(m.kind))),
    resync,
    state: signal<LiveState>('open'),
  };
}
