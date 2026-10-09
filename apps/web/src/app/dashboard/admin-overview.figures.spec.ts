import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import type { EventKind, LiveMessage } from '@motor-fix/contracts';
import { AdminService } from '@motor-fix/data-access';
import { filter, Subject } from 'rxjs';

import { AdminOverview } from './admin-overview';
import { Live } from './live';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Params = { city?: string; period?: string } | undefined;
type Answer = Record<string, unknown>;

let events: Subject<LiveMessage>;
let asked: Params[];
let answer: (params: Params) => Promise<Answer>;

const CITIES = [
  { garages: 214, key: 'all', name: 'România' },
  { garages: 120, key: 'bucuresti', name: 'București' },
  { garages: 31, key: 'cluj-napoca', name: 'Cluj-Napoca' },
];
const base = (params: Params): Answer => ({
  activeDrivers: params?.city ? 0 : 12480,
  cities: CITIES,
  garagesApprovedThisMonth: params?.city ? 2 : 9,
  garagesListed: params?.city ? 31 : 214,
  garagesWaiting: 5,
  ...(params?.city && { cityGaragesWaiting: 1 }),
  ...(params?.period && { garagesApprovedInPeriod: 3 }),
});

function setUp() {
  events = new Subject();
  asked = [];
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
          adminOverviewControllerOverview: (params: Params) => {
            asked.push(params);
            return answer(params);
          },
        },
      },
    ],
  });
  return TestBed.inject(AdminOverview);
}

afterEach(() => TestBed.resetTestingModule());

// @traces 163-FR-007 163-FR-009 163-FR-010
describe('AdminOverview, the city and the period', () => {
  beforeEach(() => {
    answer = async (params) => base(params);
  });

  it('opens on the whole country and the default period, asking with no parameter', async () => {
    const overview = setUp();
    await wait(0);

    expect([overview.city(), overview.period()]).toEqual(['all', 'default']);
    expect(asked).toEqual([{}]);
    expect(overview.cities()).toEqual(CITIES);
  });

  it('reads again with the choice, and gives its figures', async () => {
    const overview = setUp();
    await wait(0);

    overview.choose('cluj-napoca', '7d');
    await wait(0);

    expect(asked.at(-1)).toEqual({ city: 'cluj-napoca', period: '7d' });
    expect(overview.figures()).toMatchObject({
      activeDrivers: 0,
      garagesApprovedInPeriod: 3,
      garagesListed: 31,
      period: '7d',
    });
  });

  it('shows no figures while the choice is being read, and keeps the menu counter', async () => {
    let finish: (() => void) | undefined;
    const overview = setUp();
    await wait(0);
    answer = (params) =>
      new Promise((resolve) => {
        finish = () => resolve(base(params));
      });

    overview.choose('bucuresti', 'default');
    await wait(0);

    expect(overview.figures()).toBeUndefined();
    expect(overview.figuresLoading()).toBe(true);
    expect(overview.loading()).toBe(false);
    expect(overview.waiting()).toBe(5);
    finish?.();
    await wait(0);
    expect(overview.figuresLoading()).toBe(false);
    expect(overview.figures()?.garagesListed).toBe(31);
  });

  it('shows only the answer to the latest choice, dropping an older slower one', async () => {
    const finishes: (() => void)[] = [];
    const overview = setUp();
    await wait(0);
    answer = (params) =>
      new Promise((resolve) => {
        finishes.push(() =>
          resolve({
            ...base(params),
            garagesListed: params?.city === 'bucuresti' ? 120 : 31,
          }),
        );
      });

    overview.choose('bucuresti', 'default');
    await wait(0);
    overview.choose('cluj-napoca', 'default');
    finishes[0]();
    await wait(0);

    expect(overview.figures()).toBeUndefined();
    finishes[1]();
    await wait(0);
    expect(asked.at(-1)).toEqual({ city: 'cluj-napoca' });
    expect(overview.figures()?.garagesListed).toBe(31);
  });

  it("counts the header's waiting garages for the city, and the platform's for the whole country", async () => {
    const overview = setUp();
    await wait(0);
    expect(overview.headerWaiting()).toBe(5);

    overview.choose('cluj-napoca', 'default');
    await wait(0);

    expect(overview.headerWaiting()).toBe(1);
    expect(overview.waiting()).toBe(5);
  });

  it('carries the choice into the re-read an event starts', async () => {
    const overview = setUp();
    await wait(0);
    overview.choose('cluj-napoca', 'month');
    await wait(0);

    events.next({
      at: '2026-10-09T09:00:00.000Z',
      id: 'file-1',
      kind: 'verification.submitted',
    });
    await wait(400);

    expect(asked.at(-1)).toEqual({ city: 'cluj-napoca', period: 'month' });
  });

  it('falls back to the whole country when the server knows no such city, and says so once', async () => {
    answer = async (params) => {
      if (params?.city === 'timisoara')
        throw new HttpErrorResponse({
          error: {
            code: 'validation_failed',
            errors: [{ code: 'unknown', field: 'city' }],
          },
          status: 400,
        });
      return base(params);
    };
    const overview = setUp();
    await wait(0);

    overview.choose('timisoara', '30d');
    await wait(0);
    await wait(0);

    expect([overview.city(), overview.period()]).toEqual(['all', '30d']);
    expect(asked.at(-1)).toEqual({ period: '30d' });
    expect(overview.figures()).toMatchObject({
      garagesListed: 214,
      period: '30d',
    });
    expect(overview.failed()).toBe(false);
  });

  it('reads nothing again when the choice does not change', async () => {
    const overview = setUp();
    await wait(0);

    overview.choose('all', 'default');
    await wait(0);

    expect(asked).toHaveLength(1);
  });
});
