import { PLATFORM_ID } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import type { GaragePinsDto } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';

import type { MapEvents, MapMove } from './pins-map';
import { RESULTS_MAP, ResultsMap, type ResultsMapView } from './results-map';

const PINS: GaragePinsDto = {
  pins: [
    { id: 'g-1', lat: 44.44, lng: 26.12, rateLei: 150, stance: 'works_on' },
  ],
  total: 1,
};
const PLACE = { lat: 44.437, lng: 26.117 };

let view: jest.Mocked<ResultsMapView>;
let opened: (value: ResultsMapView) => void;
let failed: (error: unknown) => void;
let moved: (move: MapMove) => void;
let tapped: (id: string | undefined) => void;
let shifted: () => void;
const open = jest.fn(
  (_host: HTMLElement, on: MapEvents) =>
    new Promise<ResultsMapView>((resolve, reject) => {
      moved = on.moved;
      tapped = on.picked;
      shifted = on.shifted;
      opened = resolve;
      failed = reject;
    }),
);

let fixture: ComponentFixture<ResultsMap>;

async function render({
  language = 'ro' as 'ro' | 'en',
  platform = 'browser',
  loading = false,
} = {}) {
  TestBed.configureTestingModule({
    providers: [
      { provide: RESULTS_MAP, useValue: open },
      { provide: PLATFORM_ID, useValue: platform },
    ],
  });
  const i18n = TestBed.inject(I18n);
  await i18n.enter('public');
  if (language === 'en') await i18n.use('en');
  fixture = TestBed.createComponent(ResultsMap);
  fixture.componentRef.setInput('brand', 'BMW');
  fixture.componentRef.setInput('loading', loading);
  fixture.componentRef.setInput('place', PLACE);
  fixture.componentRef.setInput('pins', undefined);
  fixture.detectChanges();
  await fixture.whenStable();
}

async function ready() {
  opened(view);
  await fixture.whenStable();
  fixture.detectChanges();
}

const element = () => fixture.nativeElement as HTMLElement;
const said = (el: Element | null | undefined) =>
  el?.textContent?.replace(/\s+/g, ' ').trim();
const legend = () =>
  Array.from(element().querySelectorAll('.legend li')).map(said);

beforeEach(() => {
  open.mockClear();
  view = {
    destroy: jest.fn(),
    fit: jest.fn(),
    light: jest.fn(),
    show: jest.fn(),
    spot: jest.fn((_at: { lat: number; lng: number }) => ({ x: 120, y: 40 })),
  };
});

// @traces 269-FR-016
describe('ResultsMap, the map region', () => {
  it('names the region in Romanian', async () => {
    await render();

    expect(
      element().querySelector('section.map')?.getAttribute('aria-label'),
    ).toBe('Harta service‑urilor');
  });

  it('names the region in English', async () => {
    await render({ language: 'en' });

    expect(
      element().querySelector('section.map')?.getAttribute('aria-label'),
    ).toBe('Map of garages');
  });

  it('keeps the map canvas away from assistive technology, yet open to the pointer', async () => {
    await render();
    const host = element().querySelector('.canvas');

    expect(host?.hasAttribute('inert')).toBe(false);
    expect(host?.getAttribute('aria-hidden')).toBe('true');
    expect(open).toHaveBeenCalledWith(host, {
      moved: expect.any(Function),
      picked: expect.any(Function),
      shifted: expect.any(Function),
    });
  });
});

// @traces 269-FR-015
describe('ResultsMap, the legend', () => {
  it('says what the colours and the number mean, in Romanian', async () => {
    await render();

    expect(legend()).toEqual(['primește BMW', 'nu primește', 'lei pe oră']);
    expect(element().querySelector('.legend .takes')).not.toBeNull();
    expect(element().querySelector('.legend .refuses')).not.toBeNull();
  });

  it('says what the colours and the number mean, in English', async () => {
    await render({ language: 'en' });

    expect(legend()).toEqual(['takes BMW', "doesn't", 'lei per hour']);
  });

  it('holds the brand line as a placeholder until the brand is known, never a bare "primește"', async () => {
    await render();
    fixture.componentRef.setInput('brand', '');
    fixture.detectChanges();

    expect(legend()).toEqual(['', 'nu primește', 'lei pe oră']);
    expect(
      element().querySelector('.legend .takes + .skeleton'),
    ).not.toBeNull();
  });
});

// @traces 269-FR-015
describe('ResultsMap, the legend with a mobile mechanic', () => {
  const WITH_AREA: GaragePinsDto = {
    pins: [
      ...PINS.pins,
      {
        id: 'g-2',
        lat: 44.45,
        lng: 26.13,
        rateLei: 120,
        serviceRadiusKm: 20,
        stance: 'works_on',
      },
    ],
    total: 2,
  };

  it('explains the circle while one is on the map, in Romanian', async () => {
    await render();
    fixture.componentRef.setInput('pins', WITH_AREA);
    fixture.detectChanges();

    expect(legend()).toEqual([
      'primește BMW',
      'nu primește',
      'lei pe oră',
      'Mecanic mobil · zona deservită',
    ]);
    expect(element().querySelector('.legend .area')).not.toBeNull();
  });

  it('explains the circle in English', async () => {
    await render({ language: 'en' });
    fixture.componentRef.setInput('pins', WITH_AREA);
    fixture.detectChanges();

    expect(legend().at(-1)).toBe('Mobile mechanic · service area');
  });

  it('drops the entry when the circles go', async () => {
    await render();
    fixture.componentRef.setInput('pins', WITH_AREA);
    fixture.detectChanges();
    fixture.componentRef.setInput('pins', PINS);
    fixture.detectChanges();

    expect(legend()).toHaveLength(3);
  });
});

// @traces 269-FR-017
describe('ResultsMap, while it opens', () => {
  it('shows a grey map and the legend while the search runs', async () => {
    await render({ loading: true });
    await ready();

    expect(element().querySelector('.placeholder')).not.toBeNull();
    expect(legend()).toHaveLength(3);
  });

  it('shows a grey map until the map has opened', async () => {
    await render();

    expect(element().querySelector('.placeholder')).not.toBeNull();

    await ready();

    expect(element().querySelector('.placeholder')).toBeNull();
  });

  it('keeps the grey map when the map cannot open', async () => {
    await render();
    failed(new Error('style 500'));
    await fixture.whenStable();
    fixture.detectChanges();

    expect(element().querySelector('.placeholder')).not.toBeNull();
  });

  it('renders the region, the grey map and the legend on the server, and opens no map there', async () => {
    await render({ platform: 'server' });

    expect(element().querySelector('section.map')).not.toBeNull();
    expect(element().querySelector('.placeholder')).not.toBeNull();
    expect(legend()).toHaveLength(3);
    expect(open).not.toHaveBeenCalled();
  });
});

// @traces 269-FR-016
// @traces 269-FR-017
describe('ResultsMap, when the map cannot open', () => {
  const status = () => element().querySelector('[role="status"]');

  async function broken(language: 'ro' | 'en' = 'ro') {
    await render({ language });
    failed(new Error('style 500'));
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('reads "Harta nu este disponibilă acum" in a status region, outside the hidden canvas', async () => {
    await broken();

    expect(said(status())).toBe('Harta nu este disponibilă acum');
    expect(status()?.closest('[aria-hidden="true"]')).toBeNull();
  });

  it('reads "The map is not available now" in English', async () => {
    await broken('en');

    expect(said(status())).toBe('The map is not available now');
  });

  it('keeps the grey map and the legend, and offers nothing to focus', async () => {
    await broken();

    expect(element().querySelector('.placeholder')).not.toBeNull();
    expect(legend()).toHaveLength(3);
    expect(
      element().querySelectorAll('a, button, input, [tabindex]'),
    ).toHaveLength(0);
  });

  it('says nothing while the map opens, nor once it has', async () => {
    await render();

    expect(said(status())).toBe('');

    await ready();

    expect(said(status())).toBe('');
  });

  it('draws nothing it is given once it has failed', async () => {
    await broken();
    fixture.componentRef.setInput('pins', PINS);
    fixture.detectChanges();

    expect(view.show).not.toHaveBeenCalled();
  });
});

// @traces 269-FR-012 269-FR-013
describe('ResultsMap, the pins it is given', () => {
  it('draws the pins once the map has opened, and each answer after', async () => {
    await render();
    fixture.componentRef.setInput('pins', PINS);
    fixture.detectChanges();
    await ready();

    expect(view.show).toHaveBeenLastCalledWith(PINS);

    const next = { pins: [], total: 0 };
    fixture.componentRef.setInput('pins', next);
    fixture.detectChanges();

    expect(view.show).toHaveBeenLastCalledWith(next);
  });

  it('fits the place and the pins when asked, at once when open', async () => {
    await render();
    await ready();
    fixture.componentRef.setInput('pins', PINS);
    fixture.detectChanges();

    fixture.componentInstance.fit();

    expect(view.fit).toHaveBeenCalledWith(PLACE, PINS);
  });

  it('fits once the map has opened when asked before', async () => {
    await render();
    fixture.componentRef.setInput('pins', PINS);
    fixture.detectChanges();

    fixture.componentInstance.fit();
    await ready();

    expect(view.fit).toHaveBeenCalledTimes(1);
    expect(view.fit).toHaveBeenCalledWith(PLACE, PINS);
  });

  it('closes the map with the page', async () => {
    await render();
    await ready();

    fixture.destroy();

    expect(view.destroy).toHaveBeenCalled();
  });
});

// @traces 269-FR-007
// @traces 269-FR-009
describe('ResultsMap, a move of the map', () => {
  const hint = () => element().querySelector('[role="status"]');

  it('gives the box the driver settled on', async () => {
    await render();
    await ready();
    const boxes: string[] = [];
    fixture.componentInstance.moved.subscribe((box) => boxes.push(box));

    moved({ bbox: '44.4,26,44.5,26.2' });

    expect(boxes).toEqual(['44.4,26,44.5,26.2']);
  });

  it('says "Apropie harta" in a status region while the box is too wide, and gives no box', async () => {
    await render();
    await ready();
    const boxes: string[] = [];
    fixture.componentInstance.moved.subscribe((box) => boxes.push(box));

    expect(hint()).not.toBeNull();
    expect(said(hint())).toBe('');

    moved({ tooWide: true });
    fixture.detectChanges();

    expect(said(hint())).toBe('Apropie harta');
    expect(hint()?.closest('[inert]')).toBeNull();
    expect(boxes).toEqual([]);

    moved({ bbox: '44.4,26,44.5,26.2' });
    fixture.detectChanges();

    expect(said(hint())).toBe('');
    expect(boxes).toEqual(['44.4,26,44.5,26.2']);
  });

  it('drops "Apropie harta" when the map is fitted back to the search', async () => {
    await render();
    await ready();

    moved({ tooWide: true });
    fixture.detectChanges();
    expect(said(hint())).toBe('Apropie harta');

    fixture.componentInstance.fit();
    fixture.detectChanges();

    expect(said(hint())).toBe('');
  });

  it('says "Zoom in" in English', async () => {
    await render({ language: 'en' });
    await ready();

    moved({ tooWide: true });
    fixture.detectChanges();

    expect(said(hint())).toBe('Zoom in');
  });
});

const BRAND = { id: 'b-1', name: 'BMW', slug: 'bmw' };
const PIN = PINS.pins[0];

// @traces 270-FR-008
describe('ResultsMap, the lit garage', () => {
  it('lights the garage it is given once the map has opened, and each one after', async () => {
    await render();
    fixture.componentRef.setInput('lit', 'g-1');
    fixture.detectChanges();
    await ready();

    expect(view.light).toHaveBeenLastCalledWith('g-1');

    fixture.componentRef.setInput('lit', undefined);
    fixture.detectChanges();

    expect(view.light).toHaveBeenLastCalledWith(undefined);
  });

  it('keeps the garage lit when the pins are read again', async () => {
    await render();
    await ready();
    fixture.componentRef.setInput('lit', 'g-1');
    fixture.componentRef.setInput('pins', PINS);
    fixture.detectChanges();
    view.light.mockClear();
    view.show.mockClear();

    fixture.componentRef.setInput('pins', { ...PINS });
    fixture.detectChanges();

    expect(view.show).toHaveBeenCalledTimes(1);
    expect(view.light).not.toHaveBeenCalledWith(undefined);
  });
});

// @traces 270-FR-004
// @traces 270-FR-010
// @traces 270-FR-011
describe('ResultsMap, a tapped pin and its small card', () => {
  const card = () => element().querySelector<HTMLElement>('mf-map-card');

  async function withCard() {
    await render();
    await ready();
    fixture.componentRef.setInput('cardBrand', BRAND);
    fixture.componentRef.setInput('card', { pin: PIN });
    fixture.detectChanges();
  }

  it('gives the garage of the tapped pin, and none for a tap away', async () => {
    await render();
    await ready();
    const got: (string | undefined)[] = [];
    fixture.componentInstance.picked.subscribe((id) => got.push(id));

    tapped('g-1');
    tapped(undefined);

    expect(got).toEqual(['g-1', undefined]);
  });

  it('opens the small card at the pin, outside the hidden canvas', async () => {
    await withCard();

    expect(view.spot).toHaveBeenCalledWith({ lat: PIN.lat, lng: PIN.lng });
    expect(card()).not.toBeNull();
    expect(card()?.closest('[aria-hidden="true"]')).toBeNull();
    expect(card()?.style.getPropertyValue('--x')).toBe('120px');
  });

  it('follows the pin when the map moves', async () => {
    await withCard();
    view.spot.mockReturnValue({ x: 60, y: 90 });

    shifted();
    fixture.detectChanges();

    expect(card()?.style.getPropertyValue('--x')).toBe('60px');
    expect(card()?.style.top).toBe('76px');
  });

  it('stands above its pin, pushed inside the map near its top edge rather than flipped', async () => {
    await withCard();

    expect(card()?.style.top).toBe('26px');

    view.spot.mockReturnValue({ x: 60, y: 5 });
    shifted();
    fixture.detectChanges();

    expect(card()?.style.top).toBe('8px');
    expect(card()?.classList).not.toContain('below');
  });

  it('measures the small card again when the page fills it, so a taller card still clears its pin', async () => {
    await withCard();
    view.spot.mockReturnValue({ x: 60, y: 200 });
    shifted();
    fixture.detectChanges();
    expect(card()?.style.top).toBe('186px');

    // The garage read fills the card: a new card value, a taller element.
    Object.defineProperty(card(), 'offsetHeight', {
      configurable: true,
      get: () => 60,
    });
    fixture.componentRef.setInput('card', { pin: PIN });
    fixture.detectChanges();
    fixture.detectChanges();

    expect(card()?.style.top).toBe('126px');
  });

  it('closes the small card when the page clears it', async () => {
    await withCard();

    fixture.componentRef.setInput('card', undefined);
    fixture.detectChanges();

    expect(card()).toBeNull();
  });

  it('opens no small card before the map has opened, nor once it has failed', async () => {
    await render();
    fixture.componentRef.setInput('cardBrand', BRAND);
    fixture.componentRef.setInput('card', { pin: PIN });
    fixture.detectChanges();

    expect(card()).toBeNull();

    failed(new Error('style'));
    await fixture.whenStable();
    fixture.detectChanges();

    expect(card()).toBeNull();
  });
});
