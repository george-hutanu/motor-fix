import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { type CarDto, CarsService } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';

import { CarsView } from './cars-view';
import { AddCar } from '../add-car/add-car';

const car = (over: Partial<CarDto> = {}): CarDto => ({
  brandId: 'bmw',
  brandName: 'BMW',
  createdAt: '2026-10-07T09:00:00.000Z',
  engine: null,
  fuel: 'diesel',
  id: 'car-1',
  itpUntil: null,
  model: '320d',
  odometerKm: 148200,
  plate: null,
  rcaUntil: null,
  rovinietaUntil: null,
  year: 2019,
  ...over,
});

let list: jest.Mock;
let open: jest.Mock;

async function render(
  answer: CarDto[] | Promise<never> = [car()],
  language: 'ro' | 'en' = 'ro',
) {
  list = jest.fn(() =>
    answer instanceof Promise ? answer : Promise.resolve({ items: answer }),
  );
  open = jest.fn(async () => 'cancelled');
  TestBed.configureTestingModule({
    providers: [
      { provide: CarsService, useValue: { carsControllerList: list } },
      { provide: Overlays, useValue: { open } },
      provideRouter([]),
    ],
  });
  await TestBed.inject(I18n).enter('driver');
  if (language === 'en') await TestBed.inject(I18n).use('en');
  const fixture = TestBed.createComponent(CarsView);
  const element = fixture.nativeElement as HTMLElement;
  const settle = async () => {
    for (let i = 0; i < 3; i++) {
      fixture.detectChanges();
      await fixture.whenStable();
    }
  };
  return { element, fixture, settle };
}

const text = (element: HTMLElement) =>
  (element.textContent ?? '').replace(/\s+/g, ' ').trim();
const button = (element: HTMLElement, name: string) =>
  [...element.querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === name,
  );
const cards = (element: HTMLElement) => [
  ...element.querySelectorAll<HTMLElement>('[data-car]'),
];
const itp = (card: HTMLElement) => {
  const lamp = card.querySelector<HTMLElement>('mf-due-date-line mf-lamp');
  return {
    link: card.querySelector('mf-due-date-line a'),
    state: lamp?.getAttribute('data-state'),
    text: (lamp?.textContent ?? '').replace(/\s+/g, ' ').trim(),
  };
};
const lines = (card: HTMLElement) =>
  [...card.querySelectorAll<HTMLElement>('p')].map((p) =>
    (p.textContent ?? '').replace(/\s+/g, ' ').trim(),
  );

describe('Mașinile mele', () => {
  // Only Date is faked: Angular's stability checks still need real timers.
  beforeEach(() =>
    jest.useFakeTimers({
      doNotFake: [
        'nextTick',
        'setImmediate',
        'clearImmediate',
        'setTimeout',
        'clearTimeout',
        'setInterval',
        'clearInterval',
        'queueMicrotask',
        'requestAnimationFrame',
        'cancelAnimationFrame',
        'requestIdleCallback',
        'cancelIdleCallback',
        'hrtime',
        'performance',
      ],
      now: new Date('2026-10-08T09:00:00Z'),
    }),
  );
  afterEach(() => jest.useRealTimers());

  it('reads the cars once and shows a card per car with its name and its year and kilometres', async () => {
    const { element, settle } = await render();
    await settle();

    expect(list).toHaveBeenCalledTimes(1);
    expect(button(element, 'Adaugă o mașină')).toBeDefined();
    expect(cards(element)).toHaveLength(1);
    expect(lines(cards(element)[0]).slice(0, 2)).toEqual([
      'BMW 320d',
      '2019 · 148.200 km',
    ]);
  });

  it('writes the kilometres the English way in English', async () => {
    const { element, settle } = await render([car()], 'en');
    await settle();

    expect(button(element, 'Add a car')).toBeDefined();
    expect(lines(cards(element)[0])[1]).toBe('2019 · 148,200 km');
  });

  it('asks for the ITP date on a grey lamp when the car has none', async () => {
    const { element, settle } = await render();
    await settle();

    expect(itp(cards(element)[0])).toEqual({
      link: null,
      state: 'grey',
      text: 'ITP: adaugă data din talon',
    });
  });

  it('shows how long the ITP has left on a lamp', async () => {
    const { element, settle } = await render([car({ itpUntil: '2026-11-13' })]);
    await settle();

    expect(itp(cards(element)[0])).toMatchObject({
      state: 'amber',
      text: 'ITP‑ul expiră în 36 de zile',
    });
  });

  it('shows the ITP line in English', async () => {
    const { element, settle } = await render(
      [car({ itpUntil: '2027-11-13' })],
      'en',
    );
    await settle();

    expect(itp(cards(element)[0])).toMatchObject({
      state: 'green',
      text: 'ITP valid until November 2027',
    });
  });

  it('sends a car whose ITP has passed to the garages for its brand', async () => {
    const { element, settle } = await render([car({ itpUntil: '2026-10-01' })]);
    await settle();

    const line = itp(cards(element)[0]);
    expect(line.state).toBe('red');
    expect(line.link?.textContent?.trim()).toBe('Caută un service');
    expect(line.link?.getAttribute('href')).toBe('/ro/garages?brand=bmw');
    expect(line.link?.getAttribute('aria-label')).toBe(
      'Caută un service pentru BMW 320d',
    );
  });

  it('sends a passed ITP to the English garages in English', async () => {
    const { element, settle } = await render(
      [
        car({
          brandId: 'dacia',
          brandName: 'Dacia',
          itpUntil: '2026-10-01',
          model: 'Logan',
        }),
      ],
      'en',
    );
    await settle();

    const line = itp(cards(element)[0]);
    expect(line.link?.textContent?.trim()).toBe('Find a garage');
    expect(line.link?.getAttribute('href')).toBe('/en/garages?brand=dacia');
    expect(line.link?.getAttribute('aria-label')).toBe(
      'Find a garage for Dacia Logan',
    );
  });

  it('gives a car still in date no garage link', async () => {
    const { element, settle } = await render([car({ itpUntil: '2026-11-13' })]);
    await settle();

    expect(itp(cards(element)[0])).toMatchObject({
      link: null,
      state: 'amber',
    });
  });

  it('shows the plate grouped, and no plate line without one', async () => {
    const { element, settle } = await render([
      car({ id: 'car-2', plate: 'B123ABC' }),
      car(),
    ]);
    await settle();

    expect(lines(cards(element)[0])[2]).toBe('B 123 ABC');
    expect(lines(cards(element)[1])).toHaveLength(2);
  });

  // @traces 030-FR-009
  it('invites a driver with no car to add one, in the shared empty state', async () => {
    const { element, settle } = await render([]);
    await settle();

    const empty = element.querySelector('mf-empty-state');
    expect(text(empty as HTMLElement)).toContain(
      'Adaugă prima ta mașină. O folosim ca să‑ți arătăm service‑urile potrivite și să‑ți amintim de ITP.',
    );
    expect(empty?.querySelector('svg[data-icon="car"]')).not.toBeNull();
    expect(button(empty as HTMLElement, 'Adaugă o mașină')).toBeDefined();
    expect(text(element)).not.toContain('Nimic aici încă.');
    expect(cards(element)).toHaveLength(0);
    expect(
      [...element.querySelectorAll('button')].filter(
        (b) => text(b) === 'Adaugă o mașină',
      ),
    ).toHaveLength(1);
  });

  // @traces 030-FR-009
  it('says it in English for an English reader', async () => {
    const { element, settle } = await render([], 'en');
    await settle();

    expect(
      text(element.querySelector('mf-empty-state') as HTMLElement),
    ).toContain(
      'Add your first car. We use it to show you the right garages and to remind you about the ITP.',
    );
  });

  // @traces 030-FR-008
  it('leaves the empty state once a car is saved, without reading again', async () => {
    const { element, settle } = await render([]);
    await settle();
    open.mockResolvedValueOnce(car());

    button(element, 'Adaugă o mașină')?.click();
    // The dialog's code loads on the first tap, then the saved car shows.
    await settle();
    await settle();

    expect(element.querySelector('mf-empty-state')).toBeNull();
    expect(cards(element)).toHaveLength(1);
    expect(list).toHaveBeenCalledTimes(1);
  });

  it('opens the dialog with the plates already held and puts the saved car first without reading again', async () => {
    const { element, settle } = await render([
      car({ id: 'car-1', plate: 'CJ12ABC' }),
    ]);
    await settle();
    open.mockResolvedValueOnce(
      car({
        brandName: 'Dacia',
        id: 'car-2',
        itpUntil: '2026-10-10',
        model: 'Logan',
      }),
    );

    button(element, 'Adaugă o mașină')?.click();
    // The dialog's code loads on the first tap, then the saved car shows.
    await settle();
    await settle();

    expect(open).toHaveBeenCalledWith(AddCar, {
      data: { plates: ['CJ12ABC'] },
      shape: 'dialog',
      title: 'driver.cars.add.title',
    });
    expect(lines(cards(element)[0])[0]).toBe('Dacia Logan');
    expect(itp(cards(element)[0]).text).toBe('ITP‑ul expiră în 2 zile');
    expect(cards(element)).toHaveLength(2);
    expect(list).toHaveBeenCalledTimes(1);
  });

  it('leaves the list as it was when the dialog is cancelled', async () => {
    const { element, settle } = await render();
    await settle();

    button(element, 'Adaugă o mașină')?.click();
    await settle();

    expect(cards(element)).toHaveLength(1);
  });

  it('shows placeholders and no card while the cars load', async () => {
    const { element, fixture, settle } = await render();
    let resolve: (value: { items: CarDto[] }) => void = () => undefined;
    list.mockReturnValueOnce(
      new Promise((r) => {
        resolve = r;
      }),
    );
    fixture.detectChanges();

    expect(
      element.querySelectorAll('[aria-hidden="true"].skeleton').length,
    ).toBeGreaterThan(0);
    expect(cards(element)).toHaveLength(0);

    resolve({ items: [car()] });
    await settle();
    expect(element.querySelectorAll('.skeleton')).toHaveLength(0);
    expect(cards(element)).toHaveLength(1);
  });

  it('offers to try again when the cars cannot be read, and reads again', async () => {
    const { element, settle } = await render(Promise.reject(new Error('down')));
    await settle();

    expect(text(element)).toContain('Ceva nu a mers. Încearcă din nou.');
    list.mockResolvedValueOnce({ items: [car()] });
    button(element, 'Reîncearcă')?.click();
    await settle();

    expect(list).toHaveBeenCalledTimes(2);
    expect(cards(element)).toHaveLength(1);
    expect(text(element)).not.toContain('Ceva nu a mers.');
  });
});

describe('Mașinile mele opened at a car', () => {
  let scrolled: jest.Mock;

  async function open(url: string, items = [car(), car({ id: 'car-2' })]) {
    scrolled = jest.fn();
    Element.prototype.scrollIntoView = scrolled;
    TestBed.configureTestingModule({
      providers: [
        {
          provide: CarsService,
          useValue: { carsControllerList: async () => ({ items }) },
        },
        { provide: Overlays, useValue: { open: jest.fn() } },
        provideRouter([
          { children: [{ component: CarsView, path: '**' }], path: 'cars' },
        ]),
      ],
    });
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url);
    await settled(harness);
    return harness;
  }

  async function settled(harness: RouterTestingHarness) {
    for (let i = 0; i < 4; i++) {
      harness.detectChanges();
      await harness.fixture.whenStable();
    }
  }

  const focused = () =>
    (document.activeElement as HTMLElement | null)?.getAttribute('data-car');

  // @traces 032-notifications-bell-FR-004
  it('scrolls the car named in the address into view and focuses its card', async () => {
    await open('/cars/car-2');

    expect(focused()).toBe('car-2');
    expect(scrolled).toHaveBeenCalledTimes(1);
    expect(scrolled.mock.contexts[0]).toBe(document.activeElement);
  });

  // @traces 032-notifications-bell-FR-004
  it('moves to another car when the address names another', async () => {
    const harness = await open('/cars/car-2');

    await harness.navigateByUrl('/cars/car-1');
    await settled(harness);

    expect(focused()).toBe('car-1');
  });

  // @traces 032-notifications-bell-FR-004 032-notifications-bell-FR-005
  it('opens at the top with nothing focused for a car no longer listed', async () => {
    const harness = await open('/cars/removed');

    expect(focused()).toBeNull();
    expect(scrolled).not.toHaveBeenCalled();
    expect(harness.routeNativeElement?.textContent).not.toContain(
      'Ceva nu a mers.',
    );
  });

  // @traces 032-notifications-bell-FR-004
  it('focuses nothing on the bare view address', async () => {
    await open('/cars');

    expect(focused()).toBeNull();
    expect(scrolled).not.toHaveBeenCalled();
  });
});
