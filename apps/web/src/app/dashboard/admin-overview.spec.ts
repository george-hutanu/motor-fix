import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import type { EventKind, LiveMessage } from '@motor-fix/contracts';
import { AdminService } from '@motor-fix/data-access';
import { filter, Subject } from 'rxjs';

import { AdminOverview } from './admin-overview';
import { Live } from './live';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

let events: Subject<LiveMessage>;
let resync: Subject<void>;
let reads: number;
let answer: () => Promise<{ garagesWaiting: number }>;

function setUp() {
  events = new Subject();
  resync = new Subject();
  reads = 0;
  TestBed.configureTestingModule({
    providers: [
      AdminOverview,
      {
        provide: Live,
        useValue: {
          events,
          on: (kinds: readonly EventKind[]) =>
            events.pipe(
              filter((m) => (kinds as readonly string[]).includes(m.kind)),
            ),
          resync,
        },
      },
      {
        provide: AdminService,
        useValue: {
          adminOverviewControllerOverview: () => {
            reads++;
            return answer();
          },
        },
      },
    ],
  });
  return TestBed.inject(AdminOverview);
}

const message = (kind: EventKind, id = 'file-1'): LiveMessage => ({
  at: '2026-10-07T09:00:00.000Z',
  id,
  kind,
});

afterEach(() => TestBed.resetTestingModule());

describe('AdminOverview', () => {
  it('is loading until the first read answers, then gives the count', async () => {
    let finish: (() => void) | undefined;
    answer = () =>
      new Promise((resolve) => {
        finish = () => resolve({ garagesWaiting: 2 });
      });
    const overview = setUp();
    await wait(0);

    expect(overview.loading()).toBe(true);
    expect(overview.waiting()).toBeUndefined();

    finish?.();
    await wait(0);

    expect(overview.loading()).toBe(false);
    expect(overview.waiting()).toBe(2);
    expect(overview.failed()).toBe(false);
  });

  it('gives no count, never 0, when the first read fails', async () => {
    answer = async () => {
      throw new HttpErrorResponse({ status: 503 });
    };
    const overview = setUp();
    await wait(0);

    expect(overview.loading()).toBe(false);
    expect(overview.failed()).toBe(true);
    expect(overview.waiting()).toBeUndefined();
  });

  it('drops the count it showed when a re-read fails, and shows the next one that succeeds', async () => {
    answer = async () => ({ garagesWaiting: 3 });
    const overview = setUp();
    await wait(0);
    expect(overview.waiting()).toBe(3);

    answer = async () => {
      throw new HttpErrorResponse({ status: 0 });
    };
    resync.next();
    await wait(0);
    expect(overview.failed()).toBe(true);
    expect(overview.waiting()).toBeUndefined();

    answer = async () => ({ garagesWaiting: 4 });
    resync.next();
    await wait(0);
    expect(overview.failed()).toBe(false);
    expect(overview.waiting()).toBe(4);
  });

  it.each<EventKind>([
    'verification.submitted',
    'verification.decided',
    'verification.reopened',
  ])('reads the count again on %s, whatever file it is about', async (kind) => {
    let waiting = 1;
    answer = async () => ({ garagesWaiting: waiting });
    const overview = setUp();
    await wait(0);

    waiting = 2;
    events.next(message(kind, 'any-file'));
    await wait(400);

    expect(reads).toBe(2);
    expect(overview.waiting()).toBe(2);
  });

  it('does not read again when a file is only opened', async () => {
    answer = async () => ({ garagesWaiting: 1 });
    setUp();
    await wait(0);

    events.next(message('verification.opened'));
    await wait(400);

    expect(reads).toBe(1);
  });

  it('reads once for the events of 300 ms', async () => {
    answer = async () => ({ garagesWaiting: 1 });
    setUp();
    await wait(0);

    events.next(message('verification.submitted', 'file-1'));
    await wait(50);
    events.next(message('verification.decided', 'file-2'));
    await wait(400);

    expect(reads).toBe(2);
  });

  it('reads again when the stream reconnects', async () => {
    answer = async () => ({ garagesWaiting: 1 });
    setUp();
    await wait(0);

    resync.next();
    await wait(0);

    expect(reads).toBe(2);
  });
});
