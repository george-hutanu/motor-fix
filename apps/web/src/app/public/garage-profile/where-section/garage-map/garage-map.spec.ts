import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PLATFORM_ID, signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { I18n } from '@motor-fix/i18n';
import { REDUCED_MOTION } from '@motor-fix/ui-cockpit';

import { GARAGE_MAP, GarageMap } from './garage-map';
import type { MapFake } from '../../../place-step/place-step.testing';
import { boundsOf, fitView, paddingOf } from '../../../static-map/fit-view';
import { StaticMap } from '../../../static-map/static-map';

jest.mock('maplibre-gl', () =>
  jest.requireActual('../../../place-step/place-step.testing'),
);

const POINT = { lat: 44.4352671, lng: 26.0123456 };
const BOX = { h: 200, w: 390 };

let opened: (value: { destroy(): void }) => void;
let refused: (error: unknown) => void;
const destroy = jest.fn();
const open = jest.fn(
  (
    _host: HTMLElement,
    _pin: HTMLElement,
    _start: { center: [number, number]; zoom: number },
  ) =>
    new Promise<{ destroy(): void }>((resolve, reject) => {
      opened = resolve;
      refused = reject;
    }),
);
const gone = jest.fn();

let fixture: ComponentFixture<GarageMap>;
const element = () => fixture.nativeElement as HTMLElement;
const still = () => element().querySelector('mf-static-map');
const piece = () =>
  fixture.debugElement.query(By.directive(StaticMap))
    ?.componentInstance as StaticMap;

async function render({ platform = 'browser', reduced = false } = {}) {
  TestBed.configureTestingModule({
    providers: [
      { provide: GARAGE_MAP, useValue: open },
      { provide: PLATFORM_ID, useValue: platform },
      { provide: REDUCED_MOTION, useValue: signal(reduced) },
    ],
  });
  await TestBed.inject(I18n).enter('public');
  fixture = TestBed.createComponent(GarageMap);
  fixture.componentRef.setInput('point', POINT);
  fixture.componentInstance.gone.subscribe(gone);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
}

function tap() {
  element().querySelector<HTMLElement>('mf-static-map button')?.click();
  fixture.detectChanges();
}

async function load() {
  opened({ destroy });
  await fixture.whenStable();
  fixture.detectChanges();
}

beforeEach(() => {
  open.mockClear();
  destroy.mockClear();
  gone.mockClear();
  jest
    .spyOn(HTMLElement.prototype, 'clientWidth', 'get')
    .mockReturnValue(BOX.w);
  jest
    .spyOn(HTMLElement.prototype, 'clientHeight', 'get')
    .mockReturnValue(BOX.h);
});

afterEach(() => jest.restoreAllMocks());

// @traces 1366-FR-001
// @traces 1366-FR-002
// @traces 1366-FR-013
describe('GarageMap, the static map of one garage', () => {
  it('asks for the image at zoom 15 at the snapped centre of the garage', async () => {
    await render();
    const { center, zoom } = fitView(boundsOf([POINT]), BOX, paddingOf());

    expect(zoom).toBe(15);
    expect(still()?.querySelector('img')?.getAttribute('src')).toContain(
      `z=15&lat=${center.lat}&lng=${center.lng}`,
    );
  });

  it('marks the garage at its own point, with no rate and no lit pin', async () => {
    await render();

    expect(piece().place()).toEqual(POINT);
    expect(piece().pins()).toBeUndefined();
    expect(piece().lit()).toBeUndefined();
    expect(element().querySelectorAll('.overlay .here')).toHaveLength(1);
    expect(element().querySelector('.overlay .pin')).toBeNull();
  });

  it('loads no interactive map before it is asked for', async () => {
    await render();

    expect(open).not.toHaveBeenCalled();
  });

  it('renders no image on the server', async () => {
    await render({ platform: 'server' });

    expect(still()?.querySelector('img')).toBeNull();
    expect(open).not.toHaveBeenCalled();
  });
});

// @traces 1366-FR-003
describe('GarageMap, its box', () => {
  it('keeps the canvas and the pin away from assistive technology', async () => {
    await render();

    expect(
      element().querySelector('.canvas')?.getAttribute('aria-hidden'),
    ).toBe('true');
    expect(element().querySelector('.pin')?.getAttribute('aria-hidden')).toBe(
      'true',
    );
    expect(element().querySelectorAll('button')).toHaveLength(1);
  });

  it('is a strip 200 px tall that clips what it holds', () => {
    const css = readFileSync(join(__dirname, 'garage-map.css'), 'utf8');
    const host = css.match(/:host\s*\{([^}]*)\}/)?.[1] ?? '';

    expect(host).toMatch(/height:\s*200px/);
    expect(host).toMatch(/overflow:\s*hidden/);
    expect(host).toMatch(/position:\s*relative/);
  });
});

// @traces 1366-FR-005
// @traces 1366-FR-013
describe('GarageMap, the interactive map', () => {
  it('opens it once, in the same box, at the static view', async () => {
    await render();
    const { center, zoom } = fitView(boundsOf([POINT]), BOX, paddingOf());
    tap();

    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith(
      element().querySelector('.canvas'),
      element().querySelector('.pin'),
      { center: [center.lng, center.lat], zoom },
    );
  });

  it('opens it from a tap anywhere on the static map', async () => {
    await render();
    (still() as HTMLElement).click();

    expect(open).toHaveBeenCalledTimes(1);
  });

  it('does nothing on a second ask while it loads', async () => {
    await render();
    tap();
    tap();
    (still() as HTMLElement).click();

    expect(open).toHaveBeenCalledTimes(1);
  });

  it('fades the static map out once loaded, its control out of reach at once, then removes it', async () => {
    await render();
    tap();
    await load();

    expect(still()?.classList.contains('leaving')).toBe(true);
    expect(still()?.hasAttribute('inert')).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 250));
    fixture.detectChanges();

    expect(still()).toBeNull();
    expect(gone).not.toHaveBeenCalled();
  });

  it('swaps at once under reduced motion', async () => {
    await render({ reduced: true });
    tap();
    await load();
    await new Promise((resolve) => setTimeout(resolve));
    fixture.detectChanges();

    expect(still()).toBeNull();
  });

  it('closes the map with the page', async () => {
    await render();
    tap();
    await load();
    fixture.destroy();

    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('closes a map that opens after the page has gone', async () => {
    await render();
    tap();
    fixture.destroy();
    opened({ destroy });
    await Promise.resolve();

    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('fades by its stylesheet only when motion is allowed', () => {
    const css = readFileSync(join(__dirname, 'garage-map.css'), 'utf8');

    expect(css).toMatch(
      /mf-static-map\.leaving\s*\{[^}]*opacity:\s*0;[^}]*pointer-events:\s*none/,
    );
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: no-preference\)\s*\{\s*mf-static-map\s*\{[^}]*transition:[^}]*200ms/,
    );
  });
});

// @traces 1366-FR-006
// @traces 1366-FR-013
describe('GarageMap, when it cannot show', () => {
  it('says it is gone once when the image fails', async () => {
    await render();
    piece().failed.emit();
    fixture.detectChanges();

    expect(gone).toHaveBeenCalledTimes(1);
  });

  it('says it is gone once when the interactive map fails to load', async () => {
    await render();
    tap();
    refused(new Error('style'));
    await fixture.whenStable();
    await Promise.resolve();

    expect(gone).toHaveBeenCalledTimes(1);
    expect(destroy).not.toHaveBeenCalled();
  });
});

// @traces 1366-FR-004
// @traces 1366-FR-005
describe('GARAGE_MAP, the opener', () => {
  const { fake } = jest.requireMock<MapFake>('maplibre-gl');

  it('opens MapLibre at the view with cooperative gestures and one marker on the pin', async () => {
    const host = document.createElement('div');
    const pin = document.createElement('div');
    document.body.append(host);
    const { Marker } = jest.requireMock<{
      Marker: { prototype: { setLngLat(at: unknown): unknown } };
    }>('maplibre-gl');
    const at = jest.spyOn(Marker.prototype, 'setLngLat');

    const map = await TestBed.inject(GARAGE_MAP)(host, pin, {
      center: [POINT.lng, POINT.lat],
      zoom: 15,
    });

    expect(fake.map.options).toMatchObject({
      center: [POINT.lng, POINT.lat],
      container: host,
      cooperativeGestures: true,
      zoom: 15,
    });
    expect(fake.marker.options).toEqual({ element: pin });
    expect(at).toHaveBeenCalledTimes(1);
    map.destroy();
    expect(fake.map.remove).toHaveBeenCalled();
    host.remove();
  });

  it('leaves no map and no watcher behind when the marker cannot be added', async () => {
    const { Marker } = jest.requireMock<{
      Marker: { prototype: { addTo(): unknown } };
    }>('maplibre-gl');
    jest.spyOn(Marker.prototype, 'addTo').mockImplementationOnce(() => {
      throw new Error('marker');
    });
    const host = document.createElement('div');
    document.body.append(host);

    await expect(
      TestBed.inject(GARAGE_MAP)(host, document.createElement('div'), {
        center: [POINT.lng, POINT.lat],
        zoom: 15,
      }),
    ).rejects.toThrow('marker');
    const canvas = document.createElement('canvas');
    canvas.tabIndex = 0;
    host.append(canvas);
    await Promise.resolve();

    expect(fake.map.remove).toHaveBeenCalled();
    expect(canvas.getAttribute('tabindex')).toBe('0');
    host.remove();
  });
});
