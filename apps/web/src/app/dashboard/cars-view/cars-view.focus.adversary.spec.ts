import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { type CarDto, CarsService } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';

import { CarsView } from './cars-view';

const car = (id: string): CarDto => ({
  brandId: 'bmw',
  brandName: 'BMW',
  createdAt: '2026-10-07T09:00:00.000Z',
  engine: null,
  fuel: 'diesel',
  id,
  itpUntil: null,
  model: '320d',
  odometerKm: 148200,
  plate: null,
  rcaUntil: null,
  rovinietaUntil: null,
  year: 2019,
});

let scrolled: jest.Mock;
let list: jest.Mock;

async function open(url: string, answer: () => Promise<unknown>) {
  scrolled = jest.fn();
  Element.prototype.scrollIntoView = scrolled;
  list = jest.fn(answer);
  TestBed.configureTestingModule({
    providers: [
      { provide: CarsService, useValue: { carsControllerList: list } },
      { provide: Overlays, useValue: { open: jest.fn() } },
      provideRouter([
        { children: [{ component: CarsView, path: '**' }], path: 'cars' },
      ]),
    ],
  });
  await TestBed.inject(I18n).enter('driver');
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(url);
  return harness;
}

async function settled(harness: RouterTestingHarness) {
  for (let i = 0; i < 6; i++) {
    harness.detectChanges();
    await harness.fixture.whenStable();
    await new Promise((r) => setTimeout(r));
  }
}

const focused = () =>
  (document.activeElement as HTMLElement | null)?.getAttribute('data-car');

afterEach(() => {
  (document.activeElement as HTMLElement | null)?.blur();
  TestBed.resetTestingModule();
});

describe('Mașinile mele opened at a car, hostile addresses', () => {
  // @traces 032-FR-004
  it('focuses the card once the list that was still loading arrives', async () => {
    let release: (v: unknown) => void = () => undefined;
    const harness = await open(
      '/cars/c2',
      () => new Promise((r) => (release = r)),
    );
    await settled(harness);
    expect(focused()).toBeNull();

    release({ items: [car('c1'), car('c2')] });
    await settled(harness);

    expect(focused()).toBe('c2');
    expect(scrolled).toHaveBeenCalledTimes(1);
  });

  // @traces 032-FR-004
  it('focuses nothing and shows no error when the list fails to load', async () => {
    const harness = await open('/cars/c2', () =>
      Promise.reject(new Error('x')),
    );
    await settled(harness);

    expect(focused()).toBeNull();
    expect(scrolled).not.toHaveBeenCalled();
  });

  // @traces 032-FR-004
  it('focuses nothing for an address with a trailing slash and no id', async () => {
    const harness = await open('/cars/', async () => ({ items: [car('c1')] }));
    await settled(harness);

    expect(focused()).toBeNull();
    expect(scrolled).not.toHaveBeenCalled();
  });

  // @traces 032-FR-004
  it('does not match an id that is only a prefix of a card id', async () => {
    const harness = await open('/cars/c', async () => ({
      items: [car('c1'), car('c2')],
    }));
    await settled(harness);

    expect(focused()).toBeNull();
  });

  // @traces 032-FR-004
  it('does not treat a selector-like id as a pattern', async () => {
    const harness = await open(
      `/cars/${encodeURIComponent('"],[data-car')}`,
      async () => ({ items: [car('c1')] }),
    );
    await settled(harness);

    expect(focused()).toBeNull();
    expect(scrolled).not.toHaveBeenCalled();
  });

  // @traces 032-FR-004
  it('focuses a card whose id needs url encoding', async () => {
    const harness = await open('/cars/a%20b', async () => ({
      items: [car('a b')],
    }));
    await settled(harness);

    expect(focused()).toBe('a b');
  });

  // @traces 032-FR-004
  it('focuses the same card again when the address leaves and returns', async () => {
    const harness = await open('/cars/c1', async () => ({
      items: [car('c1'), car('c2')],
    }));
    await settled(harness);
    await harness.navigateByUrl('/cars/c2');
    await settled(harness);
    await harness.navigateByUrl('/cars/c1');
    await settled(harness);

    expect(focused()).toBe('c1');
    expect(scrolled).toHaveBeenCalledTimes(3);
  });
});
