import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { LiveAnnouncer } from '@angular/cdk/a11y';
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

const MOBILE: PublicGarageDto = {
  brandNote: null,
  businessKind: 'mobile',
  description: 'Diagnoză și reparații la domiciliu',
  doesNotTake: [],
  id: 'g-1',
  jobTypes: [],
  name: 'Mecanic Mobil Ilfov',
  paymentMethods: { card: false, cash: false, transfer: false },
  rating: null,
  refusalPhrase: null,
  reviewCount: 0,
  serviceRadiusKm: 20,
  slug: 'mecanic-mobil-ilfov',
  verifiedAt: '2026-01-15T09:30:00.000Z',
  worksOn: [],
};

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
const live = {
  on: (kinds: readonly EventKind[]) =>
    messages.pipe(filter((m) => kinds.includes(m.kind as EventKind))),
  register: jest.fn(() => () => undefined),
  resync,
};

let harness: RouterTestingHarness;
let response: { status?: number };

async function settle() {
  for (let i = 0; i < 5; i++) await Promise.resolve();
  harness.detectChanges();
}

beforeEach(async () => {
  reads = [];
  response = {};
  api.publicGaragesControllerBySlug.mockClear();
  live.register.mockClear();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        { component: GarageProfile, path: ':lang/garages/:garage' },
        { children: [], path: ':lang' },
        { children: [], path: ':lang/garages' },
      ]),
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
const link = (name: RegExp) =>
  [...page().querySelectorAll<HTMLAnchorElement>('a')].find((a) =>
    name.test(a.textContent ?? ''),
  );
const css = (path: string) => readFileSync(join(__dirname, path), 'utf8');
const lamp = () => page().querySelector<HTMLElement>('mf-lamp');

// @traces 307-FR-008 307-FR-010 307-FR-013 307-FR-014 307-FR-015
describe('the garage profile', () => {
  it('reads the garage named in the address, with the brand in context', async () => {
    await open('/ro/garages/service-auto-militari?brand=dacia');

    expect(reads.map((r) => r.query)).toEqual([
      { brand: 'dacia', slug: 'service-auto-militari' },
    ]);
  });

  it('shows skeletons while the first read is open', async () => {
    await open('/ro/garages/mecanic-mobil-ilfov');

    expect(page().querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(page().querySelector('h1')).toBeNull();
  });

  it('announces the skeletons as a status a screen reader names', async () => {
    await open('/ro/garages/mecanic-mobil-ilfov');

    const loading = page().querySelector('[aria-busy="true"]');
    expect(loading?.getAttribute('role')).toBe('status');
    expect(loading?.getAttribute('aria-label')).toBeTruthy();
  });

  it('leads the verification line with a shield-check icon kept from screen readers', async () => {
    await open('/ro/garages/mecanic-mobil-ilfov');
    await reads[0]?.answer(MOBILE);

    const icon = page().querySelector('.verified svg.shield');
    expect(icon?.getAttribute('aria-hidden')).toBe('true');
    expect(css('garage-profile.css')).toMatch(
      /\.shield \{[^}]*color: var\(--mf-green\)/,
    );
  });

  it('shows the header of a mobile mechanic in order, with its area and no address', async () => {
    await open('/ro/garages/mecanic-mobil-ilfov');
    await reads[0]?.answer(MOBILE);

    const header = text();
    const order = [
      'Verificat · autorizație RAR',
      'Mecanic Mobil Ilfov',
      'Mecanic mobil · zonă de 20 km',
      'Diagnoză și reparații la domiciliu',
      'Ultima verificare: 15 ian. 2026.',
    ].map((part) => header.indexOf(part));
    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(page().querySelector('h1')?.textContent?.trim()).toBe(
      'Mecanic Mobil Ilfov',
    );
    expect(header).toContain('Nicio recenzie încă');
  });

  it('shows the same header in English', async () => {
    await TestBed.inject(I18n).use('en');
    await open('/en/garages/mecanic-mobil-ilfov');
    await reads[0]?.answer(MOBILE);

    expect(text()).toContain('Verified · RAR authorisation');
    expect(text()).toContain('Mobile mechanic · 20 km area');
    expect(text()).toContain('Last check: 15 Jan 2026.');
  });

  it('leaves out the description, the place and the verification line it has no data for', async () => {
    await open('/ro/garages/service-auto-militari');
    await reads[0]?.answer(FIXED);

    expect(text()).toContain('Service Auto Militari');
    expect(text()).not.toContain('Bulevardul Iuliu Maniu');
    expect(text()).not.toContain('Ultima verificare');
    expect(page().querySelector('.description')).toBeNull();
    expect(page().querySelector('.place')).toBeNull();
  });

  it('shows the review count under the dial once the garage has reviews', async () => {
    await open('/ro/garages/service-auto-militari');
    await reads[0]?.answer({ ...FIXED, rating: 4.9, reviewCount: 212 });

    expect(text()).toContain('212 recenzii');
    expect(text()).not.toContain('Nicio recenzie încă');
  });

  it('says "de" before a review count of twenty and up past the teens', async () => {
    await open('/ro/garages/service-auto-militari');
    await reads[0]?.answer({ ...FIXED, rating: 4.9, reviewCount: 220 });

    expect(text()).toContain('220 de recenzii');
  });

  it('renders the slots of the other sections empty', async () => {
    await open('/ro/garages/service-auto-militari');
    await reads[0]?.answer(FIXED);

    const slots = [...page().querySelectorAll<HTMLElement>('[data-slot]')];
    expect(slots.length).toBeGreaterThan(0);
    for (const slot of slots) expect(slot.textContent?.trim()).toBe('');
  });

  it('shows an error block whose button reads again', async () => {
    await open('/ro/garages/service-auto-militari');
    await reads[0]?.fail(500);

    expect(text()).toContain('Nu am putut încărca service‑ul');
    const retry = [...page().querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === 'Încearcă din nou',
    );
    retry?.click();
    await settle();

    expect(reads).toHaveLength(2);
    await reads[1]?.answer(FIXED);
    expect(page().querySelector('h1')?.textContent?.trim()).toBe(
      'Service Auto Militari',
    );
  });

  it('words the error block in English as the spec does', async () => {
    await TestBed.inject(I18n).use('en');
    await open('/en/garages/service-auto-militari');
    await reads[0]?.fail(500);

    expect(text()).toContain('We could not load the garage');
    expect(
      [...page().querySelectorAll('button')].some(
        (b) => b.textContent?.trim() === 'Try again',
      ),
    ).toBe(true);
  });

  it('shows the not-found page and status for a garage nobody can see', async () => {
    await open('/ro/garages/atelier-dinamo');
    await reads[0]?.fail(404);

    expect(page().querySelector('h1')?.textContent?.trim()).toBe(
      'Pagina nu există',
    );
    expect(page().querySelector('main')).toBeNull();
    expect(response.status).toBe(404);
  });

  it('shows the no-longer-available view and status for a suspended garage', async () => {
    await open('/ro/garages/service-titan');
    await reads[0]?.fail(410);

    expect(text()).toContain('Acest service nu mai este disponibil');
    expect(page().querySelector('h1')?.textContent).not.toContain('Titan');
    expect(response.status).toBe(410);
  });
});

// @traces 307-FR-011 307-FR-012
describe('the garage profile with a brand in context', () => {
  it('lights a green lamp for a brand the garage works on', async () => {
    await open('/ro/garages/service-auto-militari?brand=dacia');
    await reads[0]?.answer({
      ...FIXED,
      brand: { ...DACIA, stance: 'works_on' },
    });

    expect(lamp()?.getAttribute('data-state')).toBe('green');
    expect(lamp()?.textContent?.trim()).toBe('Lucrează pe Dacia');
  });

  it('lights a red lamp for a brand the garage does not take', async () => {
    await TestBed.inject(I18n).use('en');
    await open('/en/garages/service-colentina?brand=dacia');
    await reads[0]?.answer({
      ...FIXED,
      brand: { ...DACIA, stance: 'does_not_take' },
    });

    expect(lamp()?.getAttribute('data-state')).toBe('red');
    expect(lamp()?.textContent?.trim()).toBe('Does not work on Dacia');
  });

  it('shows no lamp when the answer carries no brand', async () => {
    await open('/ro/garages/service-auto-militari?brand=nimic');
    await reads[0]?.answer(FIXED);

    expect(lamp()).toBeNull();
  });

  it('leads back to the results for the brand', async () => {
    await open('/ro/garages/service-auto-militari?brand=dacia');
    await reads[0]?.answer({
      ...FIXED,
      brand: { ...DACIA, stance: 'works_on' },
    });

    expect(link(/Service‑uri pentru Dacia/)?.getAttribute('href')).toBe(
      '/ro/garages?brand=dacia',
    );
  });

  it('leads back home without a brand', async () => {
    await open('/ro/garages/service-auto-militari?brand=nimic');
    await reads[0]?.answer(FIXED);

    expect(link(/Acasă/)?.getAttribute('href')).toBe('/ro');
  });
});

// @traces 307-FR-016 307-FR-017 307-FR-018
describe('the garage profile kept live', () => {
  const send = (kind: string) =>
    messages.next({ at: '2026-10-08T12:00:00.000Z', id: 'x', kind });

  it('names the garage it shows to the stream', async () => {
    await open('/ro/garages/service-auto-militari');
    await reads[0]?.answer(FIXED);

    expect(live.register).toHaveBeenLastCalledWith({
      brand: undefined,
      garage: 'g-2',
    });
  });

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

  it('announces a lamp that changes in place, politely and without moving focus', async () => {
    jest.useFakeTimers();
    const announce = jest
      .spyOn(TestBed.inject(LiveAnnouncer), 'announce')
      .mockResolvedValue();
    await open('/ro/garages/service-auto-militari?brand=dacia');
    await reads[0]?.answer({
      ...FIXED,
      brand: { ...DACIA, stance: 'works_on' },
    });
    expect(announce).not.toHaveBeenCalled();
    const focused = document.activeElement;

    send('garage.updated');
    jest.advanceTimersByTime(300);
    await settle();
    await reads[1]?.answer({
      ...FIXED,
      brand: { ...DACIA, stance: 'does_not_take' },
    });

    expect(announce).toHaveBeenCalledWith('Nu lucrează pe Dacia', 'polite');
    expect(document.activeElement).toBe(focused);
  });

  it('announces a dial that changes in place', async () => {
    jest.useFakeTimers();
    const announce = jest
      .spyOn(TestBed.inject(LiveAnnouncer), 'announce')
      .mockResolvedValue();
    await open('/ro/garages/service-auto-militari');
    await reads[0]?.answer({ ...FIXED, rating: 4.5, reviewCount: 3 });

    send('review.posted');
    jest.advanceTimersByTime(300);
    await settle();
    await reads[1]?.answer({ ...FIXED, rating: 4.7, reviewCount: 4 });

    expect(announce).toHaveBeenCalledWith('Rating 4,7 din 5', 'polite');
  });

  it('keeps the no-longer-available view when a later re-read fails otherwise', async () => {
    jest.useFakeTimers();
    await open('/ro/garages/service-auto-militari');
    await reads[0]?.answer(FIXED);
    send('garage.suspended');
    jest.advanceTimersByTime(300);
    await settle();
    await reads[1]?.fail(410);

    send('garage.updated');
    jest.advanceTimersByTime(300);
    await settle();
    await reads[2]?.fail(503);

    expect(text()).toContain('Acest service nu mai este disponibil');
    expect(response.status).toBe(410);
  });

  it('reads again once, with the same brand, for a burst of changes', async () => {
    jest.useFakeTimers();
    await open('/ro/garages/service-auto-militari?brand=dacia');
    await reads[0]?.answer(FIXED);

    send('garage.updated');
    send('review.posted');
    send('verification.decided');
    jest.advanceTimersByTime(300);
    await settle();

    expect(reads.map((r) => r.query)).toEqual([
      { brand: 'dacia', slug: 'service-auto-militari' },
      { brand: 'dacia', slug: 'service-auto-militari' },
    ]);
  });

  it('ignores the kinds that do not change the profile', async () => {
    jest.useFakeTimers();
    await open('/ro/garages/service-auto-militari');
    await reads[0]?.answer(FIXED);

    send('booking.created');
    jest.advanceTimersByTime(300);
    await settle();

    expect(reads).toHaveLength(1);
  });

  it('switches to the no-longer-available view when a re-read answers 410', async () => {
    jest.useFakeTimers();
    await open('/ro/garages/service-auto-militari');
    await reads[0]?.answer(FIXED);

    send('garage.suspended');
    jest.advanceTimersByTime(300);
    await settle();
    await reads[1]?.fail(410);

    expect(text()).toContain('Acest service nu mai este disponibil');
    expect(text()).not.toContain('Service Auto Militari');
  });

  it('switches to the not-found view when a re-read answers 404', async () => {
    jest.useFakeTimers();
    await open('/ro/garages/service-auto-militari');
    await reads[0]?.answer(FIXED);

    send('garage.updated');
    jest.advanceTimersByTime(300);
    await settle();
    await reads[1]?.fail(404);

    expect(page().querySelector('h1')?.textContent?.trim()).toBe(
      'Pagina nu există',
    );
  });

  it('keeps the last answer while a re-read fails', async () => {
    jest.useFakeTimers();
    await open('/ro/garages/service-auto-militari');
    await reads[0]?.answer(FIXED);

    send('garage.updated');
    jest.advanceTimersByTime(300);
    await settle();
    await reads[1]?.fail(503);

    expect(page().querySelector('h1')?.textContent?.trim()).toBe(
      'Service Auto Militari',
    );
  });
});

// @traces 307-FR-008
describe('moving between profiles', () => {
  it('drops a late answer for the garage the address moved away from', async () => {
    await open('/ro/garages/service-auto-militari');
    await harness.navigateByUrl('/ro/garages/atelier-dinamo');
    await settle();

    await reads[0]?.answer(FIXED);

    expect(page().querySelector('h1')).toBeNull();
    expect(reads.map((r) => r.query.slug)).toEqual([
      'service-auto-militari',
      'atelier-dinamo',
    ]);
    await reads[1]?.answer({ ...FIXED, id: 'g-3', name: 'Atelier Dinamo' });
    await settle();
    expect(page().querySelector('h1')?.textContent?.trim()).toBe(
      'Atelier Dinamo',
    );
  });
});

describe('the profile on the Cockpit type scale', () => {
  const sizes = (source: string) =>
    [...source.matchAll(/font-size:\s*([^;]+);/g)].map((m) => m[1]?.trim());

  it.each(['garage-profile.css', 'gone/gone.css', '../frame/frame.css'])(
    'sizes every text in %s with a --mf-size-* token',
    (path) => {
      for (const size of sizes(css(path))) {
        expect(size).toMatch(/^var\(--mf-size-[a-z]+\)$/);
      }
    },
  );

  it('keeps the site bar wordmark, a link, at body size on a phone', () => {
    expect(css('../frame/frame.css')).toMatch(
      /\.logo \{[^}]*font-size: var\(--mf-size-body\);/,
    );
  });

  it('holds the review count, a label, outside running text', () => {
    expect(css('garage-profile.html')).not.toMatch(/<p class="reviews">/);
  });

  it('gives the verified line body size, not a 13 px caption', () => {
    expect(css('garage-profile.css')).not.toMatch(
      /\.verified \{[^}]*--mf-size-small/,
    );
  });
});
