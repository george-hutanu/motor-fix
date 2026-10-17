import { PLATFORM_ID } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import type { GaragePinsDto } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';

import type { MapEvents } from './pins-map';
import { RESULTS_MAP, ResultsMap, type ResultsMapView } from './results-map';

const PINS: GaragePinsDto = {
  pins: [
    { id: 'g-1', lat: 44.44, lng: 26.12, rateLei: 150, stance: 'works_on' },
    { id: 'g-2', lat: 44.5, lng: 26.2, rateLei: null, stance: 'does_not_take' },
  ],
  total: 2,
};
const BRAND = { id: 'b-1', name: 'BMW', slug: 'bmw' };

let view: jest.Mocked<ResultsMapView>;
let opened: (value: ResultsMapView) => void;
const open = jest.fn(
  (_host: HTMLElement, _on: MapEvents) =>
    new Promise<ResultsMapView>((resolve) => {
      opened = resolve;
    }),
);
let fixture: ComponentFixture<ResultsMap>;

async function render(platform = 'browser') {
  TestBed.configureTestingModule({
    providers: [
      { provide: RESULTS_MAP, useValue: open },
      { provide: PLATFORM_ID, useValue: platform },
    ],
  });
  await TestBed.inject(I18n).enter('public');
  fixture = TestBed.createComponent(ResultsMap);
  fixture.componentRef.setInput('brand', 'BMW');
  fixture.componentRef.setInput('place', { lat: 44.437, lng: 26.117 });
  fixture.componentRef.setInput('pins', undefined);
  fixture.detectChanges();
  await fixture.whenStable();
}

const ready = async () => {
  opened(view);
  await fixture.whenStable();
  fixture.detectChanges();
};
const element = () => fixture.nativeElement as HTMLElement;
const card = () => element().querySelector<HTMLElement>('mf-map-card');

beforeEach(() => {
  open.mockClear();
  view = {
    destroy: jest.fn(),
    fit: jest.fn(),
    light: jest.fn(),
    show: jest.fn(),
    spot: jest.fn((_at: { lat: number; lng: number }) => ({ x: 120, y: 80 })),
  };
});

// @traces 270-FR-010
describe('the results map, under attack', () => {
  it('opens no small card without the brand to link with', async () => {
    await render();
    await ready();

    fixture.componentRef.setInput('card', { pin: PINS.pins[0] });
    fixture.detectChanges();

    expect(card()).toBeNull();
  });

  it('moves the small card to the next pin when the page swaps the pin', async () => {
    await render();
    await ready();
    fixture.componentRef.setInput('cardBrand', BRAND);
    fixture.componentRef.setInput('card', { pin: PINS.pins[0] });
    fixture.detectChanges();

    fixture.componentRef.setInput('card', { pin: PINS.pins[1] });
    fixture.detectChanges();

    expect(view.spot).toHaveBeenLastCalledWith({ lat: 44.5, lng: 26.2 });
    expect(element().querySelectorAll('mf-map-card')).toHaveLength(1);
  });

  it('holds the small card inside the map when the pin sits far above the top edge', async () => {
    await render();
    await ready();
    view.spot.mockReturnValue({ x: 50, y: -400 });
    fixture.componentRef.setInput('cardBrand', BRAND);
    fixture.componentRef.setInput('card', { pin: PINS.pins[0] });
    fixture.detectChanges();

    expect(parseFloat(card()?.style.top ?? '-1')).toBeGreaterThanOrEqual(0);
  });

  it('closes the map it opened late once the component is gone', async () => {
    await render();
    fixture.destroy();

    opened(view);
    await Promise.resolve();
    await Promise.resolve();

    expect(view.destroy).toHaveBeenCalledTimes(1);
  });

  it('destroys the open map once, however often the component is destroyed', async () => {
    await render();
    await ready();

    fixture.destroy();
    fixture.destroy();

    expect(view.destroy).toHaveBeenCalledTimes(1);
  });

  it('opens no map and no small card on the server', async () => {
    await render('server');
    fixture.componentRef.setInput('lit', 'g-1');
    fixture.componentRef.setInput('cardBrand', BRAND);
    fixture.componentRef.setInput('card', { pin: PINS.pins[0] });
    fixture.detectChanges();

    expect(open).not.toHaveBeenCalled();
    expect(card()).toBeNull();
  });

  it('lights the garage given before the map opened as soon as it opens', async () => {
    await render();
    fixture.componentRef.setInput('lit', 'g-2');
    fixture.componentRef.setInput('pins', PINS);
    fixture.detectChanges();

    await ready();

    expect(view.light).toHaveBeenLastCalledWith('g-2');
  });
});
