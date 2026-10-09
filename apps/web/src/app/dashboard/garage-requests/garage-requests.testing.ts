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

// A request the garage answered: its quote waits for the driver.
export const quotedRow = (
  over: Partial<GarageRequestSummaryDto> = {},
  quote: Partial<NonNullable<GarageRequestSummaryDto['quote']>> = {},
): GarageRequestSummaryDto =>
  requestRow({
    id: 'req-q1',
    quote: {
      acceptedAt: null,
      changedAt: null,
      durationMinutes: 90,
      expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      fromBani: 65_000,
      id: 'quote-1',
      jobs: [{ included: true, requestJobId: 'rj-1' }],
      note: null,
      sentAt: new Date(Date.now() - 60_000).toISOString(),
      slot: new Date(Date.now() + 86_400_000).toISOString(),
      status: 'waiting',
      toBani: 80_000,
      withdrawnAt: null,
      ...quote,
    },
    recipient: {
      answeredAt: new Date(Date.now() - 60_000).toISOString(),
      declinedAt: null,
      declineReason: null,
      source: 'search',
      status: 'quoted',
    },
    status: 'quoted',
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

// IntersectionObserver for a list's end: `reachEnd` tells every watched
// element it came into view.
export function fakeObservers() {
  let observers: {
    callback: IntersectionObserverCallback;
    target?: Element;
  }[] = [];
  class FakeObserver {
    private readonly entry: {
      callback: IntersectionObserverCallback;
      target?: Element;
    };
    constructor(callback: IntersectionObserverCallback) {
      this.entry = { callback };
      observers.push(this.entry);
    }
    observe(target: Element) {
      this.entry.target = target;
    }
    disconnect() {
      observers = observers.filter((o) => o !== this.entry);
    }
    unobserve() {}
    takeRecords() {
      return [];
    }
  }
  (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver =
    FakeObserver;
  return {
    reachEnd() {
      for (const { callback, target } of observers) {
        if (!target) continue;
        callback(
          [
            {
              isIntersecting: true,
              target,
            } as unknown as IntersectionObserverEntry,
          ],
          {} as IntersectionObserver,
        );
      }
    },
  };
}
