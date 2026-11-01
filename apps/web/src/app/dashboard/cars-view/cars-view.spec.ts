import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import {
  type CarDto,
  CarsService,
  type SoldCarListDto,
} from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';

import { CancelTransfer } from './cancel-transfer/cancel-transfer';
import { CarsView } from './cars-view';
import { SellCar } from './sell-car/sell-car';
import { AddCar } from '../add-car/add-car';
import type { fakeLive } from '../garage-requests/garage-requests.testing';
import { Live } from '../live';
import { RemoveCar } from '../remove-car/remove-car';
import { heldForDriver } from '../resources/resources.testing';

const car = (over: Partial<CarDto> = {}): CarDto => ({
  brandId: 'bmw',
  brandName: 'BMW',
  createdAt: '2026-10-07T09:00:00.000Z',
  engine: null,
  fuel: 'diesel',
  id: 'car-1',
  itpUntil: null,
  model: '320d',
  nextServiceKm: null,
  odometerKm: 148200,
  plate: null,
  rcaUntil: null,
  rovinietaUntil: null,
  serviceDueOn: null,
  transfer: null,
  updatedAt: '2026-10-07T09:00:00.000Z',
  year: 2019,
  ...over,
});

let list: jest.Mock;
let open: jest.Mock;
let soldList: jest.Mock;
let soldAnswer: () => Promise<SoldCarListDto> = async () => ({ items: [] });

async function render(
  answer: CarDto[] | Promise<never> = [car()],
  language: 'ro' | 'en' = 'ro',
) {
  list = jest.fn(() =>
    answer instanceof Promise ? answer : Promise.resolve({ items: answer }),
  );
  open = jest.fn(async () => 'cancelled');
  soldList = jest.fn(() => soldAnswer());
  TestBed.configureTestingModule({
    providers: [
      {
        provide: CarsService,
        useValue: {
          carHistoryControllerSold: soldList,
          carHistoryControllerSoldRepairs: async () => ({ items: [] }),
          carsControllerList: list,
        },
      },
      { provide: Overlays, useValue: { open } },
      provideRouter([]),
      ...heldForDriver(),
    ],
  });
  await TestBed.inject(I18n).enter('driver');
  if (language === 'en') await TestBed.inject(I18n).use('en');
  return { ...view(), view };
}

// A Mașinile mele built in the module render() set up, as on a return.
function view() {
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

  // @traces 1386-FR-005
  it('shows the oil line of a car added with a next service at once', async () => {
    const { element, settle } = await render([]);
    await settle();
    open.mockResolvedValueOnce(
      car({ nextServiceKm: 152000, serviceDueOn: '2027-01-01' }),
    );

    button(element, 'Adaugă o mașină')?.click();
    await settle();
    await settle();

    const oil = cards(element)[0].querySelector<HTMLElement>(
      'mf-oil-line mf-lamp',
    );
    expect((oil?.textContent ?? '').replace(/\s+/g, ' ').trim()).toBe(
      'Schimb de ulei peste 3.800 km',
    );
    expect(oil?.getAttribute('data-state')).toBe('green');
    expect(list).toHaveBeenCalledTimes(1);
  });

  it('opens the dialog with the plates already held and puts the saved car first without reading again', async () => {
    const { element, settle } = await render([
      car({ id: 'car-1', plate: 'CJ12ABC' }),
      car({ id: 'car-0', plate: null }),
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
    expect(cards(element)).toHaveLength(3);
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
          useValue: {
            carHistoryControllerSold: async () => ({ items: [] }),
            carsControllerList: async () => ({ items }),
          },
        },
        { provide: Overlays, useValue: { open: jest.fn() } },
        ...heldForDriver(),
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

  // The card moves a macrotask after it draws, after the router's own scroll.
  async function settled(harness: RouterTestingHarness) {
    for (let i = 0; i < 4; i++) {
      harness.detectChanges();
      await harness.fixture.whenStable();
      await new Promise((r) => setTimeout(r));
    }
  }

  const focused = () =>
    (document.activeElement as HTMLElement | null)?.getAttribute('data-car');

  // @traces 032-FR-004
  it('scrolls the car named in the address into view and focuses its card', async () => {
    await open('/cars/car-2');

    expect(focused()).toBe('car-2');
    expect(scrolled).toHaveBeenCalledTimes(1);
    expect(scrolled.mock.contexts[0]).toBe(document.activeElement);
  });

  // @traces 032-FR-004
  it('moves to another car when the address names another', async () => {
    const harness = await open('/cars/car-2');

    await harness.navigateByUrl('/cars/car-1');
    await settled(harness);

    expect(focused()).toBe('car-1');
  });

  // @traces 032-FR-004 032-FR-005
  it('opens at the top with nothing focused for a car no longer listed', async () => {
    const harness = await open('/cars/removed');

    expect(focused()).toBeNull();
    expect(scrolled).not.toHaveBeenCalled();
    expect(harness.routeNativeElement?.textContent).not.toContain(
      'Ceva nu a mers.',
    );
  });

  // @traces 032-FR-004
  it('focuses nothing on the bare view address', async () => {
    await open('/cars');

    expect(focused()).toBeNull();
    expect(scrolled).not.toHaveBeenCalled();
  });
});

describe('a car card', () => {
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
  afterEach(() => {
    jest.useRealTimers();
    document.querySelectorAll('.cdk-overlay-container').forEach((n) => {
      n.innerHTML = '';
    });
  });

  const trigger = (card: HTMLElement) =>
    card.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]');
  const items = () => [
    ...document.querySelectorAll<HTMLButtonElement>(
      '[role="menu"] [role="menuitem"]',
    ),
  ];
  const sentences = (card: HTMLElement) =>
    [...card.querySelectorAll<HTMLElement>('mf-due-date-line mf-lamp')].map(
      (l) => (l.textContent ?? '').replace(/\s+/g, ' ').trim(),
    );
  const press = (target: HTMLElement, key: string) =>
    target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key }));

  // @traces 092-FR-009
  it('carries a menu button named after the car', async () => {
    const { element, settle } = await render();
    await settle();

    const more = trigger(cards(element)[0]);
    expect(more?.type).toBe('button');
    expect(more?.getAttribute('aria-label')).toBe('Acțiuni pentru BMW 320d');
    expect(more?.getAttribute('aria-expanded')).toBe('false');
  });

  // @traces 092-FR-009
  it('names the menu button in English', async () => {
    const { element, settle } = await render([car()], 'en');
    await settle();

    expect(trigger(cards(element)[0])?.getAttribute('aria-label')).toBe(
      'Actions for BMW 320d',
    );
  });

  // @traces 092-FR-009
  it('offers Modifică and Șterge mașina, with the focus on the first', async () => {
    const { element, settle } = await render();
    await settle();

    trigger(cards(element)[0])?.click();
    await settle();

    expect(trigger(cards(element)[0])?.getAttribute('aria-expanded')).toBe(
      'true',
    );
    expect(items().map((i) => i.textContent?.trim())).toEqual([
      'Modifică',
      'Șterge mașina',
      'Am vândut mașina',
    ]);
    expect(items().every((i) => i.type === 'button')).toBe(true);
    expect(document.activeElement).toBe(items()[0]);
  });

  // @traces 092-FR-009
  it('offers Edit and Remove the car in English', async () => {
    const { element, settle } = await render([car()], 'en');
    await settle();

    trigger(cards(element)[0])?.click();
    await settle();

    expect(items().map((i) => i.textContent?.trim())).toEqual([
      'Edit',
      'Remove the car',
      'I sold the car',
    ]);
  });

  // @traces 092-FR-009
  it('moves between the items with the arrows and closes with Escape', async () => {
    const { element, settle } = await render();
    await settle();
    trigger(cards(element)[0])?.click();
    await settle();

    press(items()[0], 'ArrowDown');
    expect(document.activeElement).toBe(items()[1]);
    press(items()[1], 'ArrowDown');
    expect(document.activeElement).toBe(items()[2]);
    press(items()[2], 'ArrowDown');
    expect(document.activeElement).toBe(items()[0]);
    press(items()[0], 'ArrowUp');
    expect(document.activeElement).toBe(items()[2]);
    press(items()[2], 'Escape');
    await settle();

    expect(trigger(cards(element)[0])?.getAttribute('aria-expanded')).toBe(
      'false',
    );
  });

  // @traces 092-FR-009
  it('gives the menu button and its items a 44 px target', () => {
    const css = readFileSync(join(__dirname, 'cars-view.css'), 'utf8');

    expect(css).toMatch(/\.more\s*\{[^}]*min-width:\s*44px/);
    expect(css).toMatch(/\.more\s*\{[^}]*min-height:\s*44px/);
    expect(css).toMatch(
      /\[role=["']menuitem["']\]\s*\{[^}]*min-height:\s*44px/,
    );
  });

  // @traces 092-FR-009
  it('shows the year and kilometres, the plate, then the ITP, RCA and rovinietă lines', async () => {
    const { element, settle } = await render([
      car({
        itpUntil: '2026-11-13',
        plate: 'B123ABC',
        rcaUntil: '2026-10-20',
        rovinietaUntil: '2027-12-08',
      }),
    ]);
    await settle();

    const card = cards(element)[0];
    expect(lines(card).slice(0, 3)).toEqual([
      'BMW 320d',
      '2019 · 148.200 km',
      'B 123 ABC',
    ]);
    expect(sentences(card)).toEqual([
      'ITP‑ul expiră în 36 de zile',
      'RCA‑ul expiră în 12 zile',
      'Rovinieta e valabilă până în decembrie 2027',
    ]);
    const plate = card.querySelectorAll('p')[2];
    const itpLine = card.querySelector('mf-due-date-line');
    expect(
      plate.compareDocumentPosition(itpLine as Node) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(card.querySelectorAll('mf-due-date-line a')).toHaveLength(0);
  });

  // @traces 029-FR-007
  it('shows the oil-service line after the rovinietă line when the car has a next service', async () => {
    const { element, settle } = await render([
      car({ itpUntil: '2026-11-13', nextServiceKm: 152000 }),
    ]);
    await settle();

    const card = cards(element)[0];
    const lamps = [...card.querySelectorAll<HTMLElement>('mf-lamp')];
    expect(lamps).toHaveLength(4);
    expect(lamps[3].closest('mf-oil-line')).not.toBeNull();
    expect((lamps[3].textContent ?? '').replace(/\s+/g, ' ').trim()).toBe(
      'Schimb de ulei peste 3.800 km',
    );
  });

  // @traces 1386-FR-004 1386-FR-007
  it('asks for the next oil service on a grey line after the rovinietă line', async () => {
    const { element, settle } = await render([car()]);
    await settle();

    const card = cards(element)[0];
    const lamps = [...card.querySelectorAll<HTMLElement>('mf-lamp')];
    expect(lamps).toHaveLength(4);
    expect(lamps[3].closest('mf-oil-line')).not.toBeNull();
    expect(lamps[3].getAttribute('data-state')).toBe('grey');
    expect(card.querySelector('mf-oil-line button')?.textContent?.trim()).toBe(
      'Schimb de ulei: adaugă kilometrajul',
    );
  });

  // @traces 1386-FR-004
  it('opens the edit dialog at the next oil service from its grey line, then shows the judged line', async () => {
    const { element, settle } = await render([
      car({ id: 'car-1', plate: 'CJ12ABC' }),
    ]);
    await settle();
    open.mockResolvedValueOnce(
      car({
        id: 'car-1',
        nextServiceKm: 152000,
        plate: 'CJ12ABC',
        serviceDueOn: '2027-01-01',
      }),
    );

    (
      cards(element)[0].querySelector('mf-oil-line button') as HTMLButtonElement
    ).click();
    await settle();
    await settle();

    expect(open).toHaveBeenCalledWith(AddCar, {
      data: {
        car: car({ id: 'car-1', plate: 'CJ12ABC' }),
        focus: 'nextServiceKm',
        gone: expect.any(Function),
        plates: ['CJ12ABC'],
      },
      shape: 'dialog',
      title: 'driver.cars.edit.title',
    });
    const oil = cards(element)[0].querySelector<HTMLElement>(
      'mf-oil-line mf-lamp',
    );
    expect(oil?.getAttribute('data-state')).toBe('green');
    expect((oil?.textContent ?? '').replace(/\s+/g, ' ').trim()).toBe(
      'Schimb de ulei peste 3.800 km',
    );
    expect(cards(element)[0].querySelector('mf-oil-line button')).toBeNull();
    expect(list).toHaveBeenCalledTimes(1);
  });

  // @traces 1386-FR-003 1386-FR-005
  it('judges the oil line by the estimated date and updates it from the edit answer', async () => {
    const { element, settle } = await render([
      car({
        id: 'car-1',
        nextServiceKm: 152000,
        serviceDueOn: '2027-01-01',
      }),
    ]);
    await settle();
    open.mockResolvedValueOnce(
      car({
        id: 'car-1',
        nextServiceKm: 152000,
        odometerKm: 150500,
        serviceDueOn: '2026-11-23',
      }),
    );

    trigger(cards(element)[0])?.click();
    await settle();
    items()[0].click();
    await settle();
    await settle();

    expect(lines(cards(element)[0])).toContain('2019 · 150.500 km');
    const oil = cards(element)[0].querySelector<HTMLElement>(
      'mf-oil-line mf-lamp',
    );
    expect(oil?.getAttribute('data-state')).toBe('amber');
    expect((oil?.textContent ?? '').replace(/\s+/g, ' ').trim()).toBe(
      'Schimb de ulei peste 1.500 km',
    );
    expect(list).toHaveBeenCalledTimes(1);
  });

  // @traces 029-FR-007
  it('shows no oil-service line for a cached car answered before the next service existed', async () => {
    const { nextServiceKm: _, ...cached } = car();
    const { element, settle } = await render([
      cached as ReturnType<typeof car>,
    ]);
    await settle();

    expect(cards(element)[0].querySelector('mf-oil-line')).toBeNull();
  });

  // @traces 092-FR-009
  it('asks for the three dates on grey lines in English', async () => {
    const { element, settle } = await render([car()], 'en');
    await settle();

    expect(sentences(cards(element)[0])).toEqual([
      'ITP: add the date from the registration',
      'RCA: add the date',
      'Rovinietă: add the date',
    ]);
  });

  // @traces 092-FR-009
  it('opens the edit dialog at the date a grey line asks for', async () => {
    const { element, settle } = await render([
      car({ id: 'car-1', plate: 'CJ12ABC' }),
    ]);
    await settle();

    const grey = [
      ...cards(element)[0].querySelectorAll('mf-due-date-line button'),
    ];
    expect(
      grey.map((b) => (b.textContent ?? '').replace(/\s+/g, ' ').trim()),
    ).toEqual([
      'ITP: adaugă data din talon',
      'RCA: adaugă data',
      'Rovinietă: adaugă data',
    ]);
    for (const [i, focus] of [
      'itpUntil',
      'rcaUntil',
      'rovinietaUntil',
    ].entries()) {
      (grey[i] as HTMLButtonElement).click();
      await settle();
      await settle();
      expect(open).toHaveBeenLastCalledWith(AddCar, {
        data: {
          car: car({ id: 'car-1', plate: 'CJ12ABC' }),
          focus,
          gone: expect.any(Function),
          plates: ['CJ12ABC'],
        },
        shape: 'dialog',
        title: 'driver.cars.edit.title',
      });
    }
  });

  // @traces 092-FR-010
  it('opens the edit dialog from Modifică and puts the answered car in place without reading again', async () => {
    const { element, settle } = await render([
      car({ id: 'car-2', model: 'X1' }),
      car({ id: 'car-1' }),
    ]);
    await settle();
    open.mockResolvedValueOnce(
      car({ id: 'car-1', itpUntil: '2027-11-13', model: '330d' }),
    );

    trigger(cards(element)[1])?.click();
    await settle();
    items()[0].click();
    await settle();
    await settle();

    expect(open).toHaveBeenCalledWith(AddCar, {
      data: {
        car: car({ id: 'car-1' }),
        gone: expect.any(Function),
        plates: [],
      },
      shape: 'dialog',
      title: 'driver.cars.edit.title',
    });
    expect(cards(element).map((c) => c.getAttribute('data-car'))).toEqual([
      'car-2',
      'car-1',
    ]);
    expect(lines(cards(element)[1])[0]).toBe('BMW 330d');
    expect(sentences(cards(element)[1])[0]).toBe(
      'ITP valabil până în noiembrie 2027',
    );
    expect(list).toHaveBeenCalledTimes(1);
  });

  // @traces 092-FR-010
  it('drops the card when the edit dialog finds the car removed meanwhile', async () => {
    const { element, settle } = await render([
      car({ id: 'car-2', model: 'X1' }),
      car({ id: 'car-1' }),
    ]);
    await settle();
    open.mockImplementationOnce(async (_, { data }) => {
      data.gone();
      return 'cancelled';
    });

    trigger(cards(element)[1])?.click();
    await settle();
    items()[0].click();
    await settle();
    await settle();

    expect(cards(element).map((c) => c.getAttribute('data-car'))).toEqual([
      'car-2',
    ]);
    expect(list).toHaveBeenCalledTimes(1);
  });

  // @traces 092-FR-010
  it('leaves the card as it was when the edit is cancelled', async () => {
    const { element, settle } = await render();
    await settle();

    trigger(cards(element)[0])?.click();
    await settle();
    items()[0].click();
    await settle();
    await settle();

    expect(lines(cards(element)[0])[0]).toBe('BMW 320d');
  });

  // @traces 092-FR-009
  it('shows the three lines of a car just added at once', async () => {
    const { element, settle } = await render([]);
    await settle();
    open.mockResolvedValueOnce(
      car({ rcaUntil: '2026-10-20', rovinietaUntil: null }),
    );

    button(element, 'Adaugă o mașină')?.click();
    await settle();
    await settle();

    expect(sentences(cards(element)[0])).toEqual([
      'ITP: adaugă data din talon',
      'RCA‑ul expiră în 12 zile',
      'Rovinietă: adaugă data',
    ]);
  });

  // @traces 092-FR-011
  it.each([
    [true, ['car-2']],
    ['cancelled', ['car-2', 'car-1']],
  ] as const)(
    'asks before removing from Șterge mașina; on %s the cards are %j without reading again',
    async (answer, left) => {
      const { element, settle } = await render([
        car({ id: 'car-2', model: 'X1' }),
        car({ id: 'car-1' }),
      ]);
      await settle();
      open.mockResolvedValueOnce(answer);

      trigger(cards(element)[1])?.click();
      await settle();
      items()[1].click();
      await settle();
      await settle();

      expect(open).toHaveBeenCalledWith(
        RemoveCar,
        expect.objectContaining({
          data: { car: car({ id: 'car-1' }) },
          shape: 'dialog',
        }),
      );
      expect(cards(element).map((c) => c.getAttribute('data-car'))).toEqual(
        left,
      );
      expect(list).toHaveBeenCalledTimes(1);
    },
  );

  // @traces 1316-FR-001 1316-FR-002
  it('shows the cars held at once when opened again, and reads again only past 5 minutes', async () => {
    const first = await render([car()]);
    await first.settle();
    first.fixture.destroy();

    const again = first.view();
    again.fixture.detectChanges();

    expect(cards(again.element)).toHaveLength(1);
    expect(again.element.querySelectorAll('.skeleton')).toHaveLength(0);
    await again.settle();
    expect(list).toHaveBeenCalledTimes(1);
    again.fixture.destroy();

    jest.setSystemTime(new Date('2026-10-08T09:05:00Z'));
    const past = first.view();
    past.fixture.detectChanges();

    expect(cards(past.element)).toHaveLength(1);
    await past.settle();
    expect(list).toHaveBeenCalledTimes(2);
  });

  // @traces 1316-FR-005 1316-FR-010
  it('shows a car added, edited and removed when opened again, with no read', async () => {
    const first = await render([
      car({ id: 'car-2', model: 'X1' }),
      car({ id: 'car-1' }),
    ]);
    await first.settle();
    const { element, settle } = first;

    open.mockResolvedValueOnce(car({ id: 'car-3', model: 'X3' }));
    button(element, 'Adaugă o mașină')?.click();
    await settle();
    await settle();
    open.mockResolvedValueOnce(car({ id: 'car-1', model: '330d' }));
    trigger(cards(element)[2])?.click();
    await settle();
    items()[0].click();
    await settle();
    await settle();
    open.mockResolvedValueOnce(true);
    trigger(cards(element)[1])?.click();
    await settle();
    items()[1].click();
    await settle();
    await settle();
    first.fixture.destroy();

    const again = first.view();
    again.fixture.detectChanges();

    expect(cards(again.element).map((c) => c.getAttribute('data-car'))).toEqual(
      ['car-3', 'car-1'],
    );
    expect(lines(cards(again.element)[1])[0]).toBe('BMW 330d');
    await again.settle();
    expect(list).toHaveBeenCalledTimes(1);
  });
});

describe('the car menu’s arrows', () => {
  async function menu(count: number) {
    const { fixture } = await render();
    const view = fixture.componentInstance as unknown as {
      moveIn(event: KeyboardEvent): void;
    };
    const root = document.createElement('div');
    const items = Array.from({ length: count }, () => {
      const item = document.createElement('button');
      item.setAttribute('role', 'menuitem');
      root.append(item);
      return item;
    });
    root.addEventListener('keydown', (e) => view.moveIn(e));
    document.body.append(root);
    const press = (key: string) => {
      const event = new KeyboardEvent('keydown', { cancelable: true, key });
      root.dispatchEvent(event);
      return event;
    };
    return { items, press, root };
  }

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('moves up and down one item at a time, wrapping at both ends', async () => {
    const { items, press } = await menu(3);
    items[1].focus();

    press('ArrowUp');
    expect(document.activeElement).toBe(items[0]);
    press('ArrowUp');
    expect(document.activeElement).toBe(items[2]);
    press('ArrowDown');
    expect(document.activeElement).toBe(items[0]);
    press('ArrowDown');
    expect(document.activeElement).toBe(items[1]);
  });

  it('keeps the page from scrolling on an arrow and leaves other keys alone', async () => {
    const { items, press } = await menu(3);
    items[1].focus();

    expect(press('ArrowDown').defaultPrevented).toBe(true);
    expect(press('Tab').defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(items[2]);
  });

  it('does nothing on an arrow in a menu with no items', async () => {
    const { press } = await menu(0);

    expect(() => press('ArrowDown')).not.toThrow();
  });
});

// @traces 1392-FR-001 1392-FR-004 1392-FR-007 1392-FR-009
describe('selling a car from its card', () => {
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
  afterEach(() => {
    jest.useRealTimers();
    document.querySelectorAll('.cdk-overlay-container').forEach((n) => {
      n.innerHTML = '';
    });
  });

  const sold = car({
    transfer: { expiresAt: '2026-10-15T09:00:00.000Z', id: 't-1' },
  });
  const trigger = (card: HTMLElement) =>
    card.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]');
  const sellItem = () =>
    [
      ...document.querySelectorAll<HTMLButtonElement>(
        '[role="menu"] [role="menuitem"]',
      ),
    ].at(2) as HTMLButtonElement;
  async function sell(element: HTMLElement, settle: () => Promise<void>) {
    trigger(cards(element)[0])?.click();
    await settle();
    sellItem().click();
    await settle();
    await settle();
  }

  it('opens the sale dialog from Am vândut mașina, titled with the car', async () => {
    const { element, settle } = await render();
    await settle();

    await sell(element, settle);

    expect(open).toHaveBeenCalledWith(
      SellCar,
      expect.objectContaining({
        data: { car: car() },
        shape: 'dialog',
        title: 'driver.cars.sale.title',
        titleParams: { car: 'BMW 320d' },
      }),
    );
  });

  it('runs the removal confirmation for the car when the history does not pass', async () => {
    const { element, settle } = await render();
    await settle();
    open.mockResolvedValueOnce('remove').mockResolvedValueOnce(true);

    await sell(element, settle);
    await settle();

    expect(open).toHaveBeenNthCalledWith(
      2,
      RemoveCar,
      expect.objectContaining({ data: { car: car() } }),
    );
    expect(cards(element)).toHaveLength(0);
  });

  it('reads the list again once a link is sent and shows the transfer line', async () => {
    const { element, settle } = await render();
    await settle();
    list.mockResolvedValueOnce({ items: [sold] });
    open.mockResolvedValueOnce('sent');

    await sell(element, settle);
    await settle();

    expect(list).toHaveBeenCalledTimes(2);
    expect(text(cards(element)[0])).toContain(
      'Transfer trimis · expiră pe 15 oct.',
    );
  });

  it('moves the focus to the card once the sent link takes its menu away', async () => {
    const { element, settle } = await render();
    await settle();
    list.mockResolvedValueOnce({ items: [sold] });
    open.mockResolvedValueOnce('sent');

    await sell(element, settle);
    await settle();

    expect(trigger(cards(element)[0])).toBeNull();
    expect(document.activeElement).toBe(cards(element)[0]);
  });

  it('moves the focus to the card once the cancel takes its button away', async () => {
    const { element, settle } = await render([sold]);
    await settle();
    list.mockResolvedValueOnce({ items: [car()] });
    open.mockResolvedValueOnce(true);

    const cancel = button(cards(element)[0], 'Anulează transferul');
    cancel?.focus();
    cancel?.click();
    await settle();
    await settle();
    await settle();

    expect(document.activeElement).toBe(cards(element)[0]);
  });

  it('shows the transfer line and its cancel instead of the menu while a transfer is out', async () => {
    const { element, settle } = await render([sold]);
    await settle();

    const card = cards(element)[0];
    expect(text(card)).toContain('Transfer trimis · expiră pe 15 oct.');
    expect(trigger(card)).toBeNull();
    expect(button(card, 'Anulează transferul')?.type).toBe('button');
  });

  it('writes the transfer line in English', async () => {
    const { element, settle } = await render([sold], 'en');
    await settle();

    const card = cards(element)[0];
    expect(text(card)).toContain('Transfer sent · expires on 15 Oct');
    expect(button(card, 'Cancel the transfer')).toBeDefined();
  });

  it.each([true, 'cancelled'] as const)(
    'confirms the cancel and reads the list again on %s',
    async (answer) => {
      const { element, settle } = await render([sold]);
      await settle();
      list.mockResolvedValueOnce({ items: [car()] });
      open.mockResolvedValueOnce(answer);

      button(cards(element)[0], 'Anulează transferul')?.click();
      await settle();
      await settle();
      await settle();

      expect(open).toHaveBeenCalledWith(
        CancelTransfer,
        expect.objectContaining({
          data: { car: sold },
          shape: 'dialog',
          title: 'driver.cars.transfer.confirm.title',
        }),
      );
      expect(list).toHaveBeenCalledTimes(2);
      expect(trigger(cards(element)[0])).not.toBeNull();
    },
  );

  it.each([
    'car_transfer.sent',
    'car_transfer.cancelled',
    'car_transfer.expired',
    'car_transfer.accepted',
  ] as const)('reads the list again on %s', async (kind) => {
    // The re-read waits 300 ms on the clock, which a frozen Date never reaches.
    jest.useRealTimers();
    const { settle } = await render();
    await settle();

    (TestBed.inject(Live) as unknown as ReturnType<typeof fakeLive>).emit(
      kind,
      'car-1',
    );
    // A burst of events is one re-read, 300 ms after the last.
    await new Promise((resolve) => setTimeout(resolve, 350));
    await settle();

    expect(list).toHaveBeenCalledTimes(2);
  });

  it('gives the cancel button a 44 px target', () => {
    const css = readFileSync(join(__dirname, 'cars-view.css'), 'utf8');
    expect(css).toMatch(/\.transfer button[^{]*\{[^}]*min-height: 44px/);
  });
});

// @traces 1394-FR-003 1394-FR-006
describe('Mașini vândute in Mașinile mele', () => {
  const golf = {
    brandName: 'VW',
    id: 'sold-1',
    model: 'Golf',
    saleDate: new Date().toISOString(),
    year: 2015,
  };
  afterEach(() => {
    soldAnswer = async () => ({ items: [] });
  });

  const section = (element: HTMLElement) =>
    element.querySelector('mf-sold-cars h2');

  it('shows no section, title or empty state with no sold car', async () => {
    const { element, settle } = await render();
    await settle();

    expect(soldList).toHaveBeenCalledTimes(1);
    expect(section(element)).toBeNull();
    expect(text(element)).not.toContain('Mașini vândute');
  });

  it('shows the sold car under the car list', async () => {
    soldAnswer = async () => ({ items: [golf] });
    const { element, settle } = await render();
    await settle();

    expect(section(element)?.textContent?.trim()).toBe('Mașini vândute');
    const order = [...element.querySelectorAll('[data-car], mf-sold-cars')].map(
      (e) => e.tagName.toLowerCase(),
    );
    expect(order).toEqual(['article', 'mf-sold-cars']);
    expect(element.querySelectorAll('mf-sold-car')).toHaveLength(1);
  });

  it('shows the sold car under the empty state when no car is left', async () => {
    soldAnswer = async () => ({ items: [golf] });
    const { element, settle } = await render([]);
    await settle();

    expect(element.querySelector('mf-empty-state')).not.toBeNull();
    expect(section(element)).not.toBeNull();
  });

  it('shows its own error with a retry and leaves the car list as it is', async () => {
    let calls = 0;
    soldAnswer = async () => {
      calls += 1;
      if (calls === 1) throw new Error('offline');
      return { items: [golf] };
    };
    const { element, settle } = await render();
    await settle();

    expect(cards(element)).toHaveLength(1);
    expect(text(element)).toContain('Ceva nu a mers. Încearcă din nou.');
    button(element, 'Reîncearcă')?.click();
    await settle();

    expect(soldList).toHaveBeenCalledTimes(2);
    expect(section(element)).not.toBeNull();
    expect(text(element)).not.toContain('Ceva nu a mers.');
    expect(cards(element)).toHaveLength(1);
  });

  it('reads the sold cars again when a car is taken over', async () => {
    jest.useRealTimers();
    const { element, settle } = await render();
    await settle();
    soldAnswer = async () => ({ items: [golf] });

    (TestBed.inject(Live) as unknown as ReturnType<typeof fakeLive>).emit(
      'car_transfer.accepted',
      'car-1',
    );
    await new Promise((resolve) => setTimeout(resolve, 350));
    await settle();

    expect(soldList).toHaveBeenCalledTimes(2);
    expect(section(element)).not.toBeNull();
  });

  it('loads the section only once a sold car is listed', () => {
    const html = readFileSync(join(__dirname, 'cars-view.html'), 'utf8');
    expect(html).toMatch(/@defer \(when soldCars\(\)\.length\)/);
  });
});
