import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PLATFORM_ID } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { staticMapPath } from '@motor-fix/contracts/map-view';
import type { GaragePinDto, GaragePinsDto } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';

import { StaticMap } from './static-map';

const VIEW = { center: { lat: 44.43, lng: 26.1 }, zoom: 12 };
const PLACE = { lat: 44.437, lng: 26.117 };
const pinOf = (n: number, over: Partial<GaragePinDto> = {}): GaragePinDto => ({
  id: `g-${n}`,
  lat: 44.42 + n / 1000,
  lng: 26.09 + n / 1000,
  rateLei: 150,
  stance: 'works_on',
  ...over,
});
const PINS: GaragePinsDto = {
  pins: [
    pinOf(1),
    pinOf(2, { lat: 44.44, lng: 26.11, stance: 'does_not_take' }),
  ],
  total: 2,
};

type TestWindow = { matchMedia?: unknown };
const view = window as unknown as TestWindow;
let dark = false;
let reduced = false;
let schemeChanged: ((event: { matches: boolean }) => void) | undefined;
let box = { height: 500, width: 390 };

let fixture: ComponentFixture<StaticMap>;
const element = () => fixture.nativeElement as HTMLElement;
const image = () => element().querySelector('img');
const activated = jest.fn();

async function render({
  platform = 'browser',
  language = 'ro' as 'ro' | 'en',
  framed = true,
} = {}) {
  TestBed.configureTestingModule({
    providers: [{ provide: PLATFORM_ID, useValue: platform }],
  });
  const i18n = TestBed.inject(I18n);
  await i18n.enter('public');
  if (language === 'en') await i18n.use('en');
  fixture = TestBed.createComponent(StaticMap);
  fixture.componentRef.setInput('view', framed ? VIEW : undefined);
  fixture.componentRef.setInput('pins', PINS);
  fixture.componentRef.setInput('place', PLACE);
  fixture.componentInstance.activate.subscribe(activated);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
}

beforeEach(() => {
  dark = false;
  reduced = false;
  box = { height: 500, width: 390 };
  activated.mockClear();
  view.matchMedia = jest.fn((query: string) => ({
    addEventListener: (
      _: string,
      follow: (e: { matches: boolean }) => void,
    ) => {
      if (query.includes('color-scheme')) schemeChanged = follow;
    },
    matches:
      (dark && query === '(prefers-color-scheme: dark)') ||
      (reduced && query === '(prefers-reduced-motion: reduce)'),
    removeEventListener: jest.fn(),
  }));
  jest
    .spyOn(HTMLElement.prototype, 'clientWidth', 'get')
    .mockImplementation(() => box.width);
  jest
    .spyOn(HTMLElement.prototype, 'clientHeight', 'get')
    .mockImplementation(() => box.height);
});

afterEach(() => {
  delete view.matchMedia;
  jest.restoreAllMocks();
});

// @traces 1196-FR-013
describe('StaticMap, the image', () => {
  it('renders only the grey placeholder on the server, with no image to fetch', async () => {
    await render({ platform: 'server' });

    expect(element().querySelector('.blank')).not.toBeNull();
    expect(image()?.getAttribute('src') ?? null).toBeNull();
  });

  it('asks for the view at the buckets at or above the measured box, in the light scheme', async () => {
    await render();

    expect(image()?.getAttribute('src')).toBe(
      staticMapPath({
        h: 640,
        lat: 44.43,
        lng: 26.1,
        theme: 'light',
        w: 390,
        z: 12,
      }),
    );
  });

  it('asks for the dark image in a dark scheme, and again when the scheme turns', async () => {
    dark = true;
    await render();

    expect(image()?.getAttribute('src')).toContain('theme=dark');

    schemeChanged?.({ matches: false });
    fixture.detectChanges();
    expect(image()?.getAttribute('src')).toContain('theme=light');
  });

  it('asks for no image while it has no view, as while a search runs', async () => {
    await render({ framed: false });

    expect(image()?.getAttribute('src') ?? null).toBeNull();
    expect(element().querySelector('.blank')).not.toBeNull();
    expect(element().querySelector('.overlay')).toBeNull();
  });

  it('keeps the image when only the pins change, and asks again when the view does', async () => {
    await render();
    const first = image()?.getAttribute('src');

    fixture.componentRef.setInput('pins', { pins: [pinOf(3)], total: 1 });
    fixture.detectChanges();
    expect(image()?.getAttribute('src')).toBe(first);
    expect(element().querySelectorAll('.pin')).toHaveLength(1);

    fixture.componentRef.setInput('view', { ...VIEW, zoom: 13 });
    fixture.detectChanges();
    expect(image()?.getAttribute('src')).toContain('z=13');
  });

  // @traces 1196-FR-019
  it('is decorative: an empty alt, the list being the accessible path', async () => {
    await render();

    expect(image()?.getAttribute('alt')).toBe('');
  });

  // @traces 1196-FR-017
  it('drops the image and the overlay when the image fails, keeping the placeholder and saying nothing', async () => {
    await render();
    image()?.dispatchEvent(new Event('error'));
    fixture.detectChanges();

    expect(image()).toBeNull();
    expect(element().querySelector('.overlay')).toBeNull();
    expect(element().querySelector('.blank')).not.toBeNull();
    expect(element().textContent).not.toMatch(/disponibil/);
  });

  it('tries again for a new view after a failed image', async () => {
    await render();
    image()?.dispatchEvent(new Event('error'));
    fixture.detectChanges();
    fixture.componentRef.setInput('view', { ...VIEW, zoom: 13 });
    fixture.detectChanges();

    expect(image()?.getAttribute('src')).toContain('z=13');
  });
});

// @traces 1196-FR-012
// @traces 1366-FR-006
describe('StaticMap, telling its host the image failed', () => {
  it('says so once when the image fails, and never while it shows', async () => {
    await render();
    const failed = jest.fn();
    fixture.componentInstance.failed.subscribe(failed);
    fixture.detectChanges();

    expect(failed).not.toHaveBeenCalled();

    image()?.dispatchEvent(new Event('error'));
    fixture.detectChanges();

    expect(failed).toHaveBeenCalledTimes(1);
    expect(image()).toBeNull();
  });
});

describe('StaticMap, the overlay', () => {
  it('draws a pin per fixed garage with its rate, coloured by stance, hidden from assistive technology', async () => {
    await render();
    const overlay = element().querySelector('.overlay');
    const pins = Array.from(element().querySelectorAll('.pin'));

    expect(overlay?.getAttribute('aria-hidden')).toBe('true');
    expect(pins.map((pin) => pin.textContent?.trim())).toEqual(['150', '150']);
    expect(pins[0].classList.contains('takes')).toBe(true);
    expect(pins[1].classList.contains('takes')).toBe(false);
    expect(
      element().querySelectorAll(
        '.overlay [tabindex], .overlay button, .overlay a',
      ),
    ).toHaveLength(0);
  });

  it('lights the garage it is given in amber', async () => {
    await render();
    fixture.componentRef.setInput('lit', 'g-2');
    fixture.detectChanges();

    const lit = Array.from(element().querySelectorAll('.pin.lit'));
    expect(lit).toHaveLength(1);
    expect(lit[0].textContent?.trim()).toBe('150');
    expect(lit[0]).toBe(element().querySelectorAll('.pin')[1]);
  });

  // QA lap 6 at 390 px: the lit pin's rate drew over its neighbour's.
  it('lets a rate that would cover another give way, the lit one placed first', async () => {
    await render();
    fixture.componentRef.setInput('pins', {
      pins: [pinOf(1, { rateLei: 140 }), pinOf(2, { rateLei: 180 })],
      total: 2,
    });
    fixture.detectChanges();
    const rates = () =>
      Array.from(element().querySelectorAll('.pin')).map((pin) =>
        pin.textContent?.trim(),
      );

    expect(rates()).toEqual(['140', '']);

    fixture.componentRef.setInput('lit', 'g-2');
    fixture.detectChanges();

    expect(rates()).toEqual(['', '180']);
  });

  // @traces 1196-FR-018
  it('draws a mobile mechanic as its circle, lit like a pin', async () => {
    await render();
    fixture.componentRef.setInput('pins', {
      pins: [pinOf(4, { serviceRadiusKm: 3 })],
      total: 1,
    });
    fixture.componentRef.setInput('lit', 'g-4');
    fixture.detectChanges();

    expect(element().querySelectorAll('.pin')).toHaveLength(0);
    expect(element().querySelectorAll('.area.lit')).toHaveLength(1);
  });

  it('counts a crowded answer into clusters', async () => {
    await render();
    fixture.componentRef.setInput('pins', {
      pins: Array.from({ length: 51 }, (_, n) => pinOf(1, { id: `c-${n}` })),
      total: 51,
    });
    fixture.detectChanges();

    expect(element().querySelector('.cluster')?.textContent?.trim()).toBe('51');
  });

  it('marks the place, and nothing without one', async () => {
    await render();

    expect(element().querySelector('.overlay .here')).not.toBeNull();

    fixture.componentRef.setInput('place', undefined);
    fixture.detectChanges();
    expect(element().querySelector('.overlay .here')).toBeNull();
  });
});

// @traces 1196-FR-014 1196-FR-015
describe('StaticMap, the attribution and the control', () => {
  it('credits the tiles in text that takes no focus', async () => {
    await render();
    const credit = element().querySelector('.attribution');

    expect(credit?.textContent?.trim()).toBe(
      '© OpenFreeMap © OpenMapTiles © OpenStreetMap contributors',
    );
    expect(credit?.querySelector('a, button, [tabindex]')).toBeNull();
  });

  it('offers "Hartă interactivă" as the one button the map adds', async () => {
    await render();
    const buttons = element().querySelectorAll('button');

    expect(buttons).toHaveLength(1);
    expect(buttons[0].textContent?.trim()).toBe('Hartă interactivă');
    expect(buttons[0].hasAttribute('hlmBtn')).toBe(true);
  });

  it('names the control in English', async () => {
    await render({ language: 'en' });

    expect(element().querySelector('button')?.textContent?.trim()).toBe(
      'Interactive map',
    );
  });

  // @traces 1196-FR-018
  it('asks for the interactive map once from the control', async () => {
    await render();
    element().querySelector('button')?.click();

    expect(activated).toHaveBeenCalledTimes(1);
  });

  it('asks for the interactive map from a tap anywhere on it', async () => {
    await render();
    element().querySelector<HTMLElement>('.overlay')?.click();
    element().click();

    expect(activated).toHaveBeenCalledTimes(2);
  });

  it('still asks for it once the image has failed', async () => {
    await render();
    image()?.dispatchEvent(new Event('error'));
    fixture.detectChanges();
    element().querySelector('button')?.click();

    expect(activated).toHaveBeenCalledTimes(1);
  });

  describe('its stylesheet', () => {
    const css = readFileSync(join(__dirname, 'static-map.css'), 'utf8');
    const blocks = [
      ...css.matchAll(
        /@media \(prefers-reduced-motion: no-preference\) \{([\s\S]*?)\n\}/g,
      ),
    ].map((m) => m[1] ?? '');
    const outside = blocks.reduce(
      (rest, block) => rest.replace(block, ''),
      css,
    );

    it('crops the image centred at its own pixel size, never scaling it', () => {
      expect(css).toMatch(/img\s*\{[^}]*object-fit:\s*none/);
    });

    // QA lap 2: the pins' rates drew over the control's text on a phone.
    it('draws the control and the credit above every pin, a lit one too', () => {
      const lit = Number(
        css.match(/\.pin\.lit\s*\{[^}]*z-index:\s*(\d+)/)?.[1] ?? 0,
      );
      const corner = Number(
        css.match(/\.corner\s*\{[^}]*z-index:\s*(\d+)/)?.[1] ?? 0,
      );
      expect(corner).toBeGreaterThan(lit);
    });

    it('gives the control a solid panel, so no pin or ground shows through its text', () => {
      expect(css).toMatch(
        /button\s*\{[^}]*background:\s*var\(--mf-panel-raised\)/,
      );
    });

    // QA lap 3 at 320 x 640: the strip a phone's half sheet leaves cannot
    // hold the legend, the control and the credit, so on a phone they take
    // the interactive map's places: the control where its zoom buttons sit,
    // the credit at the map's own bottom edge, under the sheet.
    describe('on a phone', () => {
      const phone =
        css
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/\s+/g, ' ')
          .match(/@media \(max-width: 767\.98px\) \{(.*?\}) \}/)?.[1] ?? '';
      const body = (selector: string) =>
        phone.match(new RegExp(`(?:^| )${selector} \\{([^}]*)\\}`))?.[1] ?? '';

      it('lets the control and the credit stand apart from the corner', () => {
        expect(body('\\.corner')).toMatch(/display: contents;/);
      });

      it('sets the control at the top right, where the zoom buttons sit', () => {
        const button = body('button');
        expect(button).toMatch(/position: absolute;/);
        expect(button).toMatch(/top: var\(--mf-space-3\);/);
        expect(button).toMatch(/right: var\(--mf-space-3\);/);
        expect(button).toMatch(/width: var\(--static-control\);/);
        expect(button).not.toMatch(/--covered/);
      });

      it('sets the credit at the map’s bottom right, under the sheet as the interactive map’s is', () => {
        const credit = body('\\.attribution');
        expect(credit).toMatch(/position: absolute;/);
        expect(credit).toMatch(/bottom: var\(--mf-space-3\);/);
        expect(credit).toMatch(/right: var\(--mf-space-3\);/);
        expect(credit).not.toMatch(/--covered/);
      });

      it('keeps both above every pin', () => {
        const lit = Number(
          css.match(/\.pin\.lit\s*\{[^}]*z-index:\s*(\d+)/)?.[1] ?? 0,
        );
        for (const selector of ['button', '\\.attribution']) {
          const z = Number(body(selector).match(/z-index: (\d+);/)?.[1] ?? 0);
          expect(z).toBeGreaterThan(lit);
        }
      });
    });

    // QA lap 4: the sweep measures spacing on the 4 px grid.
    it('spaces a pin’s rate from its dot on the 4 px grid', () => {
      expect(css).toMatch(/\.pin\s*\{[^}]*gap:\s*var\(--mf-space-1\)/);
    });

    it('pads the credit on the 4 px grid', () => {
      expect(css).toMatch(
        /\.attribution\s*\{[^}]*padding:\s*var\(--mf-space-1\) var\(--mf-space-2\)/,
      );
    });

    it('reads the credit at a phone’s 16 px body size there', () => {
      const phone =
        css
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/\s+/g, ' ')
          .match(/@media \(max-width: 767\.98px\) \{(.*?\}) \}/)?.[1] ?? '';
      expect(phone).toMatch(
        /\.attribution \{[^}]*font-size: var\(--mf-size-body\);/,
      );
    });

    // QA lap 4 (second run): the plain .attribution rule came after the
    // phone one and kept the credit at 13 px.
    it('lets the phone rules come after the plain ones they override', () => {
      const flat = css.replace(/\/\*[\s\S]*?\*\//g, '');
      const media = flat.indexOf('@media (max-width: 767.98px)');
      expect(media).toBeGreaterThan(flat.lastIndexOf('\n.attribution {'));
      expect(media).toBeGreaterThan(flat.lastIndexOf('\nbutton {'));
    });

    // QA lap 4 (second run): at 320 x 568 with the consent bar asking, the
    // strip above the sheet is shorter than the control, which was cut in
    // half over the sheet's handle.
    it('hides the control on a phone where the host says the sheet covers it', () => {
      const phone =
        css
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/\s+/g, ' ')
          .match(/@media \(max-width: 767\.98px\) \{(.*?\}) \}/)?.[1] ?? '';
      expect(phone).toMatch(
        /:host\(\.cramped\) button \{[^}]*visibility: hidden;/,
      );
    });

    // QA lap 4 (second run): a 2 px blurred glow left the lit pin's dark
    // rate on the dark ground; the interactive map draws a solid halo.
    it('rings the lit pin’s rate in a solid amber halo, as the interactive map does', () => {
      const lit = css.match(/\.pin\.lit\s*\{([^}]*)\}/)?.[1] ?? '';
      expect(lit).toMatch(/-webkit-text-stroke:\s*4px var\(--mf-amber\)/);
      expect(lit).toMatch(/paint-order:\s*stroke fill/);
      expect(lit).not.toMatch(/text-shadow:[^;]*2px var\(--mf-amber\)/);
    });

    it('gives the control at least the 44 px of a tap', () => {
      expect(css).toMatch(/button\s*\{[^}]*min-height:\s*var\(--mf-tap\)/);
    });

    it('pulses the marker only when the device allows motion', () => {
      expect(blocks.join('\n')).toMatch(/animation:\s*mf-ring 2\.2s/);
      expect(outside).not.toMatch(/animation:[^;]*mf-ring/);
    });

    it('keeps the corner clear of what covers the bottom of the map', () => {
      expect(css).toMatch(
        /\.corner\s*\{[^}]*bottom:\s*calc\(var\(--covered, 0px\)/,
      );
    });
  });
});
