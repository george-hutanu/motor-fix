import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import type { EventKind, LiveMessage } from '@motor-fix/contracts';
import { AdminService } from '@motor-fix/data-access';
import { filter, Subject } from 'rxjs';

import { AdminOverview } from './admin-overview';
import { Live } from './live';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

let events: Subject<LiveMessage>;
let calls: Record<string, unknown>[];
let answer: (params: Record<string, unknown>) => Promise<unknown>;

function setUp() {
  events = new Subject();
  calls = [];
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
          resync: new Subject<void>(),
        },
      },
      {
        provide: AdminService,
        useValue: {
          adminOverviewControllerOverview: (
            params: Record<string, unknown>,
          ) => {
            calls.push(params);
            return answer(params);
          },
        },
      },
    ],
  });
  return TestBed.inject(AdminOverview);
}

const unknownCity = () =>
  new HttpErrorResponse({
    error: { errors: [{ code: 'unknown', field: 'city' }] },
    status: 400,
  });

afterEach(() => TestBed.resetTestingModule());

// @traces 163-FR-009 163-FR-010
describe('AdminOverview under hostile choices and answers', () => {
  it('opens on the whole country and the default period and sends no parameter', async () => {
    answer = async () => ({ garagesWaiting: 4 });
    const overview = setUp();
    await wait(0);

    expect([overview.city(), overview.period()]).toEqual(['all', 'default']);
    expect(calls).toEqual([{}]);
  });

  it('reads nothing when the same choice is made again', async () => {
    answer = async () => ({ garagesWaiting: 4 });
    const overview = setUp();
    await wait(0);

    overview.choose('all', 'default');
    await wait(10);

    expect(calls).toHaveLength(1);
  });

  it('sends the city and the period when both are chosen', async () => {
    answer = async () => ({ garagesWaiting: 4 });
    const overview = setUp();
    await wait(0);

    overview.choose('cluj-napoca', '7d');
    await wait(10);

    expect(calls.at(-1)).toEqual({ city: 'cluj-napoca', period: '7d' });
  });

  it('shows only the answer to the latest choice when an older one arrives later', async () => {
    const slow = new Map<string, (v: unknown) => void>();
    answer = (params) =>
      params['city'] === 'a'
        ? new Promise((resolve) => slow.set('a', resolve))
        : Promise.resolve({
            activeDrivers: 0,
            garagesListed: 2,
            garagesWaiting: 1,
          });
    const overview = setUp();
    await wait(0);
    overview.choose('a', 'default');
    await wait(0);
    overview.choose('all', '7d');
    await wait(10);
    slow.get('a')?.({ garagesListed: 99, garagesWaiting: 99 });
    await wait(10);

    expect(overview.figures()?.garagesListed).toBe(2);
  });

  it('falls back to the whole country, keeping the period, when the city is refused as unknown', async () => {
    answer = async (params) => {
      if (params['city']) throw unknownCity();
      return { garagesListed: 3, garagesWaiting: 5 };
    };
    const overview = setUp();
    await wait(0);

    overview.choose('gone', '30d');
    await wait(20);

    expect(overview.city()).toBe('all');
    expect(overview.period()).toBe('30d');
    expect(overview.fellBack()).toBe(true);
    expect(overview.failed()).toBe(false);
  });

  it('clears the fall-back note when the next choice is made', async () => {
    answer = async (params) => {
      if (params['city'] === 'gone') throw unknownCity();
      return { garagesWaiting: 5 };
    };
    const overview = setUp();
    await wait(0);
    overview.choose('gone', 'default');
    await wait(20);
    overview.choose('all', 'today');
    await wait(20);

    expect(overview.fellBack()).toBe(false);
  });

  it('fails instead of falling back when a 400 names another field', async () => {
    answer = async (params) => {
      if (params['city'])
        throw new HttpErrorResponse({
          error: { errors: [{ code: 'x', field: 'period' }] },
          status: 400,
        });
      return { garagesWaiting: 5 };
    };
    const overview = setUp();
    await wait(0);
    overview.choose('cluj-napoca', 'default');
    await wait(20);

    expect(overview.failed()).toBe(true);
    expect(overview.fellBack()).toBe(false);
  });

  it('fails instead of falling back when the 400 body has no errors list', async () => {
    answer = async (params) => {
      if (params['city'])
        throw new HttpErrorResponse({ error: null, status: 400 });
      return { garagesWaiting: 5 };
    };
    const overview = setUp();
    await wait(0);
    overview.choose('cluj-napoca', 'default');
    await wait(20);

    expect(overview.failed()).toBe(true);
  });

  it('does not loop when the whole country itself is refused as an unknown city', async () => {
    let n = 0;
    answer = async () => {
      n++;
      throw unknownCity();
    };
    const overview = setUp();
    await wait(20);

    expect(overview.failed()).toBe(true);
    expect(n).toBe(1);
  });

  it('keeps the menu counter at the platform total while the header counts the city', async () => {
    answer = async (params) =>
      params['city']
        ? { cityGaragesWaiting: 1, garagesListed: 1, garagesWaiting: 7 }
        : { garagesWaiting: 7 };
    const overview = setUp();
    await wait(0);
    overview.choose('cluj-napoca', 'default');
    await wait(20);

    expect(overview.waiting()).toBe(7);
    expect(overview.headerWaiting()).toBe(1);
  });

  it('gives a city header count of 0, not nothing, when the city has none waiting', async () => {
    answer = async (params) =>
      params['city']
        ? { cityGaragesWaiting: 0, garagesWaiting: 7 }
        : { garagesWaiting: 7 };
    const overview = setUp();
    await wait(0);
    overview.choose('cluj-napoca', 'default');
    await wait(20);

    expect(overview.headerWaiting()).toBe(0);
  });

  it('shows no figures after a failed read of the new choice', async () => {
    answer = async (params) => {
      if (params['period']) throw new HttpErrorResponse({ status: 500 });
      return { garagesListed: 3, garagesWaiting: 1 };
    };
    const overview = setUp();
    await wait(0);
    overview.choose('all', '12m');
    await wait(20);

    expect(overview.failed()).toBe(true);
    expect(overview.figures()).toBeUndefined();
    expect(overview.headerWaiting()).toBeUndefined();
  });

  it('carries the chosen period into the live re-read after an event', async () => {
    answer = async () => ({ garagesWaiting: 1 });
    const overview = setUp();
    await wait(0);
    overview.choose('cluj-napoca', '7d');
    await wait(20);
    events.next({
      at: '2026-10-07T09:00:00.000Z',
      id: 'f',
      kind: 'verification.submitted',
    });
    await wait(450);

    expect(calls.at(-1)).toEqual({ city: 'cluj-napoca', period: '7d' });
  });

  it('lists no cities when the answer carries none', async () => {
    answer = async () => ({ garagesWaiting: 1 });
    const overview = setUp();
    await wait(0);

    expect(overview.cities()).toEqual([]);
  });
});
