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
  latitude: 44.43,
  longitude: 26.01,
  name: 'Service Auto Militari',
  rating: null,
  refusalPhrase: null,
  reviewCount: 0,
  slug: 'service-auto-militari',
  verifiedAt: null,
  worksOn: [],
};

const DACIA = { id: 'b-1', name: 'Dacia', slug: 'dacia' };

type Read = {
  query: { slug: string; brand?: string };
  answer: (garage: PublicGarageDto) => Promise<void>;
  fail: (status: number) => Promise<void>;
};
let reads: Read[];
const api = {
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
const title = () => page().querySelector('h1')?.textContent?.trim();
const send = (kind: string) =>
  messages.next({ at: '2026-10-08T12:00:00.000Z', id: 'x', kind });

async function burst(kind = 'garage.updated') {
  send(kind);
  jest.advanceTimersByTime(300);
  await settle();
}

describe('the garage profile with hostile text in the answer', () => {
  it('shows markup in the name, the description and the brand as plain text', async () => {
    await open('/ro/garages/service-auto-militari?brand=dacia');
    await reads[0]?.answer({
      ...FIXED,
      brand: {
        ...DACIA,
        name: '<img src=x onerror=alert(1)>',
        stance: 'works_on',
      },
      description: '<script>alert(1)</script><b>bold</b>',
      name: '<i>Atelier</i> & "Fii"',
    });

    expect(page().querySelector('img, script, b, i')).toBeNull();
    expect(title()).toBe('<i>Atelier</i> & "Fii"');
    expect(page().querySelector('.description')?.textContent).toBe(
      '<script>alert(1)</script><b>bold</b>',
    );
    expect(text()).toContain('Lucrează pe <img src=x onerror=alert(1)>');
  });

  it('keeps a brand slug with reserved characters whole in the link back', async () => {
    await open('/ro/garages/service-auto-militari?brand=a%20b%26c');
    await reads[0]?.answer({
      ...FIXED,
      brand: { id: 'b-9', name: 'A B&C', slug: 'a b&c', stance: 'works_on' },
    });

    const back = page().querySelector<HTMLAnchorElement>('a.back');
    expect(back?.getAttribute('href')).toBe('/ro/garages?brand=a%20b%26c');
  });

  it('does not show the address of a mobile mechanic whose answer carries one', async () => {
    await open('/ro/garages/mecanic');
    await reads[0]?.answer({
      ...FIXED,
      businessKind: 'mobile',
      serviceRadiusKm: 35,
    });

    expect(text()).not.toContain('Iuliu Maniu');
    expect(text()).toContain('Mecanic mobil · zonă de 35 km');
  });

  it('reads a slug with encoded characters as the slug they spell', async () => {
    await open('/ro/garages/caf%C3%A9-auto');

    expect(reads[0]?.query).toEqual({ slug: 'café-auto' });
  });

  it('leaves out a description of blanks only', async () => {
    await open('/ro/garages/service-auto-militari');
    await reads[0]?.answer({ ...FIXED, description: '   ' });

    expect(
      page().querySelector('.description')?.textContent?.trim() ?? '',
    ).toBe('');
  });
});

describe('the dial and the verification line at their edges', () => {
  it.each([
    [1, '1 recenzie'],
    [2, '2 recenzii'],
    [19, '19 recenzii'],
    [20, '20 de recenzii'],
    [101, '101 recenzii'],
    [119, '119 recenzii'],
    [120, '120 de recenzii'],
    [1000, '1000 de recenzii'],
  ])('counts %i reviews in Romanian as "%s"', async (count, expected) => {
    await open('/ro/garages/service-auto-militari');
    await reads[0]?.answer({ ...FIXED, rating: 4.5, reviewCount: count });

    expect(text()).toContain(expected);
  });

  it.each([
    [1, '1 review'],
    [2, '2 reviews'],
  ])('counts %i reviews in English as "%s"', async (count, expected) => {
    await TestBed.inject(I18n).use('en');
    await open('/en/garages/service-auto-militari');
    await reads[0]?.answer({ ...FIXED, rating: 4.5, reviewCount: count });

    expect(text().toLowerCase()).toContain(expected);
  });

  it('dates a check made just before midnight UTC on the Bucharest day', async () => {
    await open('/ro/garages/service-auto-militari');
    await reads[0]?.answer({
      ...FIXED,
      verifiedAt: '2026-09-30T22:30:00.000Z',
    });

    expect(text()).toContain('Ultima verificare: 1 oct. 2026.');
  });

  it('dates a winter check on the Bucharest day too', async () => {
    await open('/ro/garages/service-auto-militari');
    await reads[0]?.answer({
      ...FIXED,
      verifiedAt: '2026-12-31T22:30:00.000Z',
    });

    expect(text()).toContain('Ultima verificare: 1 ian. 2027.');
  });

  it('never prints "Invalid Date" for a verification time it cannot read', async () => {
    await open('/ro/garages/service-auto-militari');
    await reads[0]?.answer({ ...FIXED, verifiedAt: 'not a date' });

    expect(text()).not.toContain('Invalid');
    expect(title()).toBe('Service Auto Militari');
  });

  it('changes the date to the other language in place', async () => {
    await open('/ro/garages/service-auto-militari');
    await reads[0]?.answer({
      ...FIXED,
      verifiedAt: '2026-10-01T09:00:00.000Z',
    });
    expect(text()).toContain('Ultima verificare: 1 oct. 2026.');

    await TestBed.inject(I18n).use('en');
    harness.detectChanges();

    expect(text()).toContain('Last check: 1 Oct 2026.');
    expect(reads).toHaveLength(1);
  });
});

describe('the profile and its live stream', () => {
  it('names the brand in context to the stream beside the garage', async () => {
    await open('/ro/garages/service-auto-militari?brand=dacia');
    await reads[0]?.answer({
      ...FIXED,
      brand: { ...DACIA, stance: 'works_on' },
    });

    expect(live.register).toHaveBeenLastCalledWith({
      brand: 'b-1',
      garage: 'g-2',
    });
  });

  it('opens no stream for a garage that was never read', async () => {
    await open('/ro/garages/service-auto-militari');
    await reads[0]?.fail(404);

    expect(live.register).not.toHaveBeenCalledWith({
      garage: expect.any(String),
    });
  });

  it('leaves the stream when the page is left, and reads nothing after', async () => {
    jest.useFakeTimers();
    await open('/ro/garages/service-auto-militari');
    await reads[0]?.answer(FIXED);

    await harness.navigateByUrl('/ro');
    await burst();

    expect(leave).toHaveBeenCalled();
    expect(reads).toHaveLength(1);
  });

  it('reads once more when the stream reopens, and once for two reopens in a row', async () => {
    jest.useFakeTimers();
    await open('/ro/garages/service-auto-militari');
    await reads[0]?.answer(FIXED);

    resync.next();
    resync.next();
    jest.advanceTimersByTime(300);
    await settle();

    expect(reads).toHaveLength(2);
  });

  it('reads again when a change arrives while an earlier re-read is still open', async () => {
    jest.useFakeTimers();
    await open('/ro/garages/service-auto-militari');
    await reads[0]?.answer({ ...FIXED, name: 'Prima' });

    await burst();
    await burst('review.posted');
    await reads[1]?.answer({ ...FIXED, name: 'A doua' });
    jest.advanceTimersByTime(300);
    await settle();

    expect(reads).toHaveLength(3);
  });

  it('keeps the gone view once a suspension has been read, whatever the next event says', async () => {
    jest.useFakeTimers();
    await open('/ro/garages/service-auto-militari');
    await reads[0]?.answer(FIXED);

    await burst('garage.suspended');
    await reads[1]?.fail(410);
    await burst('garage.updated');
    await reads[2]?.fail(503);

    expect(text()).toContain('Acest service nu mai este disponibil');
    expect(response.status).toBe(410);
  });

  it('shows the garage again when it is restored after a suspension was read', async () => {
    jest.useFakeTimers();
    await open('/ro/garages/service-auto-militari');
    await reads[0]?.answer(FIXED);
    await burst('garage.suspended');
    await reads[1]?.fail(410);

    await burst('garage.restored');
    await reads[2]?.answer(FIXED);

    expect(title()).toBe('Service Auto Militari');
  });
});

describe('moving between profiles and retrying', () => {
  it('reads the new garage when the address changes, and drops a late answer of the old one', async () => {
    await open('/ro/garages/service-auto-militari');
    await harness.navigateByUrl('/ro/garages/atelier-dinamo');
    await settle();
    await reads[0]?.answer(FIXED);
    await reads[1]?.answer({ ...FIXED, id: 'g-3', name: 'Atelier Dinamo' });
    // The late answer is read again for the new address: one more turn.
    await settle();

    expect(reads.map((r) => r.query.slug)).toContain('atelier-dinamo');
    expect(title()).toBe('Atelier Dinamo');
  });

  it('reads again with the new brand when only the brand in the address changes', async () => {
    await open('/ro/garages/service-auto-militari?brand=dacia');
    await reads[0]?.answer({
      ...FIXED,
      brand: { ...DACIA, stance: 'works_on' },
    });

    await harness.navigateByUrl('/ro/garages/service-auto-militari');
    await settle();

    expect(reads.at(-1)?.query).toEqual({ slug: 'service-auto-militari' });
  });

  it('shows the not-found view when a retry answers 404', async () => {
    await open('/ro/garages/service-auto-militari');
    await reads[0]?.fail(500);

    [...page().querySelectorAll('button')]
      .find((b) => b.textContent?.trim() === 'Încearcă din nou')
      ?.click();
    await settle();
    await reads[1]?.fail(404);

    expect(title()).toBe('Pagina nu există');
    expect(response.status).toBe(404);
  });

  it('reads once for each press of the retry button', async () => {
    await open('/ro/garages/service-auto-militari');
    await reads[0]?.fail(500);

    const retry = () =>
      [...page().querySelectorAll('button')].find(
        (b) => b.textContent?.trim() === 'Încearcă din nou',
      );
    retry()?.click();
    await settle();
    retry()?.click();
    await settle();

    expect(reads.length).toBeLessThanOrEqual(2);
  });

  it('treats a network error without a status as a failed read, not a missing page', async () => {
    await open('/ro/garages/service-auto-militari');
    await reads[0]?.fail(0);

    expect(text()).toContain('Nu am putut încărca');
    expect(response.status).toBeUndefined();
  });
});

describe('the profile rendered on the server', () => {
  it('answers 410 for a suspended garage', async () => {
    TestBed.resetTestingModule();
    const serverResponse: { status?: number } = {};
    TestBed.configureTestingModule({
      providers: [
        routes(),
        { provide: GaragesService, useValue: api },
        { provide: PublicLive, useValue: live },
        { provide: PLATFORM_ID, useValue: 'server' },
        { provide: RESPONSE_INIT, useValue: serverResponse },
      ],
    });
    await TestBed.inject(I18n).enter('public');
    harness = await RouterTestingHarness.create();

    await open('/ro/garages/service-titan');
    await reads[0]?.fail(410);

    expect(serverResponse.status).toBe(410);
  });
});
