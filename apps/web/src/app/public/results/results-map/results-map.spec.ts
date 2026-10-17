import { PLATFORM_ID } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import type { GaragePinsDto } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';

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
const open = jest.fn(
  (_host: HTMLElement) =>
    new Promise<ResultsMapView>((resolve, reject) => {
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
  view = { destroy: jest.fn(), fit: jest.fn(), show: jest.fn() };
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

  it('keeps the map canvas out of the keyboard order and away from assistive technology', async () => {
    await render();
    const host = element().querySelector('.canvas');

    expect(host?.hasAttribute('inert')).toBe(true);
    expect(host?.getAttribute('aria-hidden')).toBe('true');
    expect(open).toHaveBeenCalledWith(host);
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
