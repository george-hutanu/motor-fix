import {
  TextDecoder as NodeDecoder,
  TextEncoder as NodeEncoder,
} from 'node:util';

import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { EVENT_KINDS } from '@motor-fix/contracts';

import {
  ACTIVE_REQUEST_EVENTS,
  APPROVAL_EVENTS,
  Live,
  liveResource,
  REQUEST_EVENTS,
} from './live';
import { Session } from './session';

// @traces 275-FR-001
// @traces 275-FR-002

globalThis.TextEncoder ??= NodeEncoder as typeof TextEncoder;
globalThis.TextDecoder ??= NodeDecoder as unknown as typeof TextDecoder;

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
const event = (kind: string, id = 'e-1') =>
  `event: ${kind}\ndata: ${JSON.stringify({ at: '2026-10-29T12:00:00.000Z', id, kind })}\n\n`;

let body: Body;

async function panel<T>(load: () => Promise<T>, id?: () => string) {
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
    liveResource(load, ACTIVE_REQUEST_EVENTS, id),
  );
  live.open();
  await flush();
  await wait(10);
  return ref;
}

afterEach(() => TestBed.resetTestingModule());

describe('the active request event list under attack', () => {
  it('holds only kinds the contracts declare, each once', () => {
    for (const kind of ACTIVE_REQUEST_EVENTS)
      expect(EVENT_KINDS).toContain(kind);
    expect(new Set(ACTIVE_REQUEST_EVENTS).size).toBe(
      ACTIVE_REQUEST_EVENTS.length,
    );
  });

  it('contains every request kind and none of the approval kinds', () => {
    for (const kind of REQUEST_EVENTS)
      expect(ACTIVE_REQUEST_EVENTS).toContain(kind);
    for (const kind of APPROVAL_EVENTS)
      expect(ACTIVE_REQUEST_EVENTS).not.toContain(kind);
  });

  it.each([
    'job.odometer_recorded',
    'job.part_updated',
    'booking.move_proposed',
    'review.published',
  ])('leaves %s out, the panel shows nothing it moves', (kind) => {
    expect(ACTIVE_REQUEST_EVENTS).not.toContain(kind);
  });
});

describe('the panel re-read under hostile streams', () => {
  it.each(ACTIVE_REQUEST_EVENTS.map((k) => [k]))(
    're-reads once on %s',
    async (kind) => {
      let reads = 0;
      await panel(async () => ++reads);

      body.send(event(kind));
      await wait(400);

      expect(reads).toBe(2);
    },
  );

  it('re-reads once for a burst of fifty events within 300 ms', async () => {
    let reads = 0;
    await panel(async () => ++reads);

    for (let i = 0; i < 50; i++) body.send(event('job.step_done', `e-${i}`));
    await wait(500);

    expect(reads).toBe(2);
  });

  it('runs one read at a time when an event lands during a slow read', async () => {
    let running = 0;
    let peak = 0;
    let reads = 0;
    await panel(async () => {
      reads++;
      running++;
      peak = Math.max(peak, running);
      await wait(reads === 1 ? 0 : 500);
      running--;
      return reads;
    });

    body.send(event('job.started'));
    await wait(350);
    body.send(event('job.done', 'e-2'));
    await wait(1500);

    expect(peak).toBe(1);
    expect(reads).toBe(3);
  });

  it('ignores a message with an unknown kind', async () => {
    let reads = 0;
    await panel(async () => ++reads);

    body.send(event('job.teleported'));
    await wait(400);

    expect(reads).toBe(1);
  });

  it('survives a malformed data line and still re-reads on the next event', async () => {
    let reads = 0;
    await panel(async () => ++reads);

    body.send('event: job.started\ndata: {not json\n\n');
    await wait(50);
    body.send(event('job.started'));
    await wait(400);

    expect(reads).toBe(2);
  });

  it('re-reads on an event for another request of the same driver when no id is given', async () => {
    let reads = 0;
    await panel(async () => ++reads, undefined);

    body.send(event('job.step_done', 'some-other-request'));
    await wait(400);

    expect(reads).toBe(2);
  });

  it('clears the error and shows the value when an event follows a failed first read', async () => {
    let reads = 0;
    const ref = await panel(async () => {
      reads++;
      if (reads === 1) throw new Error('api down');
      return 'in_work';
    });
    expect(ref.error()).toBeInstanceOf(Error);
    expect(ref.value()).toBeUndefined();

    body.send(event('job.started'));
    await wait(400);

    expect(ref.value()).toBe('in_work');
    expect(ref.error()).toBeUndefined();
  });

  it('keeps the same object reference when the re-read returns equal data', async () => {
    let reads = 0;
    const ref = await panel(async () => {
      reads++;
      return { stage: 'in_work', steps: [{ id: 's1', state: 'now' }] };
    });
    const before = ref.value();

    body.send(event('job.step_done'));
    await wait(400);

    expect(reads).toBe(2);
    expect(ref.value()).toBe(before);
  });

  it('changes only the part that changed on a re-read', async () => {
    let reads = 0;
    const ref = await panel(async () => ({
      car: { brand: 'BMW' },
      stage: reads++ === 0 ? 'booked' : 'in_work',
    }));
    const car = ref.value()?.car;

    body.send(event('job.started'));
    await wait(400);

    expect(ref.value()?.stage).toBe('in_work');
    expect(ref.value()?.car).toBe(car);
  });
});
