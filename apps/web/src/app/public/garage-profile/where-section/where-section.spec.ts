import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Component, PLATFORM_ID, signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import type { PublicGarageDto } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';

import { GARAGE_MAP, GarageMap } from './garage-map/garage-map';
import { WhereSection } from './where-section';
import { Consent } from '../../../consent/consent';

const OPEN = [['08:00', '19:00']];
const HOURS = {
  fri: OPEN,
  mon: OPEN,
  sat: [['09:00', '14:00']],
  sun: [],
  thu: OPEN,
  tue: OPEN,
  wed: OPEN,
};
const ADDRESS = 'Str. Atelierului 14, Militari, Sector 6, București';

const GARAGE: PublicGarageDto = {
  address: ADDRESS,
  brandNote: null,
  businessKind: 'company',
  closedDays: [],
  doesNotTake: [],
  facilities: [],
  hours: HOURS,
  id: 'g-1',
  jobTypes: [],
  name: 'Atelier Dinamo',
  paymentMethods: { card: false, cash: false, transfer: false },
  photos: [],
  prices: [],
  rating: null,
  refusalPhrase: null,
  responseRate: { state: 'new' },
  reviewCount: 0,
  slug: 'atelier-dinamo',
  verifiedAt: null,
  worksOn: [],
};

const MOBILE: PublicGarageDto = {
  ...GARAGE,
  address: undefined,
  businessKind: 'mobile',
  serviceRadiusKm: 35,
};

@Component({
  imports: [WhereSection],
  template: `<section
    data-slot="where"
    mf-where-section
    [garage]="garage()"
  ></section>`,
})
class Host {
  readonly garage = signal(GARAGE);
}

let fixture: ComponentFixture<Host>;
const track = jest.fn();
const open = jest.fn(() => new Promise<never>(() => undefined));

beforeEach(async () => {
  track.mockClear();
  TestBed.configureTestingModule({
    providers: [
      { provide: Consent, useValue: { track } },
      { provide: GARAGE_MAP, useValue: open },
    ],
  });
  await TestBed.inject(I18n).enter('public');
  await TestBed.inject(I18n).use('ro');
  fixture = TestBed.createComponent(Host);
  await settle();
});

afterEach(() => fixture.destroy());

async function settle() {
  for (let i = 0; i < 3; i++) {
    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

async function show(garage: Partial<PublicGarageDto>) {
  fixture.componentInstance.garage.set({ ...GARAGE, ...garage });
  await settle();
}

async function english() {
  await TestBed.inject(I18n).use('en');
  await settle();
}

const section = () =>
  fixture.nativeElement.querySelector('section') as HTMLElement;
const text = (el: Element | null | undefined) =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const rows = () =>
  [...section().querySelectorAll('.row')].map((row) => [
    text(row.querySelector('.days')),
    text(row.querySelector('.times')),
  ]);

// @traces 308-FR-011
// @traces 308-FR-012
// @traces 308-FR-015
describe('where a workshop is and when it is open', () => {
  it('is titled Unde and shows the address as one text, then the hours', () => {
    expect(text(section().querySelector('h2'))).toBe('Unde');
    expect(text(section().querySelector('.address'))).toBe(ADDRESS);
    expect(rows()).toEqual([
      ['Luni – vineri', '08:00 – 19:00'],
      ['Sâmbătă', '09:00 – 14:00'],
      ['Duminică', 'Închis'],
    ]);
    expect(section().hidden).toBe(false);
  });

  it('says it in English, the address as the garage wrote it', async () => {
    await english();

    expect(text(section().querySelector('h2'))).toBe('Where');
    expect(text(section().querySelector('.address'))).toBe(ADDRESS);
    expect(rows()).toEqual([
      ['Monday – Friday', '08:00 – 19:00'],
      ['Saturday', '09:00 – 14:00'],
      ['Sunday', 'Closed'],
    ]);
  });

  it('marks a closed day so it can stand apart', () => {
    const closed = section().querySelectorAll('.times.closed');

    expect([...closed].map((el) => text(el))).toEqual(['Închis']);
  });

  it('shows the address and no hours line when the hours were never sent', async () => {
    await show({ hours: {} });

    expect(text(section().querySelector('.address'))).toBe(ADDRESS);
    expect(rows()).toEqual([]);
  });

  it('shows nothing when it has neither an address nor hours', async () => {
    await show({ address: undefined, hours: {} });

    expect(section().hidden).toBe(true);
    expect(text(section())).toBe('');
  });
});

// @traces 308-FR-011
// @traces 308-FR-015
describe('where a mobile mechanic works', () => {
  it('says it comes to the driver within its radius, with no address', async () => {
    await show(MOBILE);

    expect(text(section().querySelector('.area'))).toBe(
      'Vine la tine în zona de 35 km',
    );
    expect(section().querySelector('.address')).toBeNull();
    expect(rows()).toEqual([
      ['Luni – vineri', '08:00 – 19:00'],
      ['Sâmbătă', '09:00 – 14:00'],
      ['Duminică', 'Închis'],
    ]);
  });

  it('says 20 km when the answer carries no radius', async () => {
    await show({ ...MOBILE, serviceRadiusKm: undefined });

    expect(text(section().querySelector('.area'))).toBe(
      'Vine la tine în zona de 20 km',
    );
  });

  it('never falls back to an address, even one the answer carried', async () => {
    await show({ ...MOBILE, address: ADDRESS });

    expect(section().querySelector('.address')).toBeNull();
    expect(text(section())).not.toContain('Atelierului');
  });

  it('says it in English', async () => {
    await show(MOBILE);
    await english();

    expect(text(section().querySelector('.area'))).toBe(
      'Comes to you within 35 km',
    );
  });
});

const LAT = 44.4352671;
const LNG = 26.0123456;
const PLACED: Partial<PublicGarageDto> = { latitude: LAT, longitude: LNG };
const GOOGLE = `https://www.google.com/maps/dir/?api=1&destination=${LAT},${LNG}`;
const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36';

const link = () => section().querySelector<HTMLAnchorElement>('a.directions');
const map = () => section().querySelector('mf-garage-map');
// Each child of the section by what it is.
const PARTS: [string, string][] = [
  ['mf-garage-map', 'map'],
  ['h2', 'title'],
  ['.address', 'address'],
  ['.hours', 'hours'],
  ['.directions', 'directions'],
];
const order = () =>
  [...section().children].map(
    (el) => PARTS.find(([is]) => el.matches(is))?.[1] ?? el.tagName,
  );

// Renders the section afresh, as a browser of this user agent would.
async function on(agent: string, platform = 'browser') {
  fixture.destroy();
  jest.spyOn(navigator, 'userAgent', 'get').mockReturnValue(agent);
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      { provide: Consent, useValue: { track } },
      { provide: GARAGE_MAP, useValue: open },
      { provide: PLATFORM_ID, useValue: platform },
    ],
  });
  await TestBed.inject(I18n).enter('public');
  await TestBed.inject(I18n).use('ro');
  fixture = TestBed.createComponent(Host);
  fixture.componentInstance.garage.set({ ...GARAGE, ...PLACED });
  await settle();
}

// @traces 1366-FR-001
// @traces 1366-FR-008
// @traces 1366-FR-013
describe('where a placed workshop is, on a map and by directions', () => {
  afterEach(() => jest.restoreAllMocks());

  it('shows the map first, then the title, the address, the hours and the directions last', async () => {
    await show(PLACED);

    expect(order()).toEqual(['map', 'title', 'address', 'hours', 'directions']);
    expect(text(link())).toBe('Arată traseul');
  });

  it('gives the map the garage’s own point', async () => {
    await show(PLACED);
    const piece = fixture.debugElement.query(By.directive(GarageMap))
      .componentInstance as GarageMap;

    expect(piece.point()).toEqual({ lat: LAT, lng: LNG });
  });

  it('keeps the directions last when the garage sent no hours', async () => {
    await show({ ...PLACED, hours: {} });

    expect(order()).toEqual(['map', 'title', 'address', 'directions']);
  });

  it('says it in English', async () => {
    await show(PLACED);
    await english();

    expect(text(link())).toBe('Get directions');
  });

  it('sends a computer to Google Maps in a new tab', async () => {
    await show(PLACED);

    expect(link()?.getAttribute('href')).toBe(GOOGLE);
    expect(link()?.getAttribute('target')).toBe('_blank');
    expect(link()?.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('sends an iPhone to Apple Maps, in the same tab', async () => {
    await on(IPHONE);

    expect(link()?.getAttribute('href')).toBe(
      `https://maps.apple.com/?daddr=${LAT},${LNG}`,
    );
    expect(link()?.hasAttribute('target')).toBe(false);
    expect(link()?.hasAttribute('rel')).toBe(false);
  });

  it('sends an Android phone to its maps app, in the same tab', async () => {
    await on(ANDROID);

    expect(link()?.getAttribute('href')).toBe(
      `geo:${LAT},${LNG}?q=${LAT},${LNG}`,
    );
    expect(link()?.hasAttribute('target')).toBe(false);
    expect(link()?.hasAttribute('rel')).toBe(false);
  });

  it('carries the computer address in the server render, whatever the agent', async () => {
    await on(IPHONE, 'server');

    expect(link()?.getAttribute('href')).toBe(GOOGLE);
  });

  it('reads the coordinates of the answer and nothing else, a new address waiting changing nothing', async () => {
    await show({ ...PLACED, address: 'Bd. Nou 1, Cluj' });

    expect(link()?.getAttribute('href')).toBe(GOOGLE);
  });

  it('is a row a finger can take', () => {
    const css = readFileSync(join(__dirname, 'where-section.css'), 'utf8');

    expect(css).toMatch(/\.directions\s*\{[^}]*min-height:\s*var\(--mf-tap\)/);
  });
});

// @traces 1366-FR-007
describe('where a garage with no point is', () => {
  it.each([
    ['no latitude', { longitude: LNG }],
    ['no longitude', { latitude: LAT }],
    ['neither', {}],
  ])('shows no map and no directions with %s', async (_, point) => {
    await show(point);

    expect(map()).toBeNull();
    expect(link()).toBeNull();
    expect(text(section().querySelector('.address'))).toBe(ADDRESS);
  });

  it('leaves a mobile mechanic as it was, with no map and no directions', async () => {
    await show({ ...MOBILE, ...PLACED });

    expect(map()).toBeNull();
    expect(link()).toBeNull();
    expect(text(section().querySelector('.area'))).toBe(
      'Vine la tine în zona de 35 km',
    );
  });
});

// @traces 1366-FR-011
describe('a tap on the directions', () => {
  afterEach(() => jest.restoreAllMocks());

  it('counts it with the platform only', async () => {
    await show(PLACED);
    link()?.addEventListener('click', (event) => event.preventDefault());
    link()?.click();

    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith('directions_opened', {
      platform: 'computer',
    });
  });

  it('names the phone it was made on', async () => {
    await on(IPHONE);
    link()?.addEventListener('click', (event) => event.preventDefault());
    link()?.click();

    expect(track).toHaveBeenCalledWith('directions_opened', {
      platform: 'ios',
    });
  });
});

// @traces 1366-FR-006
// @traces 1366-FR-013
describe('where a placed workshop is, once its map cannot show', () => {
  it('drops the map box and keeps the rest in its order, saying nothing', async () => {
    await show(PLACED);
    const piece = fixture.debugElement.query(By.directive(GarageMap))
      .componentInstance as GarageMap;
    piece.gone.emit();
    await settle();

    expect(map()).toBeNull();
    expect(order()).toEqual(['title', 'address', 'hours', 'directions']);
    expect(link()?.getAttribute('href')).toBe(GOOGLE);
    expect(
      section().querySelector('[role="alert"], [role="status"], [aria-live]'),
    ).toBeNull();
  });

  it('shows the map again for another garage', async () => {
    await show(PLACED);
    (
      fixture.debugElement.query(By.directive(GarageMap))
        .componentInstance as GarageMap
    ).gone.emit();
    await settle();
    await show({ ...PLACED, id: 'g-2', latitude: 45.75, longitude: 21.22 });

    expect(map()).not.toBeNull();
  });
});
