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

const ERROR = 'Ceva nu a mers. Încearcă din nou.';

// @traces 030-FR-002
describe('which requests are active', () => {
  it.each(['sent', 'quoted', 'booked', 'in_work'] as const)(
    'counts a %s request as active',
    async (status) => {
      const { element } = await render({
        cars: [car()],
        requests: [request({ status })],
      });

      expect(panel(element, 'activeRequest')).not.toBeNull();
      expect(invitation(element, 'search')).toBeNull();
    },
  );

  it('shows the active panel when one sent request sits among finished ones', async () => {
    const { element } = await render({
      cars: [car()],
      requests: [
        request({ id: 'a', status: 'done' }),
        request({ id: 'b', status: 'closed' }),
        request({ id: 'c', status: 'sent' }),
        request({ id: 'd', status: 'done' }),
      ],
    });

    expect(panel(element, 'activeRequest')).not.toBeNull();
    expect(invitation(element, 'search')).toBeNull();
  });

  it('shows the invitations when every request of a long list is finished', async () => {
    const requests = Array.from({ length: 2000 }, (_, i) =>
      request({ id: `r${i}`, status: i % 2 ? 'done' : 'closed' }),
    );
    const { element } = await render({ requests });

    expect(panel(element, 'activeRequest')).toBeNull();
    expect(invitation(element, 'car')).not.toBeNull();
    expect(invitation(element, 'search')).not.toBeNull();
  });

  it('never shows the active panel and the invitations together', async () => {
    const { element } = await render({ requests: [request()] });

    expect(element.querySelectorAll('[data-invitation]')).toHaveLength(0);
    expect(
      element.querySelectorAll('[data-panel="activeRequest"]'),
    ).toHaveLength(1);
  });
});

// @traces 030-FR-006
describe('quotes and repairs counted from the requests', () => {
  it('keeps quotes empty for a quoted request whose quotesCount is 0', async () => {
    const { element } = await render({
      requests: [request({ quotesCount: 0, status: 'quoted' })],
    });

    expect(text(panel(element, 'quotes'))).toContain(EMPTY.quotes);
    expect(panel(element, 'quotes')?.querySelector('h2 a')).toBeNull();
  });

  it('fills quotes when only a closed request carries a quote', async () => {
    const { element } = await render({
      requests: [
        request({ id: 'a', quotesCount: 0 }),
        request({ id: 'b', quotesCount: 3, status: 'closed' }),
      ],
    });

    expect(text(panel(element, 'quotes'))).not.toContain(EMPTY.quotes);
    expect(panel(element, 'quotes')?.querySelector('h2 a')).not.toBeNull();
  });

  it('keeps repairs empty while requests are only booked or in work', async () => {
    const { element } = await render({
      requests: [
        request({ id: 'a', status: 'booked' }),
        request({ id: 'b', status: 'in_work' }),
      ],
    });

    expect(text(panel(element, 'repairs'))).toContain(EMPTY.repairs);
  });

  it('shows the quotes empty state, not the error, for a request list that is empty', async () => {
    const { element } = await render();

    expect(
      panel(element, 'quotes')?.querySelector('[role="alert"]'),
    ).toBeNull();
  });
});

describe('one list failing while the other succeeds', () => {
  it('does not claim the driver has no car when the cars could not be read', async () => {
    const { element } = await render({ cars: new Error('down') });

    expect(invitation(element, 'car')).toBeNull();
    expect(text(panel(element, 'cars'))).not.toContain(EMPTY.cars);
    expect(text(panel(element, 'cars'))).toContain(ERROR);
  });

  it('shows the error in quotes and repairs and not their empty texts when the requests failed', async () => {
    const { element } = await render({ requests: new Error('down') });

    for (const key of ['quotes', 'repairs']) {
      expect(text(panel(element, key))).toContain(ERROR);
    }
    expect(text(panel(element, 'quotes'))).not.toContain(EMPTY.quotes);
    expect(text(panel(element, 'repairs'))).not.toContain(EMPTY.repairs);
  });

  it('shows no empty text or invitation when both lists failed', async () => {
    const { element } = await render({
      cars: new Error('down'),
      requests: new Error('down'),
    });

    expect(text(element)).not.toContain(EMPTY.cars);
    expect(text(element)).not.toContain(EMPTY.quotes);
    expect(text(element)).not.toContain(EMPTY.repairs);
    expect(invitation(element, 'car')).toBeNull();
    expect(invitation(element, 'search')).toBeNull();
  });

  it('shows the cars in their panel when the requests failed', async () => {
    const { element } = await render({
      cars: [car()],
      requests: new Error('down'),
    });

    expect(text(panel(element, 'cars'))).not.toContain(EMPTY.cars);
    expect(text(panel(element, 'cars'))).not.toContain(ERROR);
  });

  it('treats an answer without items as a failed read, not as an empty list', async () => {
    const { element } = await render({
      cars: Promise.resolve({}) as unknown as Promise<never>,
    });

    expect(text(panel(element, 'cars'))).not.toContain(EMPTY.cars);
  });
});

// @traces 030-FR-011
describe('the saved garages capability', () => {
  it('shows no saved text at all without the capability, in either language', async () => {
    const without = DRIVER.filter((c) => c !== 'driver.saved_garages');
    const ro = await render({ capabilities: without });
    expect(text(ro.element)).not.toContain(EMPTY.saved);
    expect(text(ro.element)).not.toContain('Caută altele');
    TestBed.resetTestingModule();

    const en = await render({ capabilities: without, language: 'en' });
    expect(text(en.element)).not.toContain(EMPTY_EN.saved);
    expect(panels(en.element)).not.toContain('saved');
  });

  it('shows no saved panel to a session with no capabilities at all', async () => {
    const { element } = await render({ capabilities: [] });

    expect(panels(element)).toEqual(['quotes', 'cars', 'repairs']);
  });

  it('does not read any list for the saved panel', async () => {
    await render();

    expect(carsList).toHaveBeenCalledTimes(1);
    expect(requestsList).toHaveBeenCalledTimes(1);
  });
});

// @traces 030-FR-003
describe('Panou actions', () => {
  it('opens one dialog per press and keeps every empty state when it is cancelled', async () => {
    const { element, settle } = await render();

    control(panel(element, 'cars'), 'Adaugă o mașină')?.click();
    await settle();
    control(invitation(element, 'car'), 'Adaugă o mașină')?.click();
    await settle();

    expect(open).toHaveBeenCalledTimes(2);
    expect(text(panel(element, 'cars'))).toContain(EMPTY.cars);
    expect(invitation(element, 'car')).not.toBeNull();
  });

  it('takes the car invitation away when the car is saved from the Mașinile mele panel', async () => {
    const { element, settle } = await render();
    open.mockResolvedValueOnce(car());

    control(panel(element, 'cars'), 'Adaugă o mașină')?.click();
    await settle();

    expect(invitation(element, 'car')).toBeNull();
    expect(text(panel(element, 'cars'))).not.toContain(EMPTY.cars);
    expect(
      panel(element, 'cars')?.querySelector('h2 a')?.getAttribute('href'),
    ).toBe('/app/driver/cars');
    expect(carsList).toHaveBeenCalledTimes(1);
  });

  it('keeps the active request panel when a car is saved', async () => {
    const { element, settle } = await render({ requests: [request()] });
    open.mockResolvedValueOnce(car());

    control(panel(element, 'cars'), 'Adaugă o mașină')?.click();
    await settle();

    expect(panel(element, 'activeRequest')).not.toBeNull();
    expect(invitation(element, 'search')).toBeNull();
  });

  it('gives every empty state at most one action', async () => {
    const { element } = await render();

    const states = [...element.querySelectorAll('mf-empty-state')];
    expect(states.length).toBeGreaterThanOrEqual(5);
    for (const state of states) {
      expect(state.querySelectorAll('a, button').length).toBeLessThanOrEqual(1);
    }
  });

  it('never shows the generic empty text', async () => {
    const { element } = await render();

    expect(text(element)).not.toContain('Nimic aici încă.');
  });
});

// @traces 030-FR-010
describe('switching language while Panou is open', () => {
  it('rewrites every empty text, heading and Home link in English without a new read', async () => {
    const { element, settle } = await render();
    await TestBed.inject(I18n).use('en');
    await settle();

    expect(text(panel(element, 'quotes'))).toContain(EMPTY_EN.quotes);
    expect(text(panel(element, 'cars'))).toContain(EMPTY_EN.cars);
    expect(text(panel(element, 'repairs'))).toContain(EMPTY_EN.repairs);
    expect(text(panel(element, 'saved'))).toContain(EMPTY_EN.saved);
    expect(text(invitation(element, 'car'))).toContain('Add your first car');
    expect(text(panel(element, 'quotes')?.querySelector('h2'))).toBe(
      'Quotes received',
    );
    expect(
      control(invitation(element, 'search'), 'Find a garage')?.getAttribute(
        'href',
      ),
    ).toBe('/en');
    expect(carsList).toHaveBeenCalledTimes(1);
  });

  it('leaves no Romanian empty text behind after switching', async () => {
    const { element, settle } = await render();
    await TestBed.inject(I18n).use('en');
    await settle();

    expect(text(element)).not.toContain('Nicio reparație');
    expect(text(element)).not.toContain('Încă nu ai oferte');
    expect(text(element)).not.toContain('Caută un service');
  });
});
