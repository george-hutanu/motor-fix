import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { EventKind, LiveMessage } from '@motor-fix/contracts';
import {
  type ActiveRequestAnswerDto,
  type CarDto,
  CarsService,
  type MeDto,
  PlacesService,
  QuoteRequestsService,
  QuotesService,
  type RequestSummaryDto,
  RequestsService,
  type SavedGaragesPageDto,
  SavedGaragesService,
} from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';
import { filter, Subject } from 'rxjs';

import { DriverHome } from './driver-home';
import { SavedGarages } from '../../public/saved-garages/saved-garages';
import { AddCar } from '../add-car/add-car';
import { CarsView } from '../cars-view/cars-view';
import { DRIVER_PANELS, panelsToDraw } from '../driver-panels/driver-panels';
import { Live } from '../live';
import {
  fakeSavedGarages,
  pageOf,
  savedItem,
  savedItems,
} from '../saved-garages/saved-garages.testing';
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
  nextServiceKm: null,
  odometerKm: 120000,
  plate: null,
  rcaUntil: null,
  rovinietaUntil: null,
  serviceDueOn: null,
  transfer: null,
  updatedAt: '2026-10-07T09:00:00.000Z',
  year: 2017,
  ...over,
});

const request = (over: Partial<RequestSummaryDto> = {}): RequestSummaryDto => ({
  booking: null,
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
  active?: ActiveRequestAnswerDto | Error | Promise<never>;
  saved?: SavedGaragesPageDto | Error | Promise<never>;
  // null: no session shown, as for a moment after signing out.
  capabilities?: string[] | null;
  language?: 'ro' | 'en';
}

let carsList: jest.Mock;
let requestsList: jest.Mock;
let activeRead: jest.Mock;
let savedList: jest.Mock;
let open: jest.Mock;
let compare: jest.Mock;
let events: Subject<LiveMessage>;
let resync: Subject<void>;
let offline: ReturnType<typeof signal<boolean>>;

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

// The active read as the server would answer the requests given: an open one
// is the panel's, none leaves the invitations.
const activeOf = (
  requests: Answer<RequestSummaryDto>,
): ActiveRequestAnswerDto | Error | Promise<never> => {
  if (!Array.isArray(requests)) return requests;
  const open = requests.filter((r) => !['done', 'closed'].includes(r.status));
  return {
    openCount: open.length,
    request: open[0]
      ? {
          booking: null,
          car: {
            brand: open[0].car.brand,
            model: open[0].car.model,
            year: open[0].car.year,
          },
          description: open[0].description,
          id: open[0].id,
          job: null,
          jobs: open[0].jobs,
          mechanicName: null,
          range: null,
          saveSuggestion: null,
          stage: 'sent',
        }
      : null,
  };
};

const activeAnswer = (
  value: ActiveRequestAnswerDto | Error | Promise<never>,
) =>
  value instanceof Error
    ? Promise.reject(value)
    : value instanceof Promise
      ? value
      : Promise.resolve(value);

async function render({
  cars = [],
  requests = [],
  active,
  saved = pageOf([]),
  capabilities = DRIVER,
  language = 'ro',
}: Setup = {}) {
  carsList = jest.fn(() => answer(cars));
  requestsList = jest.fn(() => answer(requests));
  activeRead = jest.fn(() => activeAnswer(active ?? activeOf(requests)));
  savedList = jest.fn(() =>
    saved instanceof Error ? Promise.reject(saved) : Promise.resolve(saved),
  );
  open = jest.fn(async () => 'cancelled');
  compare = jest.fn(() => new Promise<never>(() => undefined));
  events = new Subject();
  resync = new Subject();
  offline = signal(false);
  const current = signal(
    capabilities === null
      ? null
      : ({ capabilities, id: 'account-1', role: 'driver' } as unknown as MeDto),
  );
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: CarsService, useValue: { carsControllerList: carsList } },
      {
        provide: RequestsService,
        useValue: {
          activeRequestControllerGet: activeRead,
          requestsControllerList: requestsList,
        },
      },
      { provide: Overlays, useValue: { open } },
      {
        provide: QuoteRequestsService,
        useValue: { compareControllerGet: compare },
      },
      {
        provide: QuotesService,
        useValue: { acceptControllerAccept: jest.fn() },
      },
      {
        provide: SavedGaragesService,
        useValue: { savedGaragesControllerList: savedList },
      },
      { provide: SavedGarages, useValue: fakeSavedGarages() },
      {
        provide: PlacesService,
        useValue: { placesControllerSearch: async () => ({ items: [] }) },
      },
      { provide: Session, useValue: { current, shown: current } },
      {
        provide: Live,
        useValue: {
          events,
          offline,
          on: (kinds: readonly EventKind[]) =>
            events.pipe(
              filter((m) => (kinds as readonly string[]).includes(m.kind)),
            ),
          resync,
        },
      },
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
  return { element, fixture, settle };
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

// @traces 030-FR-002 030-FR-007
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
  it('shows its empty state and Caută altele to Home for a driver with no car', async () => {
    const { element } = await render();
    const saved = panel(element, 'saved');

    expect(savedList).toHaveBeenCalledTimes(1);
    expect(text(saved)).toContain(EMPTY.saved);
    expect(control(saved, 'Caută altele')?.getAttribute('href')).toBe('/ro');
  });

  it('is left out while no session is shown', async () => {
    const { element } = await render({ capabilities: null });

    expect(panel(element, 'saved')).toBeNull();
    expect(panel(element, 'cars')).not.toBeNull();
  });

  it('is left out for a driver without the saved-garages capability', async () => {
    const { element } = await render({
      capabilities: DRIVER.filter((c) => c !== 'driver.saved_garages'),
    });

    expect(panel(element, 'saved')).toBeNull();
  });
});

// @traces 291-FR-006
// @traces 291-FR-009
// @traces 291-FR-012
describe('Service-uri salvate on Panou, filled', () => {
  const names = (element: HTMLElement) =>
    [
      ...(panel(element, 'saved')?.querySelectorAll('a[data-profile]') ?? []),
    ].map((link) => text(link));

  it('shows the newest 3 rows and Vezi toate to the view when more are saved', async () => {
    const { element } = await render({
      saved: pageOf(savedItems(5), { total: 5 }),
    });
    const saved = panel(element, 'saved');

    expect(names(element)).toEqual(['Service 1', 'Service 2', 'Service 3']);
    expect(control(saved, 'Vezi toate')?.getAttribute('href')).toBe(
      '/app/driver/saved',
    );
    expect(saved?.querySelector('h2 a')?.getAttribute('href')).toBe(
      '/app/driver/saved',
    );
  });

  it('shows no Vezi toate for 3 saved garages or fewer', async () => {
    const { element } = await render({ saved: pageOf(savedItems(3)) });

    expect(names(element)).toHaveLength(3);
    expect(control(panel(element, 'saved'), 'Vezi toate')).toBeUndefined();
  });

  it('links its heading only while the list has rows, as the other panels', async () => {
    const { element } = await render({ saved: pageOf([]) });

    expect(panel(element, 'saved')?.querySelector('h2 a')).toBeNull();
  });

  it('says See all in English', async () => {
    const { element } = await render({
      language: 'en',
      saved: pageOf(savedItems(4), { total: 4 }),
    });

    expect(control(panel(element, 'saved'), 'See all')).toBeDefined();
  });

  it('keeps Caută altele in its header, to the first car’s brand', async () => {
    const { element } = await render({
      cars: [car({ brandId: 'b-dacia' })],
      saved: pageOf([savedItem()]),
    });

    expect(
      panel(element, 'saved')
        ?.querySelector('a[data-find-more]')
        ?.getAttribute('href'),
    ).toBe('/ro/garages?brand=b-dacia');
  });

  it('shows three row placeholders while the list loads', async () => {
    const { element } = await render({ saved: new Promise<never>(() => {}) });

    expect(panel(element, 'saved')?.querySelectorAll('.skeleton')).toHaveLength(
      3,
    );
    expect(text(panel(element, 'saved'))).not.toContain(EMPTY.saved);
  });

  it('says it could not load the list, and reads again on Reîncearcă', async () => {
    const { element, settle } = await render({ saved: new Error('down') });
    const saved = panel(element, 'saved');

    expect(text(saved)).toContain('Nu am putut încărca service‑urile salvate.');
    savedList.mockResolvedValueOnce(pageOf(savedItems(1)));
    control(saved, 'Reîncearcă')?.click();
    await settle();

    expect(names(element)).toEqual(['Service 1']);
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
    expect(control(panel(element, 'saved'), 'Find more')).toBeDefined();
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
    expect(
      element.querySelector('.skeleton[aria-busy="true"]:not(mf-panel *)'),
    ).not.toBeNull();
  });

  it('shows the shared error where a list could not be read, and the other panels as they are', async () => {
    const { element } = await render({ requests: new Error('down') });

    expect(text(element)).toContain('Ceva nu a mers. Încearcă din nou.');
    expect(element.querySelector('[role="alert"]')).not.toBeNull();
    expect(text(panel(element, 'cars'))).toContain(EMPTY.cars);
    expect(text(panel(element, 'quotes'))).not.toContain(EMPTY.quotes);
    expect(invitation(element, 'search')).toBeNull();
  });

  it('links no heading to a view whose list could not be read', async () => {
    const { element } = await render({
      cars: new Error('down'),
      requests: new Error('down'),
    });

    for (const key of ['activeRequest', 'quotes', 'cars', 'repairs']) {
      expect(panel(element, key)?.querySelector('h2 a')).toBeNull();
    }
  });

  it('shows the error in Mașinile mele when the cars cannot be read', async () => {
    const { element } = await render({ cars: new Error('down') });

    expect(text(panel(element, 'cars'))).toContain(
      'Nu am putut încărca mașinile. Reîncearcă.',
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

  it('shows a filled panel as its frame, with its heading linked to its view', async () => {
    const { element } = await render({
      cars: [car()],
      requests: [
        request({ quotesCount: 1, status: 'quoted' }),
        request({ id: 'req-2', status: 'done' }),
      ],
    });

    expect(
      panel(element, 'cars')?.querySelector('h2 a')?.getAttribute('href'),
    ).toBe('/app/driver/cars');
    for (const [key, href] of [
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

// @traces 313-FR-012
describe('Panou’s quotes panel', () => {
  const booked = (status: 'awaiting_confirmation' | 'confirmed') =>
    ({
      cancelledBySide: null,
      confirmBy: '2026-10-18T10:00:00.000Z',
      finalPriceBani: null,
      garage: {
        id: 'garage-1',
        name: 'Service Auto Militari',
        slug: 'service-auto-militari',
      },
      handedOverAt: null,
      id: 'booking-1',
      jobStarted: false,
      lateCancellation: false,
      noShowAt: null,
      startsAt: '2026-10-20T06:00:00.000Z',
      status,
    }) as const;
  const comparison = (element: HTMLElement) =>
    panel(element, 'quotes')?.querySelector('mf-quotes-compare');

  it('compares the quotes of the most recent open request with quotes', async () => {
    const { element } = await render({
      requests: [
        request({
          createdAt: '2026-10-12T09:00:00.000Z',
          id: 'req-new',
          quotesCount: 0,
        }),
        request({
          createdAt: '2026-10-11T09:00:00.000Z',
          id: 'req-open',
          quotesCount: 2,
          status: 'quoted',
        }),
        request({
          createdAt: '2026-10-10T09:00:00.000Z',
          id: 'req-old',
          quotesCount: 3,
          status: 'quoted',
        }),
      ],
    });

    expect(comparison(element)).not.toBeNull();
    expect(compare).toHaveBeenCalledWith({ id: 'req-open' });
    expect(
      panel(element, 'quotes')?.querySelector('h2 a')?.getAttribute('href'),
    ).toBe('/app/driver/requests');
  });

  it('takes a booked request while its booking waits for the garage', async () => {
    const { element } = await render({
      requests: [
        request({
          booking: booked('confirmed'),
          createdAt: '2026-10-12T09:00:00.000Z',
          id: 'req-confirmed',
          quotesCount: 2,
          status: 'booked',
        }),
        request({
          booking: booked('awaiting_confirmation'),
          createdAt: '2026-10-11T09:00:00.000Z',
          id: 'req-held',
          quotesCount: 2,
          status: 'booked',
        }),
      ],
    });

    expect(comparison(element)).not.toBeNull();
    expect(compare).toHaveBeenCalledWith({ id: 'req-held' });
  });

  it('keeps the empty state when no open request has quotes', async () => {
    const { element } = await render({
      requests: [
        request({ quotesCount: 2, status: 'done' }),
        request({ id: 'req-2', quotesCount: 1, status: 'closed' }),
        request({
          booking: booked('confirmed'),
          id: 'req-3',
          quotesCount: 1,
          status: 'booked',
        }),
      ],
    });

    expect(comparison(element)).toBeNull();
    expect(compare).not.toHaveBeenCalled();
    expect(text(panel(element, 'quotes'))).toContain(EMPTY.quotes);
  });

  it('keeps the placeholder while the requests load and the error when they fail', async () => {
    const loading = await render({
      requests: new Promise<never>(() => undefined),
    });
    expect(comparison(loading.element)).toBeNull();
    TestBed.resetTestingModule();

    const failed = await render({ requests: new Error('down') });
    expect(comparison(failed.element)).toBeNull();
    expect(text(panel(failed.element, 'quotes'))).not.toContain(EMPTY.quotes);
  });
});

// @traces 222-FR-009
describe('Panou once a quote is accepted', () => {
  it('reads the requests again when the driver’s quote.accepted arrives', async () => {
    const { settle } = await render({
      requests: [request({ quotesCount: 2 })],
    });
    expect(requestsList).toHaveBeenCalledTimes(1);

    events.next({
      at: new Date().toISOString(),
      id: 'quote-1',
      kind: 'quote.accepted',
    });
    await new Promise((r) => setTimeout(r, 400));
    await settle();

    expect(requestsList).toHaveBeenCalledTimes(2);
    expect(carsList).toHaveBeenCalledTimes(1);
  });

  // @traces 1385-FR-008
  it.each(['request.cancelled', 'booking.cancelled'] as const)(
    'reads the requests again on a cancel, %s',
    async (kind) => {
      const { settle } = await render({
        requests: [request({ quotesCount: 2 })],
      });

      events.next({ at: new Date().toISOString(), id: 'req-1', kind });
      await new Promise((r) => setTimeout(r, 400));
      await settle();

      expect(requestsList).toHaveBeenCalledTimes(2);
    },
  );

  // @traces 389-FR-016
  it.each(['booking.confirmed', 'booking.lapsed'] as const)(
    'reads the requests again on %s',
    async (kind) => {
      const { settle } = await render({
        requests: [request({ quotesCount: 2 })],
      });

      events.next({ at: new Date().toISOString(), id: 'booking-1', kind });
      await new Promise((r) => setTimeout(r, 400));
      await settle();

      expect(requestsList).toHaveBeenCalledTimes(2);
    },
  );

  it('reads nothing again for other kinds', async () => {
    await render({ requests: [request()] });

    events.next({
      at: new Date().toISOString(),
      id: 'x',
      kind: 'message.sent',
    });
    await new Promise((r) => setTimeout(r, 400));

    expect(requestsList).toHaveBeenCalledTimes(1);
  });
});

// Only Date is faked: Angular's stability checks still need real timers.
function clockAt(at: string) {
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
    now: new Date(at),
  });
}

const BMW = car({
  brandId: 'bmw',
  brandName: 'BMW',
  id: 'bmw',
  itpUntil: '2026-11-13',
  model: '320d',
  nextServiceKm: 152000,
  odometerKm: 148200,
  plate: 'B 123 ABC',
  year: 2019,
});

const cards = (element: HTMLElement) => [
  ...(panel(element, 'cars')?.querySelectorAll<HTMLElement>('li') ?? []),
];
const lines = (card: HTMLElement) =>
  [...card.querySelectorAll<HTMLElement>('mf-lamp')].map((lamp) => [
    lamp.getAttribute('data-state'),
    text(lamp),
  ]);

describe('Mașinile mele filled with the driver’s cars', () => {
  beforeEach(() => clockAt('2026-10-08T09:00:00Z'));
  afterEach(() => jest.useRealTimers());

  // @traces 029-FR-001 029-FR-002 029-FR-003
  it('shows the car’s name, year and kilometres and its two most urgent lines, without the plate', async () => {
    const { element } = await render({ cars: [BMW] });
    const [card] = cards(element);

    expect(text(card)).toContain('BMW 320d');
    expect(text(card)).toContain('2019 · 148.200 km');
    expect(lines(card)).toEqual([
      ['amber', 'ITP‑ul expiră în 36 de zile'],
      ['green', 'Schimb de ulei peste 3.800 km'],
    ]);
    expect(text(panel(element, 'cars'))).not.toContain('B 123 ABC');
  });

  // @traces 029-FR-001 029-FR-012
  it('says it in English for an English reader', async () => {
    const { element } = await render({ cars: [BMW], language: 'en' });
    const [card] = cards(element);

    expect(text(card)).toContain('2019 · 148,200 km');
    expect(lines(card)).toEqual([
      ['amber', 'ITP expires in 36 days'],
      ['green', 'Oil service due in 3,800 km'],
    ]);
  });

  // @traces 1386-FR-003
  it('judges the oil lamp by the estimated service date', async () => {
    const { element } = await render({
      cars: [{ ...BMW, itpUntil: '2027-06-30', serviceDueOn: '2026-10-20' }],
    });

    expect(lines(cards(element)[0])).toEqual([
      ['amber', 'Schimb de ulei peste 3.800 km'],
      ['green', 'ITP valabil până în iunie 2027'],
    ]);
  });

  // @traces 1386-FR-004
  it('shows no oil line for a car without a next service', async () => {
    const { element } = await render({
      cars: [{ ...BMW, nextServiceKm: null }],
    });
    const [card] = cards(element);

    expect(text(card)).not.toContain('ulei');
    expect(card.querySelector('button')).toBeNull();
  });

  // @traces 029-FR-002 029-FR-004
  it('keeps the two most urgent of a car’s four lines', async () => {
    const { element } = await render({
      cars: [
        car({
          itpUntil: '2027-06-30',
          nextServiceKm: 124000,
          rcaUntil: '2026-10-10',
          rovinietaUntil: '2026-11-01',
        }),
      ],
    });

    expect(lines(cards(element)[0])).toEqual([
      ['red', 'RCA‑ul expiră în 2 zile'],
      ['amber', 'Rovinieta expiră în 24 de zile'],
    ]);
  });

  // @traces 029-FR-002
  it('shows a missing date as a grey line in plain text, with no button', async () => {
    const { element } = await render({
      cars: [car({ itpUntil: '2026-11-13' })],
    });
    const [card] = cards(element);

    expect(lines(card)).toEqual([
      ['amber', 'ITP‑ul expiră în 36 de zile'],
      ['grey', 'RCA: adaugă data'],
    ]);
    expect(card.querySelector('button')).toBeNull();
    expect(card.querySelector('a')).toBeNull();
  });

  // @traces 029-FR-005
  it('shows the three most urgent of five cars and a link to all of them', async () => {
    const { element } = await render({
      cars: [
        car({ id: 'a', itpUntil: '2027-06-30', model: 'Logan' }),
        car({ id: 'b', model: 'Duster', rcaUntil: '2026-10-10' }),
        car({ id: 'c', model: 'Sandero' }),
        car({ id: 'd', model: 'Spring', nextServiceKm: 121000 }),
        car({ id: 'e', itpUntil: '2026-09-30', model: 'Jogger' }),
      ],
    });

    expect(cards(element).map((c) => text(c.querySelector('h3')))).toEqual([
      'Dacia Jogger',
      'Dacia Duster',
      'Dacia Spring',
    ]);
    expect(
      control(panel(element, 'cars'), 'Toate mașinile (5)')?.getAttribute(
        'href',
      ),
    ).toBe('/app/driver/cars');
  });

  // @traces 029-FR-005
  it('keeps the newer car first when two are equally urgent', async () => {
    const { element } = await render({
      cars: [
        car({ id: 'new', itpUntil: '2026-11-13', model: 'Jogger' }),
        car({ id: 'old', itpUntil: '2026-11-13', model: 'Logan' }),
      ],
    });

    expect(cards(element).map((c) => text(c.querySelector('h3')))).toEqual([
      'Dacia Jogger',
      'Dacia Logan',
    ]);
  });

  // @traces 029-FR-005 029-FR-012
  it('names the link in English and leaves it out for three cars or fewer', async () => {
    const five = Array.from({ length: 5 }, (_, i) => car({ id: `c${i}` }));
    const en = await render({ cars: five, language: 'en' });
    expect(control(panel(en.element, 'cars'), 'All cars (5)')).toBeDefined();
    TestBed.resetTestingModule();

    const three = await render({ cars: five.slice(0, 3) });
    expect(cards(three.element)).toHaveLength(3);
    expect(text(panel(three.element, 'cars'))).not.toContain('Toate mașinile');
  });
});

// @traces 029-FR-008
describe('Mașinile mele when the cars cannot be read', () => {
  it('shows its own error with a retry button, and the other panels as they are', async () => {
    const { element } = await render({ cars: new Error('down') });
    const cars = panel(element, 'cars');

    expect(text(cars?.querySelector('[role="alert"]'))).toBe(
      'Nu am putut încărca mașinile. Reîncearcă.',
    );
    expect(control(cars, 'Reîncearcă')).toBeDefined();
    expect(text(panel(element, 'quotes'))).toContain(EMPTY.quotes);
    expect(text(panel(element, 'repairs'))).toContain(EMPTY.repairs);
  });

  it('says it in English for an English reader', async () => {
    const { element } = await render({
      cars: new Error('down'),
      language: 'en',
    });

    expect(text(panel(element, 'cars'))).toContain(
      'We could not load your cars. Try again.',
    );
    expect(control(panel(element, 'cars'), 'Try again')).toBeDefined();
  });

  it('reads the cars again on retry, with the placeholder until they arrive', async () => {
    const { element, settle } = await render({ cars: new Error('down') });
    let arrive: (cars: CarDto[]) => void = () => {};
    carsList.mockReturnValueOnce(
      new Promise((resolve) => {
        arrive = (items) => resolve({ items, nextCursor: null, total: 1 });
      }),
    );

    control(panel(element, 'cars'), 'Reîncearcă')?.click();
    await settle();

    expect(carsList).toHaveBeenCalledTimes(2);
    expect(
      panel(element, 'cars')?.querySelector('[aria-busy="true"]'),
    ).not.toBeNull();
    expect(panel(element, 'cars')?.querySelector('[role="alert"]')).toBeNull();

    arrive([car({ model: 'Duster' })]);
    await settle();

    expect(text(cards(element)[0])).toContain('Dacia Duster');
  });

  it('lets the first row follow the requests alone, without the car invitation', async () => {
    const { element } = await render({ cars: new Error('down') });

    expect(invitation(element, 'search')).not.toBeNull();
    expect(invitation(element, 'car')).toBeNull();
    expect(panel(element, 'activeRequest')).toBeNull();
  });

  it('shows the search invitation while the cars still load, and the car one only once they are none', async () => {
    const { element } = await render({ cars: new Promise<never>(() => {}) });

    expect(invitation(element, 'search')).not.toBeNull();
    expect(invitation(element, 'car')).toBeNull();
  });
});

// @traces 029-FR-009
describe('a car saved from Mașinile mele', () => {
  beforeEach(() => clockAt('2026-10-08T09:00:00Z'));
  afterEach(() => jest.useRealTimers());

  it('shows in the panel at once, with its lines, without reading again', async () => {
    const { element, settle } = await render();
    open.mockResolvedValueOnce(BMW);

    control(panel(element, 'cars'), 'Adaugă o mașină')?.click();
    await settle();

    expect(text(cards(element)[0])).toContain('BMW 320d');
    expect(lines(cards(element)[0])[0]).toEqual([
      'amber',
      'ITP‑ul expiră în 36 de zile',
    ]);
    expect(carsList).toHaveBeenCalledTimes(1);
  });
});

// The view's own names for the registry's keys, kept from before it.
const DRAWN_AS: Record<string, string> = {
  active_request: 'activeRequest',
  history: 'repairs',
};

// @traces 029-FR-010
describe('Panou drawn from the panel registry', () => {
  it('draws the released panels in the registry’s order and widths', async () => {
    const { element } = await render({ requests: [request()] });

    expect(panels(element)).toEqual(
      panelsToDraw(null).map((key) => DRAWN_AS[key] ?? key),
    );
    for (const entry of DRIVER_PANELS.filter((p) => p.released)) {
      expect(
        panel(element, DRAWN_AS[entry.key] ?? entry.key)?.classList.contains(
          'wide',
        ),
      ).toBe(entry.wide);
    }
  });
});

describe('the add-car and find-garage buttons on a 320 px phone', () => {
  // Michroma at the body size needs two lines there: a one- or two-letter
  // word is held to the word after it, so no word is left alone on a line.
  it('ties "o" and "un" to the word that follows', async () => {
    const { element } = await render();
    const raw = (b: Element | null | undefined) => b?.textContent?.trim();

    expect(raw(invitation(element, 'car')?.querySelector('button'))).toBe(
      'Adaugă o mașină',
    );
    expect(raw(invitation(element, 'search')?.querySelector('a'))).toBe(
      'Caută un service',
    );
    expect(raw(panel(element, 'cars')?.querySelector('button'))).toBe(
      'Adaugă o mașină',
    );
    expect(raw(panel(element, 'quotes')?.querySelector('a'))).toBe(
      'Caută un service',
    );
  });
});

describe('Mașinile mele on a page left open', () => {
  afterEach(() => jest.useRealTimers());

  // @traces 029-FR-002
  it('ranks the lines by the new day once it comes, with no new read', async () => {
    jest.useFakeTimers({
      advanceTimers: true,
      doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'],
      now: new Date('2026-10-08T09:00:00Z'),
    });
    // ITP in 8 days (amber) and the oil about 6 days away (red); two days
    // later the ITP is 6 days away too and, as urgent, comes first.
    const due = car({
      itpUntil: '2026-10-16',
      nextServiceKm: 120213,
      odometerKm: 120000,
    });
    const { element, settle } = await render({ cars: [due] });
    const kinds = () =>
      [
        ...(cards(element)[0]?.querySelectorAll(
          'mf-oil-line, mf-due-date-line',
        ) ?? []),
      ].map((line) => line.tagName.toLowerCase());

    expect(kinds()).toEqual(['mf-oil-line', 'mf-due-date-line']);

    jest.setSystemTime(new Date('2026-10-10T09:00:00Z'));
    jest.advanceTimersByTime(60_000);
    await settle();

    expect(kinds()).toEqual(['mf-due-date-line', 'mf-oil-line']);
    expect(carsList).toHaveBeenCalledTimes(1);
  });
});

// @traces 274-FR-018
// @traces 274-FR-016
describe('Cererea activă on Panou', () => {
  const answer: ActiveRequestAnswerDto = {
    openCount: 3,
    request: {
      booking: null,
      car: { brand: 'BMW', model: '320d', year: 2016 },
      description: null,
      id: 'req-9',
      job: null,
      jobs: [],
      mechanicName: null,
      range: null,
      saveSuggestion: null,
      stage: 'sent',
    },
  };

  it('reads the active request once and draws it first and wide', async () => {
    const { element } = await render({ active: answer, requests: [request()] });

    expect(activeRead).toHaveBeenCalledTimes(1);
    const first = element.querySelector('mf-active-request');
    expect(first).not.toBeNull();
    expect(first?.classList.contains('wide')).toBe(true);
    expect(text(first)).toContain('BMW 320d');
    expect(invitation(element, 'search')).toBeNull();
  });

  it('links the other open requests to Cererile mele', async () => {
    const { element } = await render({ active: answer, requests: [request()] });

    expect(
      control(element, 'Încă 2 cereri deschise')?.getAttribute('href'),
    ).toBe('/app/driver/requests');
  });

  it('keeps the invitations when no request is open', async () => {
    const { element } = await render({
      active: { openCount: 0, request: null },
      requests: [request({ status: 'closed' })],
    });

    expect(element.querySelector('mf-active-request')).toBeNull();
    expect(invitation(element, 'search')).not.toBeNull();
  });

  it('draws the panel’s skeleton while reading and its error after a failed read', async () => {
    const loading = await render({
      active: new Promise<never>(() => undefined),
    });
    expect(
      loading.element.querySelector('mf-active-request [aria-busy="true"]'),
    ).not.toBeNull();
    TestBed.resetTestingModule();

    const failed = await render({ active: new Error('down') });
    expect(text(failed.element.querySelector('mf-active-request'))).toContain(
      'Nu am putut încărca cererea.',
    );
    expect(invitation(failed.element, 'search')).toBeNull();
  });

  it('reads it again from Reîncearcă', async () => {
    const { element, settle } = await render({ active: new Error('down') });
    activeRead.mockImplementation(() => Promise.resolve(answer));

    control(element.querySelector('mf-active-request'), 'Reîncearcă')?.click();
    await settle();

    expect(activeRead).toHaveBeenCalledTimes(2);
    expect(text(element.querySelector('mf-active-request'))).toContain(
      'BMW 320d',
    );
  });
});

// @traces 274-FR-020
describe('Cererea activă as the request moves', () => {
  it.each([
    'request.created',
    'request.declined',
    'quote.accepted',
    'booking.confirmed',
    'booking.lapsed',
    'quote.sent',
  ] as const)('reads it again on %s', async (kind) => {
    const { settle } = await render({ requests: [request()] });
    expect(activeRead).toHaveBeenCalledTimes(1);

    events.next({ at: new Date().toISOString(), id: 'x-1', kind });
    await new Promise((r) => setTimeout(r, 400));
    await settle();

    expect(activeRead).toHaveBeenCalledTimes(2);
  });

  it('reads it and the requests again after the live stream resyncs', async () => {
    const { settle } = await render({ requests: [request()] });

    resync.next();
    await new Promise((r) => setTimeout(r, 400));
    await settle();

    expect(activeRead).toHaveBeenCalledTimes(2);
    expect(requestsList).toHaveBeenCalledTimes(2);
  });

  it('keeps the newest answer when an older read lands last', async () => {
    let slow: (value: unknown) => void = () => {};
    const { element, settle } = await render({ requests: [request()] });
    activeRead.mockImplementationOnce(
      () => new Promise((resolve) => (slow = resolve)),
    );
    activeRead.mockImplementationOnce(async () => ({
      openCount: 0,
      request: null,
    }));

    events.next({
      at: new Date().toISOString(),
      id: 'x-1',
      kind: 'quote.sent',
    });
    await new Promise((r) => setTimeout(r, 400));
    events.next({
      at: new Date().toISOString(),
      id: 'x-2',
      kind: 'quote.sent',
    });
    await new Promise((r) => setTimeout(r, 400));
    await settle();
    slow(activeOf([request()]));
    await settle();

    expect(panel(element, 'activeRequest')).toBeNull();
  });
});

// @traces 275-FR-005
describe('Panou while the live stream is down', () => {
  it('passes the stream’s offline state to the active request, and drops the line once back', async () => {
    const { element, settle } = await render({
      cars: [car()],
      requests: [request()],
    });
    const line = () => element.querySelector('mf-active-request .reconnecting');
    expect(line()).toBeNull();

    offline.set(true);
    await settle();
    expect(text(line())).toBe('Reconectare…');

    offline.set(false);
    await settle();
    expect(line()).toBeNull();
  });
});

// @traces 1316-FR-001 1316-FR-002
describe('Panou opened again', () => {
  const opened = async () => {
    const fixture = TestBed.createComponent(DriverHome);
    fixture.detectChanges();
    return fixture;
  };

  it('shows the cars, the requests and the active request at once, read once in all', async () => {
    const first = await render({
      cars: [car()],
      requests: [request({ quotesCount: 2 })],
    });
    first.fixture.destroy();

    const again = await opened();
    const element = again.nativeElement as HTMLElement;

    expect(element.querySelector('[aria-busy="true"]')).toBeNull();
    expect(text(panel(element, 'cars'))).toContain('Dacia Logan');
    expect(panel(element, 'activeRequest')).not.toBeNull();
    await again.whenStable();
    expect(carsList).toHaveBeenCalledTimes(1);
    expect(requestsList).toHaveBeenCalledTimes(1);
    expect(activeRead).toHaveBeenCalledTimes(1);
  });

  it('reads the requests again past 30 seconds and the cars past 5 minutes', async () => {
    const start = Date.now();
    const clock = jest.spyOn(Date, 'now').mockReturnValue(start);
    try {
      const first = await render({ cars: [car()], requests: [request()] });
      first.fixture.destroy();

      clock.mockReturnValue(start + 30_000);
      const second = await opened();
      await second.whenStable();
      expect(carsList).toHaveBeenCalledTimes(1);
      expect(requestsList).toHaveBeenCalledTimes(2);
      expect(activeRead).toHaveBeenCalledTimes(2);
      second.destroy();

      clock.mockReturnValue(start + 300_000);
      const third = await opened();
      await third.whenStable();
      expect(carsList).toHaveBeenCalledTimes(2);
    } finally {
      clock.mockRestore();
    }
  });
});

// @traces 1316-FR-005
describe('a car changed on one view', () => {
  it('shows in Mașinile mele opened next when saved from Panou, with no read', async () => {
    const { element, fixture, settle } = await render();
    open.mockResolvedValueOnce(car({ id: 'car-9', model: 'Duster' }));
    control(invitation(element, 'car'), 'Adaugă o mașină')?.click();
    await settle();
    fixture.destroy();

    const cars = TestBed.createComponent(CarsView);
    cars.detectChanges();
    await cars.whenStable();

    expect(
      (cars.nativeElement as HTMLElement).querySelector('[data-car="car-9"]'),
    ).not.toBeNull();
    expect(carsList).toHaveBeenCalledTimes(1);
  });

  it('shows on Panou opened next when added on Mașinile mele, with no read', async () => {
    const { fixture } = await render({ cars: [car()] });
    fixture.destroy();
    const cars = TestBed.createComponent(CarsView);
    cars.detectChanges();
    await cars.whenStable();
    open.mockResolvedValueOnce(car({ id: 'car-9', model: 'Duster' }));
    control(cars.nativeElement as HTMLElement, 'Adaugă o mașină')?.click();
    for (let i = 0; i < 6; i++) {
      cars.detectChanges();
      await cars.whenStable();
    }
    cars.destroy();

    const again = TestBed.createComponent(DriverHome);
    again.detectChanges();

    expect(text(panel(again.nativeElement, 'cars'))).toContain('Dacia Duster');
    await again.whenStable();
    expect(carsList).toHaveBeenCalledTimes(1);
  });
});
