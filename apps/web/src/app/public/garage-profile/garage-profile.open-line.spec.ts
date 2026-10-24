import { PLATFORM_ID, RESPONSE_INIT } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { EventKind, LiveMessage } from '@motor-fix/contracts';
import { GaragesService, type PublicGarageDto } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { filter, Subject } from 'rxjs';

import { GarageProfile } from './garage-profile';
import { Consent } from '../../consent/consent';
import { PublicLive } from '../live';
import { ProfilePrefetch } from '../profile-prefetch/profile-prefetch';

const DAY: [string, string][] = [['08:00', '19:00']];
const WEEKDAYS = {
  fri: DAY,
  mon: DAY,
  sat: [],
  sun: [],
  thu: DAY,
  tue: DAY,
  wed: DAY,
};

const WORKSHOP: PublicGarageDto = {
  address: 'Bulevardul Iuliu Maniu 100, București',
  brandNote: null,
  closedDays: [],
  doesNotTake: [],
  facilities: [],
  hours: WEEKDAYS,
  id: 'g-2',
  jobTypes: [],
  latitude: 44.43,
  longitude: 26.01,
  name: 'Service Auto Militari',
  paymentMethods: { card: false, cash: false, transfer: false },
  photos: [],
  prices: [],
  rating: null,
  refusalPhrase: null,
  responseRate: { state: 'new' },
  reviewCount: 0,
  slug: 'service-auto-militari',
  verifiedAt: null,
  worksOn: [],
};

const MOBILE: PublicGarageDto = {
  ...WORKSHOP,
  address: undefined,
  businessKind: 'mobile',
  id: 'g-1',
  latitude: undefined,
  longitude: undefined,
  name: 'Mecanic Mobil Ilfov',
  serviceRadiusKm: 20,
  slug: 'mecanic-mobil-ilfov',
};

// A Tuesday in Bucharest; 2026-10-28 is Wednesday.
const TUESDAY = (time: string) => new Date(`2026-10-27T${time}+02:00`);

let answers: PublicGarageDto[];
let reads: number;
const api = {
  profileViewsControllerRecord: jest.fn(() => Promise.resolve()),
  publicGaragesControllerBySlug: jest.fn(() => {
    reads++;
    const answer = answers.shift();
    return answer
      ? Promise.resolve(answer)
      : new Promise<never>(() => undefined);
  }),
};
const messages = new Subject<LiveMessage>();
const live = {
  on: (kinds: readonly EventKind[]) =>
    messages.pipe(filter((m) => kinds.includes(m.kind as EventKind))),
  register: jest.fn(() => () => undefined),
  resync: new Subject<void>(),
};

let harness: RouterTestingHarness;

async function settle() {
  for (let i = 0; i < 5; i++) await Promise.resolve();
  harness.detectChanges();
}

async function setUp(platform: 'browser' | 'server') {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        { component: GarageProfile, path: ':lang/garages/:garage' },
      ]),
      { provide: GaragesService, useValue: api },
      { provide: PublicLive, useValue: live },
      { provide: Consent, useValue: { track: jest.fn() } },
      { provide: ProfilePrefetch, useValue: { take: () => undefined } },
      { provide: PLATFORM_ID, useValue: platform },
      { provide: RESPONSE_INIT, useValue: { headers: new Headers() } },
    ],
  });
  await TestBed.inject(I18n).enter('public');
  harness = await RouterTestingHarness.create();
}

async function open(
  garage: PublicGarageDto,
  at: Date,
  platform: 'browser' | 'server' = 'browser',
) {
  jest.useFakeTimers({ now: at });
  answers = [garage];
  await setUp(platform);
  await harness.navigateByUrl(`/ro/garages/${garage.slug}`);
  await settle();
}

const page = () => harness.routeNativeElement as HTMLElement;
const said = (el: Element | null | undefined) =>
  el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
const status = () => page().querySelector('.place-row .status');
const today = '2026-10-27';

beforeEach(() => {
  reads = 0;
  live.register.mockClear();
});

afterEach(() => jest.useRealTimers());

// @traces 309-FR-009 309-FR-010 309-FR-012
describe('the opening status in the profile header', () => {
  it('shows the line in the place row of a workshop', async () => {
    await open(WORKSHOP, TUESDAY('10:15:00'));

    expect(said(status())).toBe('Deschis azi până la 19:00');
    expect(status()?.querySelector('svg')?.getAttribute('aria-hidden')).toBe(
      'true',
    );
  });

  it('shows the line after the service area of a mobile mechanic', async () => {
    await open(MOBILE, TUESDAY('19:30:00'));

    const items = [...(page().querySelector('.place-row')?.children ?? [])];
    expect(items.map(said)).toEqual([
      expect.stringContaining('20'),
      'Închis acum · deschide mâine la 08:00',
    ]);
    expect(items[1]).toBe(status());
  });

  it('leaves the line out, with no empty element, for a garage with no hours', async () => {
    await open({ ...WORKSHOP, hours: {} }, TUESDAY('10:15:00'));

    expect(status()).toBeNull();
    expect(page().querySelector('.place-row')).toBeNull();
  });

  it('does not announce the line to a screen reader', async () => {
    await open(WORKSHOP, TUESDAY('10:15:00'));

    expect(status()?.closest('[aria-live]')).toBeNull();
    expect(status()?.getAttribute('role')).toBeNull();
  });

  it('changes the line to English in place when the language changes', async () => {
    await open(WORKSHOP, TUESDAY('10:15:00'));
    const line = status();

    await TestBed.inject(I18n).use('en');
    await settle();

    expect(status()).toBe(line);
    expect(said(status())).toBe('Open today until 19:00');
    expect(reads).toBe(1);
  });
});

// @traces 309-FR-003 309-FR-009
describe('the opening status on a closed day', () => {
  it('says a legal holiday shuts the garage today', async () => {
    await open(
      { ...WORKSHOP, closedDays: [{ day: today, reason: 'holiday' }] },
      TUESDAY('10:15:00'),
    );

    expect(said(status())).toBe(
      'Închis azi · sărbătoare legală · deschide mâine la 08:00',
    );
  });

  it("says the garage's own closed day shuts it today", async () => {
    await open(
      { ...WORKSHOP, closedDays: [{ day: today, reason: 'closed' }] },
      TUESDAY('10:15:00'),
    );

    expect(said(status())).toBe('Închis azi · deschide mâine la 08:00');
  });

  it('moves the next opening past two closed days in a row', async () => {
    await open(
      {
        ...WORKSHOP,
        closedDays: [
          { day: today, reason: 'closed' },
          { day: '2026-10-28', reason: 'closed' },
        ],
      },
      TUESDAY('10:15:00'),
    );

    expect(said(status())).toBe('Închis azi · deschide joi la 08:00');
  });
});

// @traces 309-FR-010 309-FR-011
describe('the opening status while the page stays open', () => {
  it('turns to closed when the clock passes closing time, with no read', async () => {
    await open(WORKSHOP, TUESDAY('18:59:30'));
    expect(said(status())).toBe('Deschis azi până la 19:00');

    jest.advanceTimersByTime(60_000);
    await settle();

    expect(said(status())).toBe('Închis acum · deschide mâine la 08:00');
    expect(reads).toBe(1);
  });

  it('keeps the line of its own instant on the server render', async () => {
    await open(WORKSHOP, TUESDAY('18:59:30'), 'server');

    jest.advanceTimersByTime(60_000);
    await settle();

    expect(said(status())).toBe('Deschis azi până la 19:00');
  });

  it('stops the minute timer when the page goes away', async () => {
    await open(WORKSHOP, TUESDAY('10:15:00'));
    const running = jest.getTimerCount();

    harness.fixture.destroy();

    expect(jest.getTimerCount()).toBe(running - 1);
  });

  it('changes the line in place when a live re-read brings new hours', async () => {
    await open(WORKSHOP, TUESDAY('15:00:00'));
    expect(said(status())).toBe('Deschis azi până la 19:00');
    answers = [
      { ...WORKSHOP, hours: { ...WEEKDAYS, tue: [['08:00', '14:00']] } },
    ];

    messages.next({
      at: '2026-10-27T13:00:00.000Z',
      id: 'x',
      kind: 'garage.updated',
    });
    jest.advanceTimersByTime(300);
    await settle();
    await settle();

    expect(reads).toBe(2);
    expect(said(status())).toBe('Închis acum · deschide mâine la 08:00');
  });
});
