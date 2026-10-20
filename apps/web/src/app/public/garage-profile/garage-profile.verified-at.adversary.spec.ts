import { HttpErrorResponse } from '@angular/common/http';
import { PLATFORM_ID, RESPONSE_INIT } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { EventKind, LiveMessage } from '@motor-fix/contracts';
import { GaragesService, type PublicGarageDto } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { filter, Subject } from 'rxjs';

import { GarageProfile } from './garage-profile';
import { PublicLive } from '../live';

const FIXED: PublicGarageDto = {
  address: 'Bulevardul Iuliu Maniu 100, București',
  brandNote: null,
  doesNotTake: [],
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

type Read = {
  query: { slug: string; brand?: string };
  answer: (garage: PublicGarageDto) => Promise<void>;
  fail: (status: number) => Promise<void>;
};
let reads: Read[];
const api = {
  profileViewsControllerRecord: jest.fn(
    (_: { id: string; body: { source?: string } }) => Promise.resolve(),
  ),
  publicGaragesControllerBySlug: jest.fn(
    (query: { slug: string; brand?: string }) =>
      new Promise<PublicGarageDto>((resolve, reject) => {
        reads.push({
          answer: async (garage) => {
            resolve(garage);
            await settle();
          },
          fail: async (status) => {
            reject(new HttpErrorResponse({ status }));
            await settle();
          },
          query,
        });
      }),
  ),
};

const messages = new Subject<LiveMessage>();
const resync = new Subject<void>();
const leave = jest.fn();
const live = {
  on: (kinds: readonly EventKind[]) =>
    messages.pipe(filter((m) => kinds.includes(m.kind as EventKind))),
  register: jest.fn((_view: { garage?: string; brand?: string }) => leave),
  resync,
};

let harness: RouterTestingHarness;
let response: { status?: number };

async function settle() {
  for (let i = 0; i < 5; i++) await Promise.resolve();
  harness.detectChanges();
}

const routes = () =>
  provideRouter([
    { component: GarageProfile, path: ':lang/garages/:garage' },
    { children: [], path: ':lang' },
    { children: [], path: ':lang/garages' },
  ]);

beforeEach(async () => {
  reads = [];
  response = {};
  api.publicGaragesControllerBySlug.mockClear();
  api.profileViewsControllerRecord.mockClear();
  live.register.mockClear();
  leave.mockClear();
  TestBed.configureTestingModule({
    providers: [
      routes(),
      { provide: GaragesService, useValue: api },
      { provide: PublicLive, useValue: live },
      { provide: PLATFORM_ID, useValue: 'browser' },
      { provide: RESPONSE_INIT, useValue: response },
    ],
  });
  await TestBed.inject(I18n).enter('public');
  harness = await RouterTestingHarness.create();
});

afterEach(() => jest.useRealTimers());

async function open(url: string) {
  await harness.navigateByUrl(url);
  await settle();
}

const page = () => harness.routeNativeElement as HTMLElement;
const text = () => page().textContent?.replace(/\s+/g, ' ').trim() ?? '';
const send = (kind: string) =>
  messages.next({ at: '2026-10-08T12:00:00.000Z', id: 'x', kind });

async function burst(kind = 'garage.updated') {
  send(kind);
  jest.advanceTimersByTime(300);
  await settle();
}

describe('the verification line and a recorded re-check', () => {
  // @traces 1353-FR-002
  it.each([
    ['2026-03-29T00:00:00.000Z', 'Last check: 29 Mar 2026.'],
    ['2026-10-25T00:00:00.000Z', 'Last check: 25 Oct 2026.'],
    ['2026-12-31T00:00:00.000Z', 'Last check: 31 Dec 2026.'],
    ['2027-08-01T00:00:00.000Z', 'Last check: 1 Aug 2027.'],
  ])(
    'shows the stored midnight %s as the same day in English',
    async (at, line) => {
      await TestBed.inject(I18n).use('en');
      await open('/en/garages/service-auto-militari');
      await reads[0]?.answer({ ...FIXED, verifiedAt: at });

      expect(text()).toContain(line);
    },
  );

  // @traces 1353-FR-002
  it('shows no verification line for a garage with no date', async () => {
    await open('/ro/garages/service-auto-militari');
    await reads[0]?.answer({ ...FIXED, verifiedAt: null });

    expect(text()).not.toContain('Ultima verificare');
  });

  // @traces 1353-FR-002
  it('shows an old date with no warning', async () => {
    await open('/ro/garages/service-auto-militari');
    await reads[0]?.answer({
      ...FIXED,
      verifiedAt: '2020-01-02T00:00:00.000Z',
    });

    expect(text()).toContain('Ultima verificare: 2 ian. 2020.');
    expect(text()).not.toMatch(/depășit|expirat|veche|outdated|overdue|stale/i);
  });

  // @traces 1353-FR-003
  it('reads again once when a re-check is recorded and shows the new date', async () => {
    jest.useFakeTimers();
    await open('/ro/garages/service-auto-militari');
    await reads[0]?.answer({
      ...FIXED,
      verifiedAt: '2027-06-14T00:00:00.000Z',
    });

    await burst('recheck.recorded');
    await reads[1]?.answer({
      ...FIXED,
      verifiedAt: '2027-08-01T00:00:00.000Z',
    });

    expect(reads).toHaveLength(2);
    expect(reads[1]?.query).toEqual({ slug: 'service-auto-militari' });
    expect(text()).toContain('Ultima verificare: 1 aug. 2027.');
  });

  // @traces 1353-FR-003
  it('reads once for a re-check and a suspension arriving together', async () => {
    jest.useFakeTimers();
    await open('/ro/garages/service-auto-militari');
    await reads[0]?.answer(FIXED);

    send('recheck.recorded');
    send('garage.suspended');
    send('price_list.updated');
    jest.advanceTimersByTime(300);
    await settle();

    expect(reads).toHaveLength(2);
  });

  // @traces 1353-FR-003
  it('keeps the last answer when the re-read after a re-check fails with a server error', async () => {
    jest.useFakeTimers();
    await open('/ro/garages/service-auto-militari');
    await reads[0]?.answer({
      ...FIXED,
      verifiedAt: '2027-06-14T00:00:00.000Z',
    });

    await burst('recheck.recorded');
    await reads[1]?.fail(503);

    expect(text()).toContain('Ultima verificare: 14 iun. 2027.');
  });

  // @traces 1353-FR-003
  it("does not read again for kinds that are not the garage's own", async () => {
    jest.useFakeTimers();
    await open('/ro/garages/service-auto-militari');
    await reads[0]?.answer(FIXED);

    for (const kind of [
      'recheck.due',
      'recheck',
      'rechecks.recorded',
      'RECHECK.RECORDED',
      'recheck.recorded ',
      'notification.created',
    ]) {
      await burst(kind);
    }

    expect(reads).toHaveLength(1);
  });

  // @traces 1353-FR-003
  it('reads each of two re-checks a moment apart and keeps the newest date', async () => {
    jest.useFakeTimers();
    await open('/ro/garages/service-auto-militari');
    await reads[0]?.answer({
      ...FIXED,
      verifiedAt: '2027-06-14T00:00:00.000Z',
    });

    await burst('recheck.recorded');
    await reads[1]?.answer({
      ...FIXED,
      verifiedAt: '2027-07-01T00:00:00.000Z',
    });
    await burst('recheck.recorded');
    await reads[2]?.answer({
      ...FIXED,
      verifiedAt: '2027-08-01T00:00:00.000Z',
    });

    expect(text()).toContain('Ultima verificare: 1 aug. 2027.');
  });

  // @traces 1353-FR-003
  it('reads nothing after the page is left when a re-check is recorded', async () => {
    jest.useFakeTimers();
    await open('/ro/garages/service-auto-militari');
    await reads[0]?.answer(FIXED);
    await harness.navigateByUrl('/ro');

    await burst('recheck.recorded');

    expect(reads).toHaveLength(1);
  });
});
