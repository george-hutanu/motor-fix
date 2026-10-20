import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { LiveAnnouncer } from '@angular/cdk/a11y';
import { type HttpContext, HttpErrorResponse } from '@angular/common/http';
import { PLATFORM_ID, RESPONSE_INIT } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { EventKind, LiveMessage } from '@motor-fix/contracts';
import { GaragesService, type PublicGarageDto } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { filter, Subject } from 'rxjs';

import { GarageProfile } from './garage-profile';
import { Consent } from '../../consent/consent';
import { PlaceStore } from '../../home/place/place-store';
import { PUBLIC_READ } from '../../public-read';
import { PublicLive } from '../live';
import { ProfilePrefetch } from '../profile-prefetch/profile-prefetch';

const MOBILE: PublicGarageDto = {
  brandNote: null,
  businessKind: 'mobile',
  description: 'Diagnoză și reparații la domiciliu',
  doesNotTake: [],
  id: 'g-1',
  jobTypes: [],
  name: 'Mecanic Mobil Ilfov',
  paymentMethods: { card: false, cash: false, transfer: false },
  photos: [],
  prices: [],
  rating: null,
  refusalPhrase: null,
  responseRate: { state: 'new' },
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

const DACIA = { id: 'b-1', name: 'Dacia', slug: 'dacia' };

type Read = {
  query: { slug: string; brand?: string; near?: string };
  answer: (garage: PublicGarageDto) => Promise<void>;
  fail: (status: number) => Promise<void>;
};
let reads: Read[];
const api = {
  profileViewsControllerRecord: jest.fn(
    (_: { id: string; body: { source?: string } }) => Promise.resolve(),
  ),
  publicGaragesControllerBySlug: jest.fn(
    (
      query: { slug: string; brand?: string; near?: string },
      _context?: HttpContext,
    ) =>
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

const prefetch = {
  take: jest.fn(
    (_slug: string, _brand: string | undefined): PublicGarageDto | undefined =>
      undefined,
  ),
};

const messages = new Subject<LiveMessage>();
const resync = new Subject<void>();
const consent = { track: jest.fn() };
const live = {
  on: (kinds: readonly EventKind[]) =>
    messages.pipe(filter((m) => kinds.includes(m.kind as EventKind))),
  register: jest.fn(() => () => undefined),
  resync,
};

let harness: RouterTestingHarness;
let response: { status?: number; headers?: HeadersInit };
// What Angular's server render hands the page: the type it already set.
const RENDERED = 'text/html;charset=UTF-8';

async function settle() {
  for (let i = 0; i < 5; i++) await Promise.resolve();
  harness.detectChanges();
}

beforeEach(async () => {
  reads = [];
  response = { headers: new Headers({ 'Content-Type': RENDERED }) };
  api.publicGaragesControllerBySlug.mockClear();
  api.profileViewsControllerRecord.mockClear();
  consent.track.mockClear();
  live.register.mockClear();
  prefetch.take.mockReset();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        { component: GarageProfile, path: ':lang/garages/:garage' },
        { children: [], path: ':lang' },
        { children: [], path: ':lang/garages' },
      ]),
      { provide: GaragesService, useValue: api },
      { provide: PublicLive, useValue: live },
      { provide: Consent, useValue: consent },
      { provide: ProfilePrefetch, useValue: prefetch },
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

// @traces 307-FR-008 307-FR-010 307-FR-013 307-FR-014 307-FR-015 310-FR-004
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

  it('writes the brand chip in the ink shades, which hold 4.5:1 on the raised panel', () => {
    const sheet = css('garage-profile.css');
    expect(sheet).toMatch(
      /mf-lamp\[data-state="green"\] \{[^}]*color: var\(--mf-green-ink\)/,
    );
    expect(sheet).toMatch(
      /mf-lamp\[data-state="red"\] \{[^}]*color: var\(--mf-red-ink\)/,
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

  // @traces 1353-FR-002
  it.each([
    [
      'ro',
      'Firmă activă și autorizație tehnică RAR, verificate de MotorFix. Ultima verificare: 1 aug. 2027.',
    ],
    [
      'en',
      'Active company and RAR technical authorisation, checked by MotorFix. Last check: 1 Aug 2027.',
    ],
  ] as const)(
    'dates the %s verification line by the stored day of last check',
    async (language, line) => {
      await TestBed.inject(I18n).use(language);
      await open(`/${language}/garages/service-auto-militari`);
      await reads[0]?.answer({
        ...FIXED,
        verifiedAt: '2027-08-01T00:00:00.000Z',
      });

      expect(page().querySelector('.verified')?.textContent?.trim()).toBe(line);
    },
  );

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

    const slots = [
      ...page().querySelectorAll<HTMLElement>(
        'section[data-slot]:not([data-slot="prices"])',
      ),
    ];
    expect(slots.length).toBeGreaterThan(0);
    for (const slot of slots) expect(slot.textContent?.trim()).toBe('');
  });

  it('fills the photos slot with a tile per photo when the garage has photos', async () => {
    await open('/ro/garages/service-auto-militari');
    await reads[0]?.answer({
      ...FIXED,
      photos: [
        {
          displayUrl: 'https://s/a.display',
          height: 900,
          id: 'p-1',
          thumbnailUrl: 'https://s/a.thumb',
          width: 1200,
        },
        {
          displayUrl: 'https://s/b.display',
          height: 900,
          id: 'p-2',
          thumbnailUrl: 'https://s/b.thumb',
          width: 1200,
        },
      ],
    });

    const slot = page().querySelector<HTMLElement>(
      'section[data-slot="photos"]',
    );
    expect(slot?.getAttribute('aria-label')).toBe('Fotografii');
    expect(slot?.querySelectorAll('button img')).toHaveLength(2);
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

// @traces 430-FR-003
describe('the garage profile purge tag', () => {
  it('tags the rendered page with the garage, so its edit purges the edge', async () => {
    await open('/ro/garages/service-auto-militari');
    await reads[0]?.answer(MOBILE);

    const headers = new Headers(response.headers);
    expect(headers.get('cdn-tag')).toBe(`garage:${MOBILE.id}`);
    expect(headers.get('content-type')).toBe(RENDERED);
  });

  it.each([404, 410])(
    'sets no garage tag on a %s, which keeps the search tag',
    async (status) => {
      await open('/ro/garages/atelier-dinamo');
      await reads[0]?.fail(status);

      const headers = new Headers(response.headers);
      expect(headers.get('cdn-tag')).toBeNull();
      expect(headers.get('content-type')).toBe(RENDERED);
    },
  );
});

// @traces 355-FR-006
// @traces 355-FR-012
// @traces 355-FR-013
describe('the price list on the profile', () => {
  const BRAKES = {
    durationMinutes: 120,
    fromBani: 89_000,
    jobTypeId: 'j-brakes',
    nameEn: 'Front brake pads and discs',
    nameRo: 'Plăcuțe și discuri de frână față',
    toBani: 140_000,
  };
  const prices = () =>
    page().querySelector<HTMLElement>('section[data-slot="prices"]');
  const send = (kind: string) =>
    messages.next({ at: '2026-10-08T12:00:00.000Z', id: 'x', kind });

  it("fills the prices slot with the answer's rows", async () => {
    await open('/ro/garages/service-auto-militari');
    await reads[0]?.answer({ ...FIXED, prices: [BRAKES] });

    expect(prices()?.getAttribute('aria-label')).toBe('Lista de prețuri');
    expect(prices()?.querySelector('h2')?.textContent?.trim()).toBe(
      'Lista de prețuri',
    );
    expect(prices()?.textContent).toContain('890–1.400 lei');
  });

  it('shows no price list while the first read is open', async () => {
    await open('/ro/garages/service-auto-militari');

    expect(page().querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(prices()).toBeNull();
  });

  it.each([404, 410])('shows no price list for a %d', async (status) => {
    await open('/ro/garages/service-auto-militari');
    await reads[0]?.fail(status);

    expect(prices()).toBeNull();
    expect(text()).not.toContain('Lista de prețuri');
  });

  it('shows the new range in place when the price list changes', async () => {
    jest.useFakeTimers();
    await open('/ro/garages/service-auto-militari?brand=dacia');
    await reads[0]?.answer({ ...FIXED, prices: [BRAKES] });

    send('price_list.updated');
    jest.advanceTimersByTime(300);
    await settle();
    await reads[1]?.answer({
      ...FIXED,
      prices: [{ ...BRAKES, fromBani: 99_000, toBani: 150_000 }],
    });

    expect(reads[1]?.query).toEqual({
      brand: 'dacia',
      slug: 'service-auto-militari',
    });
    expect(prices()?.textContent).toContain('990–1.500 lei');
    expect(prices()?.textContent).not.toContain('890–1.400 lei');
  });

  it('keeps the same section and its switch through the read that follows', async () => {
    await open('/ro/garages/service-auto-militari?brand=bmw');
    await reads[0]?.answer({ ...FIXED, prices: [BRAKES] });
    const section = prices();
    section?.querySelector<HTMLElement>('[role="switch"]')?.click();
    await settle();

    resync.next();
    await settle();
    await reads[1]?.answer({ ...FIXED, prices: [BRAKES] });

    expect(reads).toHaveLength(2);
    expect(prices()).toBe(section);
    expect(
      prices()?.querySelector('[role="switch"]')?.getAttribute('aria-checked'),
    ).toBe('true');
  });
});

// @traces 356-FR-001 356-FR-009 356-FR-010
describe('the estimate box on the profile', () => {
  const DIAGNOSIS = {
    durationMinutes: 30,
    fromBani: 15_000,
    jobTypeId: 'j-diag',
    nameEn: 'Diagnosis and fault-code read',
    nameRo: 'Diagnoză și citire coduri de eroare',
    toBani: 22_000,
  };
  const BRAKES = {
    durationMinutes: 120,
    fromBani: 89_000,
    jobTypeId: 'j-brakes',
    nameEn: 'Front brake pads and discs',
    nameRo: 'Plăcuțe și discuri de frână față',
    toBani: 140_000,
  };
  const estimate = () =>
    page().querySelector<HTMLElement>('section[mf-estimate-section]');
  const switchOf = (name: string) =>
    [
      ...page().querySelectorAll<HTMLElement>(
        'section[data-slot="prices"] label.row',
      ),
    ]
      .find((row) => row.querySelector('.name')?.textContent?.trim() === name)
      ?.querySelector<HTMLElement>('[role="switch"]');

  beforeEach(() => sessionStorage.clear());

  it('comes right after the price list', async () => {
    await open('/ro/garages/service-auto-militari');
    await reads[0]?.answer({ ...FIXED, prices: [BRAKES] });

    // Below 1024 px the two columns dissolve and the order puts the box
    // next; from 1024 px it heads the side column.
    const main = [...page().querySelectorAll('.sections > .main > section')];
    expect(main.at(-2)?.matches('[data-slot="prices"]')).toBe(true);
    expect(page().querySelector('.sections > .side > section')).toBe(
      estimate(),
    );
    expect(estimate()?.getAttribute('aria-label')).toBe('Estimarea ta');
  });

  it('is not shown for an empty price list, nor while the first read is open', async () => {
    await open('/ro/garages/service-auto-militari');
    expect(estimate()).toBeNull();

    await reads[0]?.answer({ ...FIXED, prices: [] });
    expect(estimate()).toBeNull();
  });

  it('adds up a switch turned on in the list', async () => {
    await open('/ro/garages/service-auto-militari');
    await reads[0]?.answer({ ...FIXED, prices: [DIAGNOSIS, BRAKES] });

    switchOf('Plăcuțe și discuri de frână față')?.click();
    await settle();

    expect(
      estimate()?.querySelector('.totals')?.getAttribute('aria-label'),
    ).toBe('Estimare de la 890 la 1.400 lei');
  });

  it('gives each request button its own note when the brand is refused', async () => {
    await open('/ro/garages/service-auto-militari?brand=dacia');
    await reads[0]?.answer({
      ...FIXED,
      brand: { ...DACIA, stance: 'does_not_take' },
      prices: [BRAKES],
    });
    await settle();

    const buttons = [
      ...page().querySelectorAll<HTMLButtonElement>(
        'mf-request-quote-button button',
      ),
    ];
    // The header's, the box's and the phone bar's.
    expect(buttons).toHaveLength(3);
    const ids = buttons.map((b) => b.getAttribute('aria-describedby'));
    expect(new Set(ids).size).toBe(3);
    for (const id of ids) {
      expect(page().querySelector(`#${id}`)?.classList).toContain('note');
    }
  });

  it('restores the jobs kept for this garage in the session', async () => {
    sessionStorage.setItem(
      `mf.estimate.${FIXED.id}`,
      JSON.stringify(['j-diag']),
    );
    await open('/ro/garages/service-auto-militari');
    await reads[0]?.answer({ ...FIXED, prices: [DIAGNOSIS, BRAKES] });
    await settle();

    expect(
      switchOf('Diagnoză și citire coduri de eroare')?.getAttribute(
        'aria-checked',
      ),
    ).toBe('true');
    expect(
      estimate()?.querySelector('.totals')?.getAttribute('aria-label'),
    ).toBe('Estimare de la 150 la 220 lei');
  });

  it('switches off a job the next read no longer lists, and says so', async () => {
    await open('/ro/garages/service-auto-militari');
    await reads[0]?.answer({ ...FIXED, prices: [DIAGNOSIS, BRAKES] });
    switchOf('Plăcuțe și discuri de frână față')?.click();
    await settle();

    resync.next();
    await settle();
    await reads[1]?.answer({ ...FIXED, prices: [DIAGNOSIS] });
    await settle();

    expect(
      estimate()?.querySelector('.totals')?.getAttribute('aria-label'),
    ).toBe('Estimare de la 0 la 0 lei');
    expect(estimate()?.textContent).toContain(
      'O lucrare pornită nu mai este oferită de service.',
    );
  });
});

// The server render's answer reaches the browser through the transfer cache,
// which serves it at once: hydration finds the same section it rendered.
// @traces 355-FR-011
// @traces 1200-FR-005
// @traces 1200-FR-006
describe('the profile read the server render hands over', () => {
  const BRAKES = {
    durationMinutes: 120,
    fromBani: 89_000,
    jobTypeId: 'j-brakes',
    nameEn: 'Front brake pads and discs',
    nameRo: 'Plăcuțe și discuri de frână față',
    toBani: 140_000,
  };
  const prices = () =>
    page().querySelector<HTMLElement>('section[data-slot="prices"]');

  it('shows an answer served at once on its first render, with no skeleton', async () => {
    api.publicGaragesControllerBySlug.mockImplementationOnce(() =>
      Promise.resolve({ ...FIXED, prices: [BRAKES] }),
    );

    await open('/ro/garages/service-auto-militari?brand=bmw');

    expect(page().querySelector('[aria-busy="true"]')).toBeNull();
    expect(prices()?.textContent).toContain('890–1.400 lei');
  });

  // A signed-in visitor's token would keep the browser from the cached
  // answer, so the profile goes out as a public read.
  // @traces 1200-FR-004
  it('reads the profile once, as a public read', async () => {
    await open('/ro/garages/service-auto-militari?brand=bmw');

    expect(api.publicGaragesControllerBySlug).toHaveBeenCalledTimes(1);
    const [query, context] = api.publicGaragesControllerBySlug.mock.calls[0];
    expect(query).toEqual({ brand: 'bmw', slug: 'service-auto-militari' });
    expect(context?.get(PUBLIC_READ)).toBe(true);
  });
});

// @traces 1169-FR-008
describe('a profile pre-fetched from the results', () => {
  const send = (kind: string) =>
    messages.next({ at: '2026-10-08T12:00:00.000Z', id: 'x', kind });

  it('draws the pre-fetched answer with no read before it', async () => {
    prefetch.take.mockReturnValue(FIXED);

    await open('/ro/garages/service-auto-militari?brand=bmw');

    expect(prefetch.take).toHaveBeenCalledWith('service-auto-militari', 'bmw');
    expect(page().querySelector('[aria-busy="true"]')).toBeNull();
    expect(page().querySelector('h1')?.textContent?.trim()).toBe(
      'Service Auto Militari',
    );
    expect(reads).toHaveLength(0);
  });

  it('joins the stream and reads again on its messages, as today', async () => {
    jest.useFakeTimers();
    prefetch.take.mockReturnValue(FIXED);
    await open('/ro/garages/service-auto-militari');

    expect(live.register).toHaveBeenLastCalledWith({
      brand: undefined,
      garage: 'g-2',
    });
    send('garage.updated');
    jest.advanceTimersByTime(300);
    await settle();

    expect(reads).toHaveLength(1);
    await reads[0]?.answer({ ...FIXED, name: 'Service Auto Militari Nou' });
    expect(page().querySelector('h1')?.textContent?.trim()).toBe(
      'Service Auto Militari Nou',
    );
  });

  it('reads once as today when nothing was pre-fetched', async () => {
    await open('/ro/garages/service-auto-militari');

    expect(reads).toHaveLength(1);
    expect(page().querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it('says a garage it cannot find as today', async () => {
    await open('/ro/garages/nowhere');
    await reads[0]?.fail(404);

    expect(page().querySelector('mf-gone')).not.toBeNull();
    expect(response.status).toBe(404);
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

// @traces 384-FR-008
describe('the response line in the profile header', () => {
  const rated = (rate: number) =>
    ({ rate, state: 'rate' }) as PublicGarageDto['responseRate'];
  const line = () => page().querySelector<HTMLElement>('.rate');
  const follows = (a: Element | null, b: Element | null) =>
    !!a &&
    !!b &&
    (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

  it('says the rate after the verification line and before the request button', async () => {
    await open('/ro/garages/mecanic-mobil-ilfov');
    await reads[0]?.answer({ ...MOBILE, responseRate: rated(91) });

    expect(line()?.textContent?.trim()).toBe(
      'Răspunde la 91% din cereri într‑o zi',
    );
    expect(follows(page().querySelector('.verified'), line())).toBe(true);
    expect(
      follows(line(), page().querySelector('mf-request-quote-button')),
    ).toBe(true);
  });

  it('says the rate in English', async () => {
    await TestBed.inject(I18n).use('en');
    await open('/en/garages/mecanic-mobil-ilfov');
    await reads[0]?.answer({ ...MOBILE, responseRate: rated(91) });

    expect(line()?.textContent?.trim()).toBe(
      'Answers 91% of requests within a day',
    );
  });

  it('says a rate of 0', async () => {
    await open('/ro/garages/mecanic-mobil-ilfov');
    await reads[0]?.answer({ ...MOBILE, responseRate: rated(0) });

    expect(line()?.textContent?.trim()).toBe(
      'Răspunde la 0% din cereri într‑o zi',
    );
  });

  it('leads the line with an icon kept from screen readers', async () => {
    await open('/ro/garages/mecanic-mobil-ilfov');
    await reads[0]?.answer({ ...MOBILE, responseRate: rated(91) });

    const icon = line()?.querySelector('svg');
    expect(icon?.getAttribute('aria-hidden')).toBe('true');
    expect(icon?.getAttribute('width')).toBe('16');
  });

  it('shows the line for a garage with no verification line', async () => {
    await open('/ro/garages/service-auto-militari');
    await reads[0]?.answer({ ...FIXED, responseRate: rated(75) });

    expect(page().querySelector('.verified')).toBeNull();
    expect(line()?.textContent?.trim()).toBe(
      'Răspunde la 75% din cereri într‑o zi',
    );
  });

  it('says a garage with too few requests is new on MotorFix', async () => {
    await open('/ro/garages/mecanic-mobil-ilfov');
    await reads[0]?.answer({ ...MOBILE, responseRate: { state: 'new' } });

    expect(line()?.textContent?.trim()).toBe('Nou pe MotorFix');
  });

  it('says it in English too', async () => {
    await TestBed.inject(I18n).use('en');
    await open('/en/garages/mecanic-mobil-ilfov');
    await reads[0]?.answer({ ...MOBILE, responseRate: { state: 'new' } });

    expect(line()?.textContent?.trim()).toBe('New on MotorFix');
  });

  it('drops the line once the garage has had no request in the last 30 days', async () => {
    jest.useFakeTimers();
    await open('/ro/garages/mecanic-mobil-ilfov');
    await reads[0]?.answer({ ...MOBILE, responseRate: rated(91) });
    expect(line()).not.toBeNull();

    messages.next({
      at: '2026-10-10T01:00:00.000Z',
      id: 'x',
      kind: 'response_stats.updated',
    });
    jest.advanceTimersByTime(300);
    await settle();
    await reads[1]?.answer({ ...MOBILE, responseRate: { state: 'none' } });

    expect(line()).toBeNull();
    expect(text()).not.toContain('Nou pe MotorFix');
  });

  it("sets the line in the verification line's small secondary style, free to wrap", () => {
    const sheet = css('garage-profile.css');
    expect(sheet).toMatch(
      /\.rate[^{]*\{[^}]*color: var\(--mf-text-secondary\)/,
    );
    expect(sheet).not.toMatch(/\.rate[^{]*\{[^}]*--mf-size-small/);
    expect(sheet).not.toMatch(/\.rate[^{]*\{[^}]*nowrap/);
  });
});

// @traces 384-FR-009
describe('the response line kept live', () => {
  const send = (kind: string) =>
    messages.next({ at: '2026-10-10T01:00:00.000Z', id: 'x', kind });

  it('reads the profile again when the night changes the response figures', async () => {
    jest.useFakeTimers();
    await open('/ro/garages/service-auto-militari');
    await reads[0]?.answer(FIXED);

    send('response_stats.updated');
    jest.advanceTimersByTime(300);
    await settle();

    expect(reads).toHaveLength(2);
  });

  it('announces a changed rate in place, politely and without moving focus', async () => {
    jest.useFakeTimers();
    const announce = jest
      .spyOn(TestBed.inject(LiveAnnouncer), 'announce')
      .mockResolvedValue();
    await open('/ro/garages/service-auto-militari');
    await reads[0]?.answer({
      ...FIXED,
      responseRate: { rate: 91, state: 'rate' },
    });
    const focused = document.activeElement;

    send('response_stats.updated');
    jest.advanceTimersByTime(300);
    await settle();
    await reads[1]?.answer({
      ...FIXED,
      responseRate: { rate: 92, state: 'rate' },
    });

    expect(text()).toContain('Răspunde la 92% din cereri într‑o zi');
    expect(announce).toHaveBeenCalledWith(
      'Răspunde la 92% din cereri într‑o zi',
      'polite',
    );
    expect(document.activeElement).toBe(focused);
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

  // @traces 1353-FR-003
  it('reads again with the brand kept when a re-check is recorded, and shows the new date', async () => {
    jest.useFakeTimers();
    await open('/ro/garages/service-auto-militari?brand=dacia');
    await reads[0]?.answer({
      ...FIXED,
      verifiedAt: '2027-06-14T00:00:00.000Z',
    });

    send('recheck.recorded');
    jest.advanceTimersByTime(300);
    await settle();
    await reads[1]?.answer({
      ...FIXED,
      verifiedAt: '2027-08-01T00:00:00.000Z',
    });

    expect(reads.map((r) => r.query)).toEqual([
      { brand: 'dacia', slug: 'service-auto-militari' },
      { brand: 'dacia', slug: 'service-auto-militari' },
    ]);
    expect(text()).toContain('Ultima verificare: 1 aug. 2027.');
    expect(text()).not.toContain('14 iun. 2027');
  });

  // @traces 1353-FR-003
  it('switches to the no-longer-available view when the re-read after a re-check answers 410', async () => {
    jest.useFakeTimers();
    await open('/ro/garages/service-auto-militari');
    await reads[0]?.answer({
      ...FIXED,
      verifiedAt: '2027-06-14T00:00:00.000Z',
    });

    send('recheck.recorded');
    jest.advanceTimersByTime(300);
    await settle();
    await reads[1]?.fail(410);

    expect(text()).toContain('Acest service nu mai este disponibil');
    expect(page().querySelector('.verified')).toBeNull();
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

// @traces 143-FR-008
describe('the profile view', () => {
  const beacons = () =>
    api.profileViewsControllerRecord.mock.calls.map(([call]) => call);

  it('sends one view once the garage is known, and none before', async () => {
    await open('/ro/garages/service-auto-militari');
    expect(beacons()).toEqual([]);

    await reads[0]?.answer(FIXED);

    expect(beacons()).toEqual([
      { body: { source: 'profile_direct' }, id: 'g-2' },
    ]);
  });

  it('names the page the visitor came from', async () => {
    await open('/ro/garages');
    await open('/ro/garages/service-auto-militari');
    await reads[0]?.answer(FIXED);

    expect(beacons()).toEqual([{ body: { source: 'search' }, id: 'g-2' }]);
  });

  it('names a shared link by its marker', async () => {
    await open('/ro/garages/service-auto-militari?src=share');
    await reads[0]?.answer(FIXED);

    expect(beacons()).toEqual([{ body: { source: 'shared_link' }, id: 'g-2' }]);
  });

  it('sends no second view when the same garage is read again', async () => {
    await open('/ro/garages/service-auto-militari');
    await reads[0]?.answer(FIXED);
    await open('/ro/garages/service-auto-militari?brand=dacia');
    await reads[1]?.answer(FIXED);

    expect(beacons()).toHaveLength(1);
  });

  it('sends a view for the next garage the visitor opens', async () => {
    await open('/ro/garages/service-auto-militari');
    await reads[0]?.answer(FIXED);
    await open('/ro/garages/mecanic-mobil-ilfov');
    await reads[1]?.answer(MOBILE);

    expect(beacons().map((b) => b.id)).toEqual(['g-2', 'g-1']);
    expect(beacons()[1]?.body).toEqual({ source: 'profile_direct' });
  });

  it('sends nothing for a garage that is not there', async () => {
    await open('/ro/garages/nu-exista');
    await reads[0]?.fail(404);

    expect(beacons()).toEqual([]);
  });

  it('leaves the page as it is when the view is refused', async () => {
    api.profileViewsControllerRecord.mockReturnValueOnce(
      Promise.reject(new HttpErrorResponse({ status: 429 })),
    );
    await open('/ro/garages/service-auto-militari');
    await reads[0]?.answer(FIXED);
    await settle();

    expect(page().querySelector('h1')?.textContent?.trim()).toBe(
      'Service Auto Militari',
    );
    expect(text()).not.toContain('Nu am putut încărca');
    expect(response.status).toBeUndefined();
  });

  it('shows the garage while the view is still on its way', async () => {
    api.profileViewsControllerRecord.mockReturnValueOnce(
      new Promise<void>(() => undefined),
    );
    await open('/ro/garages/service-auto-militari');
    await reads[0]?.answer(FIXED);

    expect(page().querySelector('h1')?.textContent?.trim()).toBe(
      'Service Auto Militari',
    );
  });

  it('sends nothing from the server render', async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { component: GarageProfile, path: ':lang/garages/:garage' },
        ]),
        { provide: GaragesService, useValue: api },
        { provide: PublicLive, useValue: live },
        { provide: Consent, useValue: consent },
        { provide: Consent, useValue: consent },
        { provide: PLATFORM_ID, useValue: 'server' },
        { provide: RESPONSE_INIT, useValue: {} },
      ],
    });
    await TestBed.inject(I18n).enter('public');
    harness = await RouterTestingHarness.create();

    await open('/ro/garages/service-auto-militari');
    await reads[0]?.answer(FIXED);

    expect(beacons()).toEqual([]);
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

// @traces 1025-FR-007
describe('the profile page and the same-day line', () => {
  it('keeps the same-day sentence to the send confirmation, even for a high rate', async () => {
    await open('/ro/garages/mecanic-mobil-ilfov');
    await reads[0]?.answer({
      ...MOBILE,
      responseRate: { rate: 95, state: 'rate' },
    });

    expect(page().textContent).not.toMatch(/aceeași zi/);
    expect(page().querySelector('.rate')?.textContent?.trim()).toBe(
      'Răspunde la 95% din cereri într‑o zi',
    );
  });

  it('keeps it off the English profile too', async () => {
    await TestBed.inject(I18n).use('en');
    await open('/en/garages/mecanic-mobil-ilfov');
    await reads[0]?.answer({
      ...MOBILE,
      responseRate: { rate: 95, state: 'rate' },
    });

    expect(page().textContent).not.toMatch(/same day/);
    expect(page().querySelector('.rate')?.textContent?.trim()).toBe(
      'Answers 95% of requests within a day',
    );
  });
});

// @traces 250-FR-005
describe('the garage opened event', () => {
  const opened = () => consent.track.mock.calls;

  it('tells one open, with no source for a direct open and no garage named', async () => {
    await open('/ro/garages/service-auto-militari');
    expect(opened()).toEqual([]);

    await reads[0]?.answer(FIXED);

    expect(opened()).toEqual([['garage_opened', {}]]);
  });

  it.each([
    ['/ro/garages', 'results'],
    ['/ro', 'home'],
    ['/app/driver/saved', 'saved_list'],
  ])('names a garage opened after %s as %s', async (before, source) => {
    TestBed.inject(Router).resetConfig([
      ...TestBed.inject(Router).config,
      { children: [], path: 'app/driver/saved' },
    ]);
    await open(before);
    await open('/ro/garages/service-auto-militari');
    await reads[0]?.answer(FIXED);

    expect(opened()).toEqual([['garage_opened', { source }]]);
  });

  it('names a shared link', async () => {
    await open('/ro/garages/service-auto-militari?src=share');
    await reads[0]?.answer(FIXED);

    expect(opened()).toEqual([['garage_opened', { source: 'shared_link' }]]);
  });

  it('tells no second open when the same garage is read again', async () => {
    await open('/ro/garages/service-auto-militari');
    await reads[0]?.answer(FIXED);
    await open('/ro/garages/service-auto-militari?brand=dacia');
    await reads[1]?.answer(FIXED);

    expect(opened()).toHaveLength(1);
  });

  it('tells nothing for a garage that is not there', async () => {
    await open('/ro/garages/nu-exista');
    await reads[0]?.fail(404);

    expect(opened()).toEqual([]);
  });
});

// @traces 290-FR-009
describe('the save button in the profile header', () => {
  it('follows the request button, labelled, for the garage on the page', async () => {
    await open('/ro/garages/mecanic-mobil-ilfov');
    await reads[0]?.answer(MOBILE);

    const save = page().querySelector('mf-save-garage-button');
    const request = page().querySelector('mf-request-quote-button');
    expect(save?.querySelector('button')?.textContent?.trim()).toBe('Salvează');
    expect(
      request &&
        save &&
        request.compareDocumentPosition(save) &
          Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

// @traces 271-FR-015
describe('the distance line in the profile header', () => {
  const PLACE = {
    label: 'Militari',
    lat: 44.457,
    lng: 26.015,
    origin: 'address' as const,
  };
  const keep = () => TestBed.inject(PlaceStore).use(PLACE);
  const line = () =>
    [...page().querySelectorAll<HTMLElement>('.head .place')].map((p) =>
      p.textContent?.replace(/\s+/g, ' ').trim(),
    );

  it('re-reads a fixed garage once from the kept place and reads "la 2,4 km"', async () => {
    keep();
    await open('/ro/garages/service-auto-militari?brand=dacia');
    await reads[0]?.answer(FIXED);

    expect(reads.map((r) => r.query)).toEqual([
      { brand: 'dacia', slug: 'service-auto-militari' },
      { brand: 'dacia', near: '44.457,26.015', slug: 'service-auto-militari' },
    ]);
    expect(
      api.publicGaragesControllerBySlug.mock.calls[1]?.[1]?.get(PUBLIC_READ),
    ).toBe(true);
    expect(line()).toEqual([]);

    await reads[1]?.answer({ ...FIXED, distanceKm: 2.4 });

    expect(line()).toEqual(['la 2,4 km']);
    expect(text().indexOf('la 2,4 km')).toBeGreaterThan(
      text().indexOf('Service Auto Militari'),
    );
    expect(reads).toHaveLength(2);
  });

  it('writes a whole kilometre with its decimal, as the result card does', async () => {
    keep();
    await open('/ro/garages/service-auto-militari');
    await reads[0]?.answer(FIXED);
    await reads[1]?.answer({ ...FIXED, distanceKm: 1 });

    expect(line()).toEqual(['la 1,0 km']);
  });

  it('reads "2.4 km away" in English', async () => {
    await TestBed.inject(I18n).use('en');
    keep();
    await open('/en/garages/service-auto-militari');
    await reads[0]?.answer(FIXED);
    await reads[1]?.answer({ ...FIXED, distanceKm: 2.4 });

    expect(line()).toEqual(['2.4 km away']);
  });

  it('keeps the distance through a live re-read without asking again', async () => {
    jest.useFakeTimers();
    keep();
    await open('/ro/garages/service-auto-militari');
    await reads[0]?.answer(FIXED);
    await reads[1]?.answer({ ...FIXED, distanceKm: 2.4 });

    messages.next({
      at: '2026-10-18T10:00:00.000Z',
      id: 'x',
      kind: 'garage.updated',
    });
    jest.advanceTimersByTime(300);
    await settle();
    await reads[2]?.answer({ ...FIXED, name: 'Service Militari' });

    expect(reads.filter((r) => r.query.near)).toHaveLength(1);
    expect(line()).toEqual(['la 2,4 km']);
  });

  it('shows a mobile mechanic its area line only, never asking with the place', async () => {
    keep();
    await open('/ro/garages/mecanic-mobil-ilfov');
    await reads[0]?.answer(MOBILE);

    expect(reads).toHaveLength(1);
    expect(line()).toEqual(['Mecanic mobil · zonă de 20 km']);
    expect(text()).not.toMatch(/la \d/);
  });

  it('shows no distance and reads once without a place', async () => {
    await open('/ro/garages/service-auto-militari');
    await reads[0]?.answer(FIXED);

    expect(reads).toHaveLength(1);
    expect(line()).toEqual([]);
  });

  it('leaves the line out when the read from the place fails', async () => {
    keep();
    await open('/ro/garages/service-auto-militari');
    await reads[0]?.answer(FIXED);
    await reads[1]?.fail(503);

    expect(line()).toEqual([]);
    expect(page().querySelector('h1')?.textContent?.trim()).toBe(
      'Service Auto Militari',
    );
  });
});

// @traces 311-FR-001 311-FR-007
describe('the estimate bar on the profile', () => {
  const bar = () => page().querySelector('mf-estimate-bar');

  it('is in the garage branch only', async () => {
    await open('/ro/garages/service-auto-militari');
    expect(bar()).toBeNull();

    await reads[0]?.answer(FIXED);
    expect(bar()).not.toBeNull();
    expect(
      bar()?.previousElementSibling?.matches('mf-report-garage-link'),
    ).toBe(true);
  });

  it('is not shown for an unknown garage', async () => {
    await open('/ro/garages/service-auto-militari');
    await reads[0]?.fail(404);

    expect(bar()).toBeNull();
  });

  it('leaves the page room at its end for the bar', () => {
    expect(css('garage-profile.css')).toContain(
      'padding-bottom: calc(var(--mf-space-8) + var(--estimate-bar, 0px))',
    );
  });
});

// @traces 311-FR-009
describe('the profile in two columns', () => {
  it('splits the sections into a main and a side column', async () => {
    await open('/ro/garages/service-auto-militari');
    await reads[0]?.answer({
      ...FIXED,
      prices: [
        {
          durationMinutes: 30,
          fromBani: 15_000,
          jobTypeId: 'j-diag',
          nameEn: 'Diagnosis',
          nameRo: 'Diagnoză',
          toBani: 22_000,
        },
      ],
    });
    const slots = (column: string) =>
      [...page().querySelectorAll(`.sections > .${column} > section`)].map(
        (s) => s.getAttribute('data-slot') ?? 'estimate',
      );

    expect(slots('main')).toEqual([
      'photos',
      'brands',
      'mechanics',
      'prices',
      'reviews',
    ]);
    expect(slots('side')).toEqual(['estimate', 'where']);
  });

  it('keeps one column below 1024 px with the estimate after the prices', () => {
    const sheet = css('garage-profile.css');

    expect(sheet).toMatch(/\.main,\s*\.side\s*\{\s*display:\s*contents;?\s*\}/);
    expect(sheet).toMatch(/\[data-slot="reviews"\]\s*\{\s*order:\s*1;?\s*\}/);
    expect(sheet).toMatch(/\[data-slot="where"\]\s*\{\s*order:\s*2;?\s*\}/);
  });

  it('holds the side column in view from 1024 px', () => {
    const sheet = css('garage-profile.css');
    const wide = sheet.slice(sheet.indexOf('@media (min-width: 1024px)'));

    // 520 + 400 fit side by side at 1024 px, and 400 holds "REQUEST A QUOTE →" on one line.
    expect(wide).toMatch(/\.main\s*\{[^}]*flex:\s*999 1 520px/);
    expect(wide).toMatch(/\.side\s*\{[^}]*flex:\s*1 1 400px/);
    expect(wide).toMatch(/\.side\s*\{[^}]*position:\s*sticky/);
    expect(wide).toContain(
      'top: calc(var(--public-site-bar, 0px) + var(--mf-space-4))',
    );
    expect(wide).toMatch(/\.side\s*\{[^}]*overflow-y:\s*auto/);
    expect(sheet).toContain(
      '.side:not(:has(section:not(:empty))) {\n  display: none;',
    );
  });
});
