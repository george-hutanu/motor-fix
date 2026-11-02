import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PLATFORM_ID, signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import type { GaragePinsDto } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { Layout, type LayoutName, REDUCED_MOTION } from '@motor-fix/ui-cockpit';

import type { MapEvents, MapMove } from './pins-map';
import { RESULTS_MAP, ResultsMap, type ResultsMapView } from './results-map';
import type { MapFake } from '../../place-step/place-step.testing';
import {
  boundsOf,
  fitView,
  type MapView,
  paddingOf,
} from '../../static-map/fit-view';
import { StaticMap } from '../../static-map/static-map';

jest.mock('maplibre-gl', () =>
  jest.requireActual('../../place-step/place-step.testing'),
);

const PINS: GaragePinsDto = {
  pins: [
    {
      id: 'g-1',
      lat: 44.44,
      lng: 26.12,
      matches: true,
      rateLei: 150,
      stance: 'works_on',
    },
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
  (
    _host: HTMLElement,
    on: MapEvents,
    _here: HTMLElement,
    _start?: { center: [number, number]; zoom: number },
  ) =>
    new Promise<ResultsMapView>((resolve, reject) => {
      moved = on.moved;
      tapped = on.picked;
      shifted = on.shifted;
      opened = resolve;
      failed = reject;
    }),
);

let fixture: ComponentFixture<ResultsMap>;
// On a phone the summary above the map says it is unavailable, so most of
// these tests look at the map from a tablet up.
const layout = signal<LayoutName>('tablet');

async function render({
  language = 'ro' as 'ro' | 'en',
  platform = 'browser',
  loading = false,
  on = 'tablet' as LayoutName,
  // The interactive map opens on a tap of the static one; most of these
  // tests look at it open, so they tap first.
  activated = true,
  still = false,
} = {}) {
  layout.set(on);
  TestBed.configureTestingModule({
    providers: [
      { provide: RESULTS_MAP, useValue: open },
      { provide: PLATFORM_ID, useValue: platform },
      { provide: Layout, useValue: { current: layout } },
      { provide: REDUCED_MOTION, useValue: signal(still) },
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
  if (activated && platform === 'browser') tap();
}

// The driver taps the static map's "Hartă interactivă".
function tap() {
  element().querySelector<HTMLElement>('mf-static-map button')?.click();
  fixture.detectChanges();
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
    mark: jest.fn(),
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
    expect(open).toHaveBeenCalledWith(
      host,
      {
        moved: expect.any(Function),
        picked: expect.any(Function),
        shifted: expect.any(Function),
      },
      element().querySelector('.here'),
      { center: expect.any(Array), zoom: expect.any(Number) },
    );
  });
});

// @traces 1196-FR-010 1196-FR-011 1196-FR-020
describe('ResultsMap, the static map first', () => {
  const still = () =>
    element().querySelector('mf-static-map') as HTMLElement | null;
  beforeEach(() => {
    jest
      .spyOn(HTMLElement.prototype, 'clientWidth', 'get')
      .mockReturnValue(800);
    jest
      .spyOn(HTMLElement.prototype, 'clientHeight', 'get')
      .mockReturnValue(600);
  });

  afterEach(() => jest.restoreAllMocks());

  it('shows the static map and loads no MapLibre on render, pins, place or scheme', async () => {
    await render({ activated: false });
    fixture.componentRef.setInput('pins', PINS);
    fixture.componentRef.setInput('place', { lat: 44.5, lng: 26.2 });
    fixture.componentInstance.fit();
    fixture.detectChanges();
    window.dispatchEvent(new Event('resize'));
    fixture.detectChanges();
    await fixture.whenStable();

    expect(still()).not.toBeNull();
    expect(open).not.toHaveBeenCalled();
  });

  it('frames the static view with the same function as the first fit, the covered bands included', async () => {
    await render({ activated: false });
    fixture.componentRef.setInput('legend', false);
    fixture.componentRef.setInput('pins', PINS);
    fixture.detectChanges();
    fixture.componentInstance.fit();
    fixture.detectChanges();

    expect(still()?.querySelector('img')?.getAttribute('src')).toBeTruthy();
    const { center, zoom } = fitView(
      boundsOf([PLACE, PINS.pins[0]]),
      { h: 600, w: 800 },
      paddingOf(0),
    );
    expect(still()?.querySelector('img')?.getAttribute('src')).toContain(
      `z=${zoom}&lat=${center.lat}&lng=${center.lng}`,
    );
  });

  it('draws the picture only once the search has settled', async () => {
    await render({ activated: false, loading: true });
    fixture.componentInstance.fit();
    fixture.detectChanges();

    expect(still()?.querySelector('img')).toBeNull();
  });

  it('renders no static image on the server', async () => {
    await render({ platform: 'server' });

    expect(still()?.querySelector('img')).toBeFalsy();
    expect(open).not.toHaveBeenCalled();
  });
});

// @traces 1196-FR-014
// QA lap 2: measured while the phone's sheet still slid in, the corner's
// credit sat under the sheet once it came to rest.
describe('ResultsMap, the static map under a phone sheet that moves', () => {
  let sheetTop = 700;
  let sheet: HTMLElement;
  const covered = () =>
    (
      element().querySelector('mf-static-map') as HTMLElement | null
    )?.style.getPropertyValue('--covered');
  const shown = () =>
    fixture.debugElement
      .query(By.directive(StaticMap))
      ?.componentInstance.view() as MapView | undefined;
  // The view a 390 x 600 map frames with these covers.
  const framed = (bottom: number, top: number) =>
    fitView(
      boundsOf([PLACE, PINS.pins[0]]),
      { h: 600, w: 390 },
      paddingOf(bottom, top),
    );
  // Where each measured element runs, top to bottom: the map's box 100 to
  // 700, the static map's control at its top right 112 to 156, the sheet
  // from its top.
  const band = (el: HTMLElement): [number, number] => {
    if (el.classList.contains('map')) return [100, 700];
    if (el.tagName === 'MF-RESULTS-SHEET') return [sheetTop, sheetTop];
    if (el.tagName === 'BUTTON' && el.closest('mf-static-map'))
      return [112, 156];
    return [0, 0];
  };
  beforeEach(() => {
    sheetTop = 700;
    jest
      .spyOn(HTMLElement.prototype, 'clientWidth', 'get')
      .mockReturnValue(390);
    jest
      .spyOn(HTMLElement.prototype, 'clientHeight', 'get')
      .mockReturnValue(600);
    jest
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(function (this: HTMLElement) {
        const [top, bottom] = band(this);
        return {
          bottom,
          height: bottom - top,
          left: 0,
          right: 390,
          toJSON: () => ({}),
          top,
          width: 390,
          x: 0,
          y: top,
        } as DOMRect;
      });
  });

  afterEach(() => {
    sheet?.remove();
    jest.restoreAllMocks();
  });

  async function withSheet() {
    await render({ activated: false, on: 'phone' });
    fixture.componentRef.setInput('pins', PINS);
    fixture.detectChanges();
    const parent = (fixture.nativeElement as HTMLElement)
      .parentElement as HTMLElement;
    sheet = document.createElement('mf-results-sheet');
    parent.append(sheet);
    return sheet;
  }

  // QA lap 3 at 320 x 640: above the half sheet the corner had no room
  // beside the legend, so on a phone it no longer rides on the sheet.
  it('leaves the corner where the map’s own edges put it, whatever the sheet covers', async () => {
    await withSheet();
    sheetTop = 400;
    sheet.dispatchEvent(new Event('animationend', { bubbles: true }));
    fixture.detectChanges();

    expect(covered()).toBe('0px');
  });

  it('frames the pins below the control at the top right, as below the zoom buttons', async () => {
    await withSheet();
    sheetTop = 400;
    sheet.dispatchEvent(new Event('animationend', { bubbles: true }));
    fixture.detectChanges();

    expect(shown()).toEqual(framed(300, 56));
    expect(shown()).not.toEqual(framed(300, 0));
  });

  it('measures the sheet again once it comes to rest', async () => {
    await withSheet();
    sheetTop = 400;
    sheet.dispatchEvent(new Event('animationend', { bubbles: true }));
    fixture.detectChanges();

    expect(shown()).toEqual(framed(300, 56));

    sheetTop = 600;
    sheet.dispatchEvent(new Event('transitionend', { bubbles: true }));
    fixture.detectChanges();

    expect(shown()).toEqual(framed(100, 56));
  });

  // QA lap 4 (second run): at 320 x 568 with the consent bar asking, the
  // sheet rested over the control and cut it in half.
  const cramped = () =>
    element().querySelector('mf-static-map')?.classList.contains('cramped');

  it('tells the static map its control is covered where the sheet rests over it', async () => {
    await withSheet();
    sheetTop = 160;
    sheet.dispatchEvent(new Event('animationend', { bubbles: true }));
    fixture.detectChanges();

    expect(cramped()).toBe(true);
  });

  it('keeps the control shown where the sheet clears it by the 8 px gap', async () => {
    await withSheet();
    sheetTop = 164;
    sheet.dispatchEvent(new Event('animationend', { bubbles: true }));
    fixture.detectChanges();

    expect(cramped()).toBe(false);
  });

  it('shows the control again once the sheet rests lower', async () => {
    await withSheet();
    sheetTop = 140;
    sheet.dispatchEvent(new Event('animationend', { bubbles: true }));
    fixture.detectChanges();
    sheetTop = 400;
    sheet.dispatchEvent(new Event('transitionend', { bubbles: true }));
    fixture.detectChanges();

    expect(cramped()).toBe(false);
  });

  // QA lap 5: under reduced motion the sheet moves with no transition, so no
  // transitionend ever came and the control stayed cut at 320 x 568 (en).
  it('measures again when the sheet moves with no transition, under reduced motion', async () => {
    await withSheet();
    sheetTop = 140;
    sheet.setAttribute('data-position', 'half');
    await Promise.resolve();
    fixture.detectChanges();

    expect(cramped()).toBe(true);
    expect(shown()).toEqual(framed(424, 56));

    sheetTop = 400;
    sheet.setAttribute('style', '--sheet-top: 90px;');
    await Promise.resolve();
    fixture.detectChanges();

    expect(cramped()).toBe(false);
  });

  it('ignores the end of a transition inside the sheet', async () => {
    await withSheet();
    const chip = document.createElement('button');
    sheet.append(chip);
    sheetTop = 400;
    sheet.dispatchEvent(new Event('animationend', { bubbles: true }));
    fixture.detectChanges();
    sheetTop = 650;
    chip.dispatchEvent(new Event('transitionend', { bubbles: true }));
    fixture.detectChanges();

    expect(shown()).toEqual(framed(300, 56));
  });
});

// @traces 1196-FR-015 1196-FR-016 1196-FR-019
describe('ResultsMap, the hand-over to the interactive map', () => {
  const still = () =>
    element().querySelector('mf-static-map') as HTMLElement | null;

  it('opens the interactive map at the static view on a tap', async () => {
    await render({ activated: false });
    fixture.componentRef.setInput('pins', PINS);
    fixture.componentInstance.fit();
    fixture.detectChanges();
    tap();

    const shown = fitView(
      boundsOf([PLACE, PINS.pins[0]]),
      { h: 0, w: 0 },
      paddingOf(0),
    );
    expect(open).toHaveBeenCalledTimes(1);
    expect(open.mock.calls[0][3]).toEqual({
      center: [shown.center.lng, shown.center.lat],
      zoom: shown.zoom,
    });
  });

  it('opens it from a tap anywhere on the static map too', async () => {
    await render({ activated: false });
    still()?.click();

    expect(open).toHaveBeenCalledTimes(1);
  });

  it('does nothing on a second tap while the map loads', async () => {
    await render({ activated: false });
    tap();
    tap();
    still()?.click();

    expect(open).toHaveBeenCalledTimes(1);
  });

  it('then shows, lights and marks as before', async () => {
    await render();
    fixture.componentRef.setInput('pins', PINS);
    fixture.componentRef.setInput('lit', 'g-1');
    fixture.detectChanges();
    await ready();

    expect(view.show).toHaveBeenLastCalledWith(PINS);
    expect(view.light).toHaveBeenLastCalledWith('g-1');
    expect(view.mark).toHaveBeenLastCalledWith(PLACE);
  });

  it('fades the static map out once the style has loaded, taking its control out of reach at once', async () => {
    await render();
    await ready();

    expect(still()?.classList.contains('leaving')).toBe(true);
    expect(still()?.hasAttribute('inert')).toBe(true);
  });

  it('removes the static map after the fade', async () => {
    await render();
    await ready();
    await new Promise((resolve) => setTimeout(resolve, 250));
    fixture.detectChanges();

    expect(still()).toBeNull();
    expect(element().querySelector('button')).toBeNull();
  });

  it('swaps at once under reduced motion', async () => {
    await render({ still: true });
    await ready();
    await new Promise((resolve) => setTimeout(resolve));
    fixture.detectChanges();

    expect(still()).toBeNull();
  });

  it('drops the static map for the grey one when the interactive map cannot open', async () => {
    await render();
    failed(new Error('style 500'));
    await fixture.whenStable();
    fixture.detectChanges();

    expect(still()).toBeNull();
    expect(element().querySelector('.placeholder')).not.toBeNull();
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

  // @traces 1181-FR-006
  it('leaves the legend out when the results have nothing to explain, keeping the map', async () => {
    await render();
    fixture.componentRef.setInput('brand', '');
    fixture.componentRef.setInput('legend', false);
    fixture.detectChanges();

    expect(element().querySelector('section.map')).not.toBeNull();
    expect(element().querySelector('.legend')).toBeNull();
  });
});

// @traces 269-FR-015
// @traces 1358-FR-004
describe('ResultsMap, the legend on a phone', () => {
  const phone =
    readFileSync(join(__dirname, 'results-map.css'), 'utf8')
      .replace(/\s+/g, ' ')
      .match(/@media \(max-width: 767\.98px\) \{(.*?\}) \}/)?.[1] ?? '';

  it('sits at the top of the map, above the results sheet', () => {
    expect(phone).toMatch(
      /\.legend \{ bottom: auto; [^}]*top: var\(--mf-space-3\); \}/,
    );
  });

  it('leaves the zoom buttons at its right free at every phone width', () => {
    expect(phone).toMatch(
      /\.legend \{[^}]*max-width: calc\(100% - var\(--mf-space-3\) - var\(--zoom-room\)\);/,
    );
    // The buttons are tap-sized (styles.css), not MapLibre's 29 px.
    expect(phone).toMatch(/--zoom-room: calc\(var\(--mf-tap\) \+ \d+px\);/);
    // The padding counts inside the width, or the legend runs 24 px further.
    expect(phone).toMatch(/\.legend \{[^}]*box-sizing: border-box;/);
  });

  // 1196: the static map's control takes the zoom buttons' place, wider.
  it('leaves the static map’s control at its right free while it shows', () => {
    const all = readFileSync(join(__dirname, 'results-map.css'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\s+/g, ' ');
    expect(all).toMatch(
      /@media \(max-width: 767\.98px\) \{ \.map \{ --static-control: [^;]+; \} \.map:has\(> mf-static-map:not\(\.leaving\)\) \{ --zoom-room: calc\( ?var\(--static-control\) \+ var\(--mf-space-3\) \+ var\(--mf-space-2\) ?\); \} \}/,
    );
  });

  it('gives way to the zoom hint there', () => {
    expect(phone).toMatch(
      /\.hint:not\(:empty\) ~ \.legend \{ visibility: hidden; \}/,
    );
  });
});

// @traces 1351-FR-001 1351-FR-007
describe('ResultsMap, the legend on a phone', () => {
  const narrow =
    readFileSync(join(__dirname, 'results-map.css'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\s+/g, ' ')
      .match(
        /@media \(max-width: 767\.98px\) \{ \.legend \{([^}]*)\} \}/,
      )?.[1] ?? '';

  // Four rows with the mobile mechanic's entry, at 320 px and at 390 px in
  // Romanian: at the phone's own spacing a half sheet held at the zoom
  // buttons' 104 px cuts the last one.
  it('packs its rows tighter, so the whole legend clears the half sheet', () => {
    expect(narrow).toMatch(/line-height: 1\.25;/);
    expect(narrow).toMatch(/padding-block: var\(--mf-space-1\);/);
    expect(narrow).toMatch(/row-gap: 0;/);
    expect(narrow).toMatch(/top: var\(--mf-space-2\);/);
  });

  it('keeps every entry at the body size a phone reads', () => {
    expect(narrow).not.toBe('');
    expect(narrow).not.toMatch(/font-size/);
  });
});

describe('ResultsMap, the legend with a mobile mechanic', () => {
  const WITH_AREA: GaragePinsDto = {
    pins: [
      ...PINS.pins,
      {
        id: 'g-2',
        lat: 44.45,
        lng: 26.13,
        matches: true,
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

  // @traces 1358-FR-010
  it('leaves the text to the summary on a phone', async () => {
    await render({ on: 'phone' });
    failed(new Error('style 500'));
    await fixture.whenStable();
    fixture.detectChanges();

    expect(said(status())).toBe('');
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

    expect(view.fit).toHaveBeenCalledWith(PLACE, PINS, 0);
  });

  it('fits once the map has opened when asked before', async () => {
    await render();
    fixture.componentRef.setInput('pins', PINS);
    fixture.detectChanges();

    fixture.componentInstance.fit();
    await ready();

    expect(view.fit).toHaveBeenCalledTimes(1);
    expect(view.fit).toHaveBeenCalledWith(PLACE, PINS, 0);
  });

  // @traces 271-FR-004
  it("fits the place clear of the legend over the map's bottom edge", async () => {
    await render();
    await ready();
    fixture.componentRef.setInput('pins', PINS);
    fixture.detectChanges();
    const rect = (top: number, bottom: number) => ({ bottom, top }) as DOMRect;
    const section = element().querySelector<HTMLElement>('section.map');
    const key = element().querySelector<HTMLElement>('.legend');
    if (!section || !key) throw new Error('no map or legend');
    section.getBoundingClientRect = () => rect(100, 500);
    key.getBoundingClientRect = () => rect(430, 488);

    fixture.componentInstance.fit();

    expect(view.fit).toHaveBeenCalledWith(PLACE, PINS, 70);
  });

  // @traces 1358-FR-004
  it('on a phone fits the place and the pins between the legend at the top and the results sheet over the bottom', async () => {
    await render({ on: 'phone' });
    await ready();
    fixture.componentRef.setInput('pins', PINS);
    fixture.detectChanges();
    const rect = (top: number, bottom: number) => ({ bottom, top }) as DOMRect;
    const section = element().querySelector<HTMLElement>('section.map');
    const key = element().querySelector<HTMLElement>('.legend');
    if (!section || !key) throw new Error('no map or legend');
    const stage = document.createElement('div');
    const sheet = document.createElement('mf-results-sheet');
    element().before(stage);
    stage.append(element(), sheet);
    section.getBoundingClientRect = () => rect(180, 720);
    key.getBoundingClientRect = () => rect(192, 258);
    sheet.getBoundingClientRect = () => rect(450, 1000);

    fixture.componentInstance.fit();
    // A sheet over nearly all of the map leaves the pins room to be framed.
    sheet.getBoundingClientRect = () => rect(200, 1000);
    fixture.componentInstance.fit();

    expect(view.fit.mock.calls).toEqual([
      [PLACE, PINS, 270, 78],
      [PLACE, PINS, 342, 78],
    ]);
    stage.remove();
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

// @traces 248-FR-004
describe('RESULTS_MAP, the map while it loads', () => {
  const { fake } = jest.requireMock<MapFake>('maplibre-gl');

  afterEach(() => {
    fake.manualLoad = false;
  });

  it('keeps the canvas MapLibre adds out of the keyboard order before the map has loaded', async () => {
    fake.manualLoad = true;
    const host = document.createElement('div');
    document.body.append(host);
    void TestBed.inject(RESULTS_MAP)(
      host,
      {
        moved: jest.fn(),
        picked: jest.fn(),
        shifted: jest.fn(),
      },
      document.createElement('div'),
      { center: [26.1, 44.43], zoom: 12 },
    );
    // The opener awaits MapLibre's import before it builds the map.
    await new Promise((resolve) => setTimeout(resolve));

    // MapLibre draws its canvas, focusable, long before the style loads.
    const canvas = document.createElement('canvas');
    canvas.tabIndex = 0;
    host.append(canvas);
    await Promise.resolve();

    expect(canvas.hasAttribute('tabindex')).toBe(false);
    host.remove();
  });

  // @traces 1196-FR-015
  it('leaves no map and no watcher behind when the pins cannot be drawn on it', async () => {
    const { Map: Built } = jest.requireMock<{
      Map: { prototype: { addSource(): void } };
    }>('maplibre-gl');
    jest.spyOn(Built.prototype, 'addSource').mockImplementationOnce(() => {
      throw new Error('source');
    });
    const host = document.createElement('div');
    document.body.append(host);

    await expect(
      TestBed.inject(RESULTS_MAP)(
        host,
        { moved: jest.fn(), picked: jest.fn(), shifted: jest.fn() },
        document.createElement('div'),
        { center: [26.1, 44.43], zoom: 12 },
      ),
    ).rejects.toThrow('source');
    const canvas = document.createElement('canvas');
    canvas.tabIndex = 0;
    host.append(canvas);
    await Promise.resolve();

    expect(fake.map.remove).toHaveBeenCalled();
    expect(canvas.getAttribute('tabindex')).toBe('0');
    host.remove();
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

// @traces 271-FR-004
describe('ResultsMap, the "you are here" marker', () => {
  const OTHER = { lat: 46.771, lng: 23.624 };
  const marker = () => open.mock.calls[0]?.[2];

  it('hands the map one marker, hidden from assistive technology', async () => {
    await render();

    expect(marker()).toBeInstanceOf(HTMLElement);
    expect(marker()?.getAttribute('aria-hidden')).toBe('true');
    expect(marker()?.textContent?.trim()).toBe('');
  });

  it('marks the place once the map has opened, and each place after', async () => {
    await render();
    await ready();

    expect(view.mark).toHaveBeenLastCalledWith(PLACE);

    fixture.componentRef.setInput('place', OTHER);
    fixture.detectChanges();
    expect(view.mark).toHaveBeenLastCalledWith(OTHER);

    fixture.componentRef.setInput('place', undefined);
    fixture.detectChanges();
    expect(view.mark).toHaveBeenLastCalledWith(undefined);
  });

  it('marks nothing before the map has opened', async () => {
    await render();

    expect(view.mark).not.toHaveBeenCalled();
  });

  describe('its stylesheet', () => {
    const css = readFileSync(join(__dirname, 'results-map.css'), 'utf8');
    // The rules inside each "no-preference" block, and those outside them.
    const blocks = [
      ...css.matchAll(
        /@media \(prefers-reduced-motion: no-preference\) \{([\s\S]*?)\n\}/g,
      ),
    ].map((m) => m[1] ?? '');
    const outside = blocks.reduce(
      (rest, block) => rest.replace(block, ''),
      css,
    );

    it('draws the marker in the theme accent', () => {
      expect(css).toMatch(/\.here\s*\{[^}]*var\(--mf-amber\)/);
    });

    it('pulses the ring with mf-ring only when the device allows motion', () => {
      expect(css).toMatch(/@keyframes mf-ring\s*\{/);
      expect(blocks.join('\n')).toMatch(/animation:\s*mf-ring 2\.2s/);
      expect(outside).not.toMatch(/animation:[^;]*mf-ring/);
    });

    it('hides the marker while it waits in the page rather than on the map', () => {
      // MapLibre gives the element its marker class as soon as it wraps it,
      // so only where it sits tells whether it has been placed.
      expect(css).toMatch(/\.map\s*>\s*\.here\s*\{[^}]*display:\s*none/);
      expect(css).not.toMatch(/\.here:not\(\.maplibregl-marker\)/);
    });

    it('lets a tap through the marker to the pins under it', () => {
      expect(css).toMatch(/\.here\s*\{[^}]*pointer-events:\s*none/);
    });
  });
});
