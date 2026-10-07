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
let answer: () => Promise<unknown>;

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

describe('AdminOverview under hostile answers and event orders', () => {
  it('gives 0, not no count, when the answer is zero', async () => {
    answer = async () => ({ garagesWaiting: 0 });
    const overview = setUp();
    await wait(0);

    expect(overview.waiting()).toBe(0);
    expect(overview.failed()).toBe(false);
  });

  it('gives no count when the answer carries no garagesWaiting', async () => {
    answer = async () => ({});
    const overview = setUp();
    await wait(0);

    expect(overview.waiting()).toBeUndefined();
  });

  it('gives no count when the read answers 404', async () => {
    answer = async () => {
      throw new HttpErrorResponse({ status: 404 });
    };
    const overview = setUp();
    await wait(0);

    expect(overview.failed()).toBe(true);
    expect(overview.waiting()).toBeUndefined();
  });

  it('gives no count when the read answers 401 or 403', async () => {
    answer = async () => {
      throw new HttpErrorResponse({ status: 403 });
    };
    const overview = setUp();
    await wait(0);

    expect(overview.waiting()).toBeUndefined();
    expect(overview.failed()).toBe(true);
  });

  it('ignores review events and unrelated kinds', async () => {
    answer = async () => ({ garagesWaiting: 1 });
    setUp();
    await wait(0);
    events.next(message('review.reported'));
    events.next(message('review.decided'));
    events.next(message('verification.opened'));
    await wait(450);

    expect(reads).toBe(1);
  });

  it('reads again for each listed kind when the events are 300 ms apart', async () => {
    answer = async () => ({ garagesWaiting: 1 });
    setUp();
    await wait(0);
    for (const kind of [
      'verification.submitted',
      'verification.decided',
      'verification.reopened',
    ] as const) {
      events.next(message(kind, `file-${kind}`));
      await wait(400);
    }

    expect(reads).toBe(4);
  });

  it('matches by kind whatever the object id, including an empty one', async () => {
    answer = async () => ({ garagesWaiting: 1 });
    setUp();
    await wait(0);
    events.next(message('verification.submitted', ''));
    await wait(450);

    expect(reads).toBe(2);
  });

  it('ends on the true number when an event lands while a read is in flight', async () => {
    let count = 4;
    const releases: (() => void)[] = [];
    answer = () => {
      const seen = count;
      return new Promise((resolve) => {
        releases.push(() => resolve({ garagesWaiting: seen }));
      });
    };
    const overview = setUp();
    await wait(0);
    releases.shift()?.();
    await wait(0);
    expect(overview.waiting()).toBe(4);

    events.next(message('verification.submitted'));
    await wait(350);
    count = 5;
    events.next(message('verification.decided'));
    await wait(350);
    while (releases.length) {
      releases.shift()?.();
      await wait(0);
    }
    await wait(50);

    expect(overview.waiting()).toBe(5);
  });

  it('hides the count at once when a re-read fails and brings it back on reconnect', async () => {
    let ok = true;
    answer = async () => {
      if (!ok) throw new HttpErrorResponse({ status: 500 });
      return { garagesWaiting: 7 };
    };
    const overview = setUp();
    await wait(0);
    expect(overview.waiting()).toBe(7);

    ok = false;
    resync.next();
    await wait(0);
    expect(overview.waiting()).toBeUndefined();
    expect(overview.failed()).toBe(true);

    ok = true;
    resync.next();
    await wait(0);
    expect(overview.waiting()).toBe(7);
    expect(overview.failed()).toBe(false);
  });

  it('reads nothing after it is destroyed', async () => {
    answer = async () => ({ garagesWaiting: 1 });
    setUp();
    await wait(0);
    TestBed.resetTestingModule();
    events.next(message('verification.submitted'));
    resync.next();
    await wait(450);

    expect(reads).toBe(1);
  });
});
