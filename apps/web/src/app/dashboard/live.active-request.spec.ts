import {
  TextDecoder as NodeDecoder,
  TextEncoder as NodeEncoder,
} from 'node:util';

import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { EventKind } from '@motor-fix/contracts';

import {
  ACTIVE_REQUEST_EVENTS,
  Live,
  liveResource,
  REQUEST_EVENTS,
} from './live';
import { Session } from './session';

// @traces 275-FR-001
// @traces 275-FR-002
// @traces 275-FR-007

globalThis.TextEncoder ??= NodeEncoder as typeof TextEncoder;
globalThis.TextDecoder ??= NodeDecoder as unknown as typeof TextDecoder;

// One controllable stream body.
class Body {
  private waiting: ((r: ReadableStreamReadResult<Uint8Array>) => void) | null =
    null;
  private queue: string[] = [];
  readonly reader = {
    cancel: async () => undefined,
    read: () =>
      new Promise<ReadableStreamReadResult<Uint8Array>>((resolve) => {
        const text = this.queue.shift();
        if (text !== undefined)
          resolve({ done: false, value: new TextEncoder().encode(text) });
        else this.waiting = resolve;
      }),
    releaseLock: () => undefined,
  };
  send(text: string) {
    const waiting = this.waiting;
    if (waiting) {
      this.waiting = null;
      waiting({ done: false, value: new TextEncoder().encode(text) });
    } else this.queue.push(text);
  }
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};
const event = (kind: string) =>
  `event: ${kind}\ndata: ${JSON.stringify({ at: '2026-10-29T12:00:00.000Z', id: 'e-1', kind })}\n\n`;

let body: Body;

async function panel(load: () => Promise<number>) {
  body = new Body();
  globalThis.fetch = jest.fn(async () => ({
    body: { getReader: () => body.reader },
    ok: true,
    status: 200,
  })) as unknown as typeof fetch;
  TestBed.configureTestingModule({
    providers: [
      { provide: PLATFORM_ID, useValue: 'browser' },
      {
        provide: Session,
        useValue: {
          current: () => ({ id: 'a1', role: 'driver' }),
          renew: async () => true,
          token: () => 'token-1',
        },
      },
    ],
  });
  const live = TestBed.inject(Live);
  const ref = TestBed.runInInjectionContext(() =>
    liveResource(load, ACTIVE_REQUEST_EVENTS),
  );
  live.open();
  await flush();
  await wait(10);
  return ref;
}

afterEach(() => TestBed.resetTestingModule());

describe('the events the active request follows', () => {
  it('are exactly the request list’s eight plus every request, quote, booking and job step a driver sees', () => {
    const extra: EventKind[] = [
      'request.expired',
      'request.decline_undone',
      'request.direct_answered',
      'quote.changed',
      'quote.withdrawn',
      'quote.expired',
      'quote.closed',
      'quote.declined_by_driver',
      'booking.moved',
      'booking.no_show_recorded',
      'job.received',
      'job.started',
      'job.paused',
      'job.resumed',
      'job.step_done',
      'job.step_undone',
      'job.steps_changed',
      'job.eta_changed',
      'job.done',
      'job.handed_over',
      'job.final_price_corrected',
      'job.mechanic_changed',
      'job.reopened',
    ];

    expect([...ACTIVE_REQUEST_EVENTS].sort()).toEqual(
      [...REQUEST_EVENTS, ...extra].sort(),
    );
    expect(ACTIVE_REQUEST_EVENTS).toHaveLength(31);
    expect(new Set(ACTIVE_REQUEST_EVENTS).size).toBe(31);
  });

  it.each([
    'job.paused',
    'job.final_price_corrected',
    'booking.confirmed',
    'job.step_done',
  ])('re-reads the panel once on %s', async (kind) => {
    let reads = 0;
    const ref = await panel(async () => ++reads);

    body.send(event(kind));
    await wait(400);

    expect(reads).toBe(2);
    expect(ref.value()).toBe(2);
  });

  it('does not re-read on an event outside the list', async () => {
    let reads = 0;
    await panel(async () => ++reads);

    body.send(event('review.published'));
    await wait(400);

    expect(reads).toBe(1);
  });

  it('re-reads once for three job events within 300 ms', async () => {
    let reads = 0;
    await panel(async () => ++reads);

    body.send(event('job.started'));
    await wait(50);
    body.send(event('job.step_done'));
    await wait(50);
    body.send(event('job.step_done'));
    await wait(400);

    expect(reads).toBe(2);
  });

  it('keeps the last value when the re-read fails', async () => {
    let reads = 0;
    const ref = await panel(async () => {
      reads++;
      if (reads > 1) throw new Error('offline');
      return 7;
    });

    body.send(event('job.paused'));
    await wait(400);

    expect(reads).toBe(2);
    expect(ref.value()).toBe(7);
  });
});
