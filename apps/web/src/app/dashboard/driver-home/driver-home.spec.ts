import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import {
  type CarDto,
  CarsService,
  type MeDto,
  type RequestSummaryDto,
  RequestsService,
} from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';

import { DriverHome } from './driver-home';
import { AddCar } from '../add-car/add-car';
import { Session } from '../session';

const car = (over: Partial<CarDto> = {}): CarDto => ({
  brandId: 'dacia',
  brandName: 'Dacia',
  createdAt: '2026-10-07T09:00:00.000Z',
  engine: null,
  fuel: 'petrol',
  id: 'car-1',
  itpUntil: null,
  model: 'Logan',
  odometerKm: 120000,
  plate: null,
  rcaUntil: null,
  rovinietaUntil: null,
  year: 2017,
  ...over,
});

const request = (over: Partial<RequestSummaryDto> = {}): RequestSummaryDto => ({
  car: {
    brand: 'Dacia',
    engine: null,
    fuel: 'petrol',
    model: 'Logan',
    year: 2017,
  },
  closedAt: null,
  closedReason: null,
  createdAt: '2026-10-09T09:00:00.000Z',
  description: null,
  expiresAt: '2026-10-16T09:00:00.000Z',
  id: 'req-1',
  jobs: [],
  quotesCount: 0,
  status: 'sent',
  ...over,
});

const DRIVER = [
  'driver.requests',
  'driver.cars',
  'driver.reviews',
  'driver.saved_garages',
  'driver.settings',
];

type Answer<T> = T[] | Error | Promise<never>;

interface Setup {
  cars?: Answer<CarDto>;
  requests?: Answer<RequestSummaryDto>;
  capabilities?: string[];
  language?: 'ro' | 'en';
}

let carsList: jest.Mock;
let requestsList: jest.Mock;
let open: jest.Mock;

const answer = <T>(value: Answer<T>) =>
  value instanceof Error
    ? Promise.reject(value)
    : value instanceof Promise
      ? value
      : Promise.resolve({
          items: value,
          nextCursor: null,
          total: value.length,
        });

async function render({
  cars = [],
  requests = [],
  capabilities = DRIVER,
  language = 'ro',
}: Setup = {}) {
  carsList = jest.fn(() => answer(cars));
  requestsList = jest.fn(() => answer(requests));
  open = jest.fn(async () => 'cancelled');
  const current = signal({ capabilities, role: 'driver' } as unknown as MeDto);
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: CarsService, useValue: { carsControllerList: carsList } },
      {
        provide: RequestsService,
        useValue: { requestsControllerList: requestsList },
      },
      { provide: Overlays, useValue: { open } },
      { provide: Session, useValue: { current, shown: current } },
    ],
  });
  await TestBed.inject(I18n).enter('driver');
  if (language === 'en') await TestBed.inject(I18n).use('en');
  const fixture = TestBed.createComponent(DriverHome);
  const element = fixture.nativeElement as HTMLElement;
  // The dialog's code loads on the first tap: a few turns before it opens.
  const settle = async () => {
    for (let i = 0; i < 6; i++) {
      fixture.detectChanges();
      await fixture.whenStable();
    }
  };
  await settle();
  return { element, settle };
}

const text = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
const panel = (element: HTMLElement, key: string) =>
  element.querySelector<HTMLElement>(`[data-panel="${key}"]`);
const invitation = (element: HTMLElement, key: string) =>
  element.querySelector<HTMLElement>(`[data-invitation="${key}"]`);
const control = (element: Element | null, name: string) =>
  [...(element?.querySelectorAll<HTMLElement>('button, a') ?? [])].find(
    (b) => text(b) === name,
  );
const panels = (element: HTMLElement) =>
  [...element.querySelectorAll<HTMLElement>('[data-panel]')].map(
    (p) => p.dataset['panel'],
  );

const EMPTY = {
  cars: 'Adaugă prima ta mașină. O folosim ca să‑ți arătăm service‑urile potrivite și să‑ți amintim de ITP.',
  quotes: 'Încă nu ai oferte. Trimite o cerere și compari ofertele aici.',
  repairs:
    'Nicio reparație încă. Reparațiile făcute prin MotorFix apar aici singure.',
  saved: 'Nu ai salvat încă niciun service.',
};
const EMPTY_EN = {
  cars: 'Add your first car. We use it to show you the right garages and to remind you about the ITP.',
  quotes: 'No quotes yet. Send a request and compare the quotes here.',
  repairs:
    'No repairs yet. Repairs done through MotorFix appear here by themselves.',
  saved: 'You have not saved any garage yet.',
};

afterEach(() => TestBed.resetTestingModule());

// @traces 030-FR-002
describe('Panou for a new driver', () => {
  it('reads the cars and the requests once each', async () => {
    await render();

    expect(carsList).toHaveBeenCalledTimes(1);
    expect(requestsList).toHaveBeenCalledTimes(1);
  });

  it('invites a driver with no car and no request to add a car and to find a garage', async () => {
    const { element } = await render();

    expect(text(invitation(element, 'car'))).toContain(
      'Adaugă prima ta mașină',
    );
    expect(
      control(invitation(element, 'car'), 'Adaugă o mașină'),
    ).toBeDefined();
    expect(text(invitation(element, 'search'))).toContain(
      'Caută un service pentru mașina ta',
    );
    expect(
      control(invitation(element, 'search'), 'Caută un service'),
    ).toBeDefined();
    expect(panel(element, 'activeRequest')).toBeNull();
  });

  it('no longer offers Cerere nouă', async () => {
    const { element } = await render();

    expect(text(element)).not.toContain('Cerere nouă');
  });

  it('says the invitations in English for an English reader', async () => {
    const { element } = await render({ language: 'en' });

    expect(text(invitation(element, 'car'))).toContain('Add your first car');
    expect(control(invitation(element, 'car'), 'Add a car')).toBeDefined();
    expect(text(invitation(element, 'search'))).toContain(
      'Find a garage for your car',
    );
    expect(
      control(invitation(element, 'search'), 'Find a garage'),
    ).toBeDefined();
  });
});

// @traces 030-FR-003
describe('the invitations’ actions', () => {
  it('opens the add-car dialog from Adaugă o mașină', async () => {
    const { element, settle } = await render();

    control(invitation(element, 'car'), 'Adaugă o mașină')?.click();
    await settle();

    expect(open).toHaveBeenCalledWith(
      AddCar,
      expect.objectContaining({
        data: { plates: [] },
        shape: 'dialog',
        title: 'driver.cars.add.title',
      }),
    );
  });

  it('sends Caută un service to Home in the reader’s language', async () => {
    const ro = await render();
    expect(
      control(
        invitation(ro.element, 'search'),
        'Caută un service',
      )?.getAttribute('href'),
    ).toBe('/ro');
    TestBed.resetTestingModule();

    const en = await render({ language: 'en' });
    expect(
      control(invitation(en.element, 'search'), 'Find a garage')?.getAttribute(
        'href',
      ),
    ).toBe('/en');
  });
});

// @traces 030-FR-008
describe('a car saved from Panou', () => {
  it('takes the car invitation and the empty Mașinile mele away without reading again', async () => {
    const { element, settle } = await render();
    open.mockResolvedValueOnce(car());

    control(invitation(element, 'car'), 'Adaugă o mașină')?.click();
    await settle();

    expect(invitation(element, 'car')).toBeNull();
    expect(invitation(element, 'search')).not.toBeNull();
    expect(text(panel(element, 'cars'))).not.toContain(EMPTY.cars);
    expect(carsList).toHaveBeenCalledTimes(1);
  });

  it('leaves the invitation when the dialog is cancelled', async () => {
    const { element, settle } = await render();

    control(invitation(element, 'car'), 'Adaugă o mașină')?.click();
    await settle();

    expect(invitation(element, 'car')).not.toBeNull();
  });
});

// @traces 030-FR-007
describe('Panou for a driver with a car and no active request', () => {
  it('shows the search invitation alone in the first row', async () => {
    const { element } = await render({ cars: [car()] });

    expect(invitation(element, 'car')).toBeNull();
    expect(invitation(element, 'search')).not.toBeNull();
    expect(panel(element, 'activeRequest')).toBeNull();
  });

  it.each(['done', 'closed'] as const)(
    'does not count a %s request as active',
    async (status) => {
      const { element } = await render({
        cars: [car()],
        requests: [request({ status })],
      });

      expect(invitation(element, 'search')).not.toBeNull();
      expect(panel(element, 'activeRequest')).toBeNull();
    },
  );
});

// @traces 030-FR-002, 030-FR-007
describe('Panou with an active request', () => {
  it('shows Cererea activă with its heading linked to Cererile mele, and no invitation', async () => {
    const { element } = await render({
      cars: [car()],
      requests: [request({ status: 'sent' })],
    });
    const active = panel(element, 'activeRequest');

    expect(active).not.toBeNull();
    expect(text(active?.querySelector('h2'))).toBe('Cererea activă');
    expect(active?.querySelector('h2 a')?.getAttribute('href')).toBe(
      '/app/driver/requests',
    );
    expect(invitation(element, 'search')).toBeNull();
    expect(invitation(element, 'car')).toBeNull();
  });

  it('shows Cererea activă even to a driver with no car', async () => {
    const { element } = await render({ requests: [request()] });

    expect(panel(element, 'activeRequest')).not.toBeNull();
    expect(invitation(element, 'car')).toBeNull();
  });
});

// @traces 030-FR-001
describe('the Panou grid', () => {
  it('lays out the released panels in order: first row, quotes and cars, repairs, saved', async () => {
    const { element } = await render({ requests: [request()] });

    expect(panels(element)).toEqual([
      'activeRequest',
      'quotes',
      'cars',
      'repairs',
      'saved',
    ]);
    expect(panel(element, 'repairs')?.classList).toContain('wide');
    expect(panel(element, 'activeRequest')?.classList).toContain('wide');
  });

  it('renders no panel of an unreleased feature', async () => {
    const { element } = await render();

    for (const name of [
      'În direct din service',
      'Kilometri și reparații',
      'Cheltuieli',
      'Asistent AI',
    ]) {
      expect(text(element)).not.toContain(name);
    }
  });
});

// @traces 030-FR-011
describe('Service-uri salvate on Panou', () => {
  it('shows its empty state and Caută altele to Home, with no saved-garages read', async () => {
    const { element } = await render();
    const saved = panel(element, 'saved');

    expect(text(saved)).toContain(EMPTY.saved);
    expect(control(saved, 'Caută altele')?.getAttribute('href')).toBe('/ro');
  });

  it('is left out for a driver without the saved-garages capability', async () => {
    const { element } = await render({
      capabilities: DRIVER.filter((c) => c !== 'driver.saved_garages'),
    });

    expect(panel(element, 'saved')).toBeNull();
  });
});

// @traces 030-FR-004
describe('the empty panels', () => {
  it('say what will appear there, each with its one action', async () => {
    const { element } = await render();

    expect(text(panel(element, 'quotes'))).toContain(EMPTY.quotes);
    expect(
      control(panel(element, 'quotes'), 'Caută un service')?.getAttribute(
        'href',
      ),
    ).toBe('/ro');
    expect(text(panel(element, 'cars'))).toContain(EMPTY.cars);
    expect(control(panel(element, 'cars'), 'Adaugă o mașină')).toBeDefined();
    expect(text(panel(element, 'repairs'))).toContain(EMPTY.repairs);
    expect(
      panel(element, 'repairs')?.querySelector('button, a:not(h2 a)'),
    ).toBeNull();
  });

  it('say it in English for an English reader', async () => {
    const { element } = await render({ language: 'en' });

    expect(text(panel(element, 'quotes'))).toContain(EMPTY_EN.quotes);
    expect(text(panel(element, 'cars'))).toContain(EMPTY_EN.cars);
    expect(text(panel(element, 'repairs'))).toContain(EMPTY_EN.repairs);
    expect(text(panel(element, 'saved'))).toContain(EMPTY_EN.saved);
    expect(control(panel(element, 'saved'), 'Find others')).toBeDefined();
  });

  it('give each panel its heading', async () => {
    const { element } = await render();

    expect(text(panel(element, 'quotes')?.querySelector('h2'))).toBe(
      'Oferte primite',
    );
    expect(text(panel(element, 'cars')?.querySelector('h2'))).toBe(
      'Mașinile mele',
    );
    expect(text(panel(element, 'repairs')?.querySelector('h2'))).toBe(
      'Istoric reparații',
    );
    expect(text(panel(element, 'saved')?.querySelector('h2'))).toBe(
      'Service‑uri salvate',
    );
  });

  it('opens the add-car dialog from the Mașinile mele panel', async () => {
    const { element, settle } = await render();

    control(panel(element, 'cars'), 'Adaugă o mașină')?.click();
    await settle();

    expect(open).toHaveBeenCalledTimes(1);
  });
});

// @traces 030-FR-006
describe('the panels’ states', () => {
  it('shows placeholders and no empty text while the lists load', async () => {
    const { element } = await render({
      cars: new Promise<never>(() => {}),
      requests: new Promise<never>(() => {}),
    });

    expect(element.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(invitation(element, 'search')).toBeNull();
    expect(text(element)).not.toContain(EMPTY.cars);
    expect(text(element)).not.toContain(EMPTY.quotes);
  });

  it('keeps the first row loading until both lists are read', async () => {
    const { element } = await render({
      requests: new Promise<never>(() => {}),
    });

    expect(invitation(element, 'search')).toBeNull();
    expect(invitation(element, 'car')).toBeNull();
    expect(text(panel(element, 'cars'))).toContain(EMPTY.cars);
  });

  it('shows the shared error where a list could not be read, and the other panels as they are', async () => {
    const { element } = await render({ requests: new Error('down') });

    expect(text(element)).toContain('Ceva nu a mers. Încearcă din nou.');
    expect(element.querySelector('[role="alert"]')).not.toBeNull();
    expect(text(panel(element, 'cars'))).toContain(EMPTY.cars);
    expect(text(panel(element, 'quotes'))).not.toContain(EMPTY.quotes);
    expect(invitation(element, 'search')).toBeNull();
  });

  it('shows the error in Mașinile mele when the cars cannot be read', async () => {
    const { element } = await render({ cars: new Error('down') });

    expect(text(panel(element, 'cars'))).toContain(
      'Ceva nu a mers. Încearcă din nou.',
    );
    expect(text(panel(element, 'quotes'))).toContain(EMPTY.quotes);
  });

  it('counts quotes by quotesCount and repairs by done requests', async () => {
    const { element } = await render({
      cars: [car()],
      requests: [
        request({ quotesCount: 2, status: 'quoted' }),
        request({ id: 'req-2', status: 'done' }),
      ],
    });

    expect(text(panel(element, 'quotes'))).not.toContain(EMPTY.quotes);
    expect(text(panel(element, 'repairs'))).not.toContain(EMPTY.repairs);
  });

  it('keeps the quotes and repairs empty while no request has a quote or is done', async () => {
    const { element } = await render({
      requests: [request({ quotesCount: 0, status: 'closed' })],
    });

    expect(text(panel(element, 'quotes'))).toContain(EMPTY.quotes);
    expect(text(panel(element, 'repairs'))).toContain(EMPTY.repairs);
  });

  it('shows a filled panel as its frame, with its heading linked to its view and nothing else', async () => {
    const { element } = await render({
      cars: [car()],
      requests: [request({ quotesCount: 1, status: 'done' })],
    });

    for (const [key, href] of [
      ['cars', '/app/driver/cars'],
      ['quotes', '/app/driver/requests'],
      ['repairs', '/app/driver/requests'],
    ]) {
      const filled = panel(element, key)!;
      expect(filled.querySelector('h2 a')?.getAttribute('href')).toBe(href);
      expect(filled.querySelector('mf-empty-state')).toBeNull();
      expect(text(filled)).toBe(text(filled.querySelector('h2')));
    }
  });
});
