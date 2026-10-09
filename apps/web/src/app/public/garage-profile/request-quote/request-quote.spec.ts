import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import {
  type CandidateGarageDto,
  type CarDto,
  CarsService,
  type PublicGarageDto,
  QuoteRequestsService,
  type RequestDto,
} from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';

import {
  RequestQuote,
  type RequestQuoteData,
  type RequestQuoteResult,
} from './request-quote';
import { PlaceStore } from '../../../home/place/place-store';

@Component({ template: '' })
class Host {
  readonly overlays = inject(Overlays);
}

const OIL = { id: 'job-oil', nameEn: 'Oil change', nameRo: 'Schimb ulei' };
const PADS = { id: 'job-pads', nameEn: 'Brake pads', nameRo: 'Plăcuțe frână' };

const GARAGE: PublicGarageDto = {
  brand: { id: 'b-1', name: 'Dacia', slug: 'dacia', stance: 'works_on' },
  brandNote: null,
  doesNotTake: [],
  id: 'g-militari',
  jobTypes: [OIL, PADS],
  name: 'Service Auto Militari',
  paymentMethods: { card: false, cash: false, transfer: false },
  photos: [],
  rating: null,
  refusalPhrase: null,
  responseRate: { state: 'new' },
  reviewCount: 0,
  slug: 'service-auto-militari',
  verifiedAt: null,
  worksOn: [{ fuels: ['petrol'], id: 'b-1', name: 'Dacia', slug: 'dacia' }],
};

const car = (id: string, model: string, year: number): CarDto => ({
  brandId: 'b-1',
  brandName: 'Dacia',
  createdAt: '2026-10-01T09:00:00.000Z',
  engine: null,
  fuel: 'petrol',
  id,
  itpUntil: null,
  model,
  odometerKm: 120000,
  plate: null,
  rcaUntil: null,
  rovinietaUntil: null,
  year,
});
const LOGAN = car('car-logan', 'Logan', 2017);
const DUSTER = car('car-duster', 'Duster', 2021);

const candidate = (
  id: string,
  name: string,
  distanceKm: number | null = 3.2,
): CandidateGarageDto => ({
  comesToYou: distanceKm === null,
  distanceKm,
  id,
  name,
  slug: id,
});

const sent = (names: string[]): RequestDto =>
  ({
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
    quotes: [],
    quotesCount: 0,
    recipients: names.map((name, i) => ({
      answeredAt: null,
      createdAt: '2026-10-09T09:00:00.000Z',
      garage: { id: `g-${i}`, name, slug: `g-${i}` },
      id: `r-${i}`,
      status: 'waiting',
    })),
    status: 'sent',
  }) as RequestDto;

const BUCHAREST = {
  label: 'Piața Unirii',
  lat: 44.4268,
  lng: 26.1025,
  origin: 'address' as const,
};

let list: jest.Mock;
let send: jest.Mock;
let nearby: jest.Mock;
let onSent: jest.Mock;

async function settle() {
  for (let i = 0; i < 6; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

let result: Promise<unknown>;

async function open(
  options: {
    cars?: CarDto[];
    candidates?: CandidateGarageDto[];
    place?: typeof BUCHAREST | null;
    source?: RequestQuoteData['source'];
    language?: 'ro' | 'en';
    garage?: PublicGarageDto;
  } = {},
) {
  list = jest.fn(async () => ({ items: options.cars ?? [LOGAN] }));
  send = jest.fn(async () => sent([GARAGE.name]));
  nearby = jest.fn(async () => ({ items: options.candidates ?? [] }));
  onSent = jest.fn();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: CarsService, useValue: { carsControllerList: list } },
      {
        provide: QuoteRequestsService,
        useValue: {
          quoteRequestsControllerCandidates: nearby,
          quoteRequestsControllerSend: send,
        },
      },
    ],
  });
  const place = options.place === undefined ? BUCHAREST : options.place;
  if (place) TestBed.inject(PlaceStore).use(place);
  await TestBed.inject(I18n).enter('public');
  if (options.language === 'en') await TestBed.inject(I18n).use('en');
  const host = TestBed.createComponent(Host);
  result = host.componentInstance.overlays.open<
    RequestQuoteResult,
    RequestQuoteData
  >(RequestQuote, {
    data: {
      garage: options.garage ?? GARAGE,
      sent: onSent,
      source: options.source ?? 'profile_direct',
    },
    shape: 'dialog',
    title: 'public.requestQuote.title',
  });
  await settle();
}

const panel = () =>
  document.querySelector<HTMLElement>('mf-overlay-panel') as HTMLElement;

const text = () => (panel().textContent ?? '').replace(/\s+/g, ' ');

const button = (name: string) =>
  [...panel().querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === name,
  ) as HTMLButtonElement | undefined;

const link = (name: string) =>
  [...panel().querySelectorAll<HTMLAnchorElement>('a')].find(
    (a) => a.textContent?.trim() === name,
  );

const select = () => panel().querySelector('select') as HTMLSelectElement;
const textarea = () => panel().querySelector('textarea') as HTMLTextAreaElement;

const jobSwitch = (name: string) =>
  [
    ...panel().querySelectorAll<HTMLButtonElement>('button[role="switch"]'),
  ].find((s) => s.getAttribute('aria-label') === name) as HTMLButtonElement;

const tick = (name: string) => {
  const label = [...panel().querySelectorAll('label.garage')].find((l) =>
    l.textContent?.includes(name),
  );
  return label?.querySelector('input[type="checkbox"]') as HTMLInputElement;
};

function type(value: string) {
  textarea().value = value;
  textarea().dispatchEvent(new Event('input', { bubbles: true }));
}

async function choose(id: string) {
  select().value = id;
  select().dispatchEvent(new Event('change', { bubbles: true }));
  await settle();
}

const press = async () => {
  button('Trimite')?.click();
  await settle();
};

const refusal = (status: number, body: Record<string, unknown>) =>
  new HttpErrorResponse({ error: body, status });

afterEach(() => {
  document.querySelectorAll('.cdk-overlay-container').forEach((n) => {
    n.innerHTML = '';
  });
  jest.restoreAllMocks();
});

// @traces 221-FR-002, 221-FR-003, 221-FR-013, 221-FR-017
describe('the quote request dialog', () => {
  it('preselects the only car, lists the garage’s jobs switched off and offers Trimite', async () => {
    await open();

    expect(panel().querySelector('h2')?.textContent?.trim()).toBe(
      'Cere ofertă',
    );
    expect(select().value).toBe(LOGAN.id);
    expect(select().selectedOptions[0].textContent?.trim()).toBe(
      'Dacia Logan 2017',
    );
    expect(jobSwitch('Schimb ulei').getAttribute('aria-checked')).toBe('false');
    expect(jobSwitch('Plăcuțe frână').getAttribute('aria-checked')).toBe(
      'false',
    );
    expect(button('Trimite')).toBeDefined();
  });

  it('chooses no car for the driver who has several', async () => {
    await open({ cars: [DUSTER, LOGAN] });

    expect(select().value).toBe('');
    expect(
      [...select().options].map((o) => o.textContent?.trim()).slice(1),
    ).toEqual(['Dacia Duster 2021', 'Dacia Logan 2017']);
  });

  it('asks for a car first, with a link to Mașinile mele and no Trimite', async () => {
    await open({ cars: [] });

    expect(text()).toContain('Adaugă mai întâi o mașină');
    const link = panel().querySelector<HTMLAnchorElement>('a[href]');
    expect(link?.getAttribute('href')).toBe('/app/driver/cars');
    expect(button('Trimite')).toBeUndefined();
    expect(select()).toBeNull();
  });

  it('counts the description as it is typed and marks the limit', async () => {
    await open();

    type('Scârțâie frâna');
    await settle();
    expect(text()).toContain('14/1000');

    type('a'.repeat(1000));
    await settle();
    const counter = panel().querySelector('.counter');
    expect(counter?.textContent?.trim()).toBe('1000/1000');
    expect(counter?.classList).toContain('full');
    expect(textarea().maxLength).toBe(1000);
  });

  it('sends nothing with no job and a description under 10 characters', async () => {
    await open();

    type('Frâna');
    await press();

    expect(send).not.toHaveBeenCalled();
    expect(text()).toContain('Scrie cel puțin 10 caractere');
  });

  it('sends the car, the profile’s garage as profile_direct and the jobs switched on, then confirms', async () => {
    await open();

    jobSwitch('Schimb ulei').click();
    await settle();
    await press();

    expect(send).toHaveBeenCalledTimes(1);
    const [params] = send.mock.calls[0];
    expect(params['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/);
    expect(params.body).toEqual({
      carId: LOGAN.id,
      description: null,
      garageIds: [GARAGE.id],
      jobTypeIds: [OIL.id],
      sources: ['profile_direct'],
    });
    expect(text()).toContain('Trimis către Service Auto Militari.');
    const link = [...panel().querySelectorAll<HTMLAnchorElement>('a')].find(
      (a) => a.textContent?.trim() === 'Vezi Cererile mele',
    );
    expect(link?.getAttribute('href')).toBe('/app/driver/requests');
    expect(select()).toBeNull();
    expect(onSent).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'req-1' }),
    );
  });

  // A link out closes the dialog and leaves the navigation to the opener:
  // closing steps back over the dialog's history entry, which would undo a
  // navigation the link had already started.
  it('closes on Vezi Cererile mele and hands the opener where to go', async () => {
    await open();
    const navigate = jest.spyOn(TestBed.inject(Router), 'navigateByUrl');
    jobSwitch('Schimb ulei').click();
    await settle();
    await press();

    link('Vezi Cererile mele')?.click();

    await expect(result).resolves.toEqual({ go: '/app/driver/requests' });
    expect(navigate).not.toHaveBeenCalled();
  });

  it('closes on Adaugă o mașină and hands the opener Mașinile mele', async () => {
    await open({ cars: [] });
    const navigate = jest.spyOn(TestBed.inject(Router), 'navigateByUrl');

    panel().querySelector<HTMLAnchorElement>('a[href]')?.click();

    await expect(result).resolves.toEqual({ go: '/app/driver/cars' });
    expect(navigate).not.toHaveBeenCalled();
  });

  it('sends a description-only request trimmed', async () => {
    await open();

    type('  Scârțâie la frânare  ');
    await press();

    expect(send.mock.calls[0][0].body).toMatchObject({
      description: 'Scârțâie la frânare',
      jobTypeIds: [],
    });
  });

  it('names the profile’s garage shared_link when the page came from a shared link', async () => {
    await open({ source: 'shared_link' });

    type('Scârțâie la frânare');
    await press();

    expect(send.mock.calls[0][0].body.sources).toEqual(['shared_link']);
  });

  it('keeps every value after a failed send and retries with the same key', async () => {
    await open();
    send.mockRejectedValueOnce(refusal(500, { code: 'error' }));

    type('Scârțâie la frânare');
    await press();

    expect(textarea().value).toBe('Scârțâie la frânare');
    expect(panel().querySelector('mf-task-error')?.textContent).not.toBe('');
    await press();

    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1][0]['Idempotency-Key']).toBe(
      send.mock.calls[0][0]['Idempotency-Key'],
    );
    expect(text()).toContain('Trimis către Service Auto Militari.');
  });

  it('says the daily limit is reached on a 429', async () => {
    await open();
    send.mockRejectedValueOnce(
      refusal(429, { code: 'too_many_requests', status: 429 }),
    );

    type('Scârțâie la frânare');
    await press();

    expect(text()).toContain(
      'Ai trimis deja 20 de cereri azi. Încearcă mâine.',
    );
  });

  it('disables Trimite offline, keeps the text and comes back online', async () => {
    const online = jest.spyOn(navigator, 'onLine', 'get');
    online.mockReturnValue(false);
    await open();
    type('Scârțâie la frânare');
    window.dispatchEvent(new Event('offline'));
    await settle();

    expect(button('Trimite')?.disabled).toBe(true);
    // Nothing is queued: the line promises no send, only that Trimite comes back.
    expect(text()).toContain(
      'Fără conexiune. O poți trimite după ce revii online.',
    );

    online.mockReturnValue(true);
    window.dispatchEvent(new Event('online'));
    await settle();

    expect(button('Trimite')?.disabled).toBe(false);
    expect(textarea().value).toBe('Scârțâie la frânare');
  });

  it('speaks English', async () => {
    await open({ language: 'en' });

    expect(panel().querySelector('h2')?.textContent?.trim()).toBe(
      'Request a quote',
    );
    expect(jobSwitch('Oil change')).toBeDefined();
    expect(button('Send')).toBeDefined();
  });
});

// @traces 221-FR-006, 221-FR-016, 221-FR-017
describe('the garage picker', () => {
  it('starts with the profile’s garage ticked and locked', async () => {
    await open();

    expect(tick('Service Auto Militari').checked).toBe(true);
    expect(tick('Service Auto Militari').disabled).toBe(true);
  });

  it('reads the garages near the place for the car and the jobs, leaving out the profile’s', async () => {
    await open({ candidates: [candidate('g-berceni', 'Atelier Berceni')] });

    expect(nearby).toHaveBeenLastCalledWith({
      carId: LOGAN.id,
      exclude: GARAGE.id,
      near: '44.427,26.103',
    });
    expect(text()).toContain('Atelier Berceni');

    jobSwitch('Schimb ulei').click();
    await new Promise((resolve) => setTimeout(resolve, 350));
    await settle();

    expect(nearby).toHaveBeenLastCalledWith({
      carId: LOGAN.id,
      exclude: GARAGE.id,
      jobTypeIds: OIL.id,
      near: '44.427,26.103',
    });
  });

  it('shows a skeleton while the garages load', async () => {
    let finish: (value: { items: CandidateGarageDto[] }) => void = () => {};
    await open();
    nearby.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await choose('');
    await choose(LOGAN.id);

    expect(panel().querySelector('.picker [aria-busy="true"]')).not.toBeNull();
    finish({ items: [candidate('g-berceni', 'Atelier Berceni')] });
    await settle();
    expect(panel().querySelector('.picker [aria-busy="true"]')).toBeNull();
  });

  it('says so in one line without a place and offers the place picker', async () => {
    await open({ place: null });

    expect(nearby).not.toHaveBeenCalled();
    expect(text()).toContain(
      'Alege un loc ca să vezi și alte service‑uri din apropiere.',
    );
    expect(button('Alege locul')).toBeDefined();
  });

  it('sends the ticked garages as search after the profile’s', async () => {
    await open({
      candidates: [
        candidate('g-berceni', 'Atelier Berceni'),
        candidate('g-mobil', 'Mecanic Mobil', null),
      ],
    });

    expect(text()).toContain('Vine la tine');
    tick('Mecanic Mobil').click();
    await settle();
    type('Scârțâie la frânare');
    await press();

    expect(send.mock.calls[0][0].body).toMatchObject({
      garageIds: [GARAGE.id, 'g-mobil'],
      sources: ['profile_direct', 'search'],
    });
  });

  it('refuses a sixth tick with the limit text', async () => {
    const five = ['A', 'B', 'C', 'D', 'E'].map((letter) =>
      candidate(`g-${letter}`, `Atelier ${letter}`),
    );
    await open({ candidates: five });

    for (const letter of ['A', 'B', 'C', 'D']) {
      tick(`Atelier ${letter}`).click();
      await settle();
    }
    tick('Atelier E').click();
    await settle();

    expect(tick('Atelier E').checked).toBe(false);
    expect(text()).toContain('Poți alege cel mult 5 service‑uri');
  });

  it('words the limit in English as FR-006 does', async () => {
    const five = ['A', 'B', 'C', 'D', 'E'].map((letter) =>
      candidate(`g-${letter}`, `Atelier ${letter}`),
    );
    await open({ candidates: five, language: 'en' });

    for (const letter of ['A', 'B', 'C', 'D', 'E']) {
      tick(`Atelier ${letter}`).click();
      await settle();
    }

    expect(text()).toContain('You can pick at most 5 garages.');
  });

  it('names a car brand the garage does not take under the car and holds Trimite', async () => {
    await open({ garage: { ...GARAGE, worksOn: [] } });

    expect(text()).toContain('Nu lucrează pe Dacia');
    expect(button('Trimite')?.disabled).toBe(true);
  });

  it('names a fuel the garage does not take for the brand and holds Trimite', async () => {
    await open({ cars: [{ ...LOGAN, fuel: 'diesel' }] });

    expect(text()).toContain('Nu lucrează pe motorină la Dacia');
    expect(button('Trimite')?.disabled).toBe(true);
  });

  it('lets a car the garage takes be sent', async () => {
    await open();

    expect(text()).not.toContain('Nu lucrează pe');
    expect(button('Trimite')?.disabled).toBe(false);
  });

  it('unticks a garage that cannot receive and names the reason', async () => {
    await open({ candidates: [candidate('g-berceni', 'Atelier Berceni')] });
    send.mockRejectedValueOnce(
      refusal(400, {
        code: 'garage_cannot_receive',
        garageId: 'g-berceni',
        garageName: 'Atelier Berceni',
        reason: 'fuel',
        status: 400,
      }),
    );
    tick('Atelier Berceni').click();
    await settle();
    type('Scârțâie la frânare');
    await press();

    expect(tick('Atelier Berceni').checked).toBe(false);
    expect(text()).toContain(
      'Atelier Berceni nu lucrează pe benzină la Dacia.',
    );
    await press();
    expect(send.mock.calls[1][0].body.garageIds).toEqual([GARAGE.id]);
  });

  it('reads a refusal reason it does not know as the garage not taking requests', async () => {
    await open();
    send.mockRejectedValueOnce(
      refusal(400, {
        code: 'garage_cannot_receive',
        garageId: GARAGE.id,
        garageName: GARAGE.name,
        reason: 'closed_for_holidays',
        status: 400,
      }),
    );
    type('Scârțâie la frânare');
    await press();

    expect(text()).toContain('Service Auto Militari nu primește cereri acum.');
  });

  const back = () =>
    [...panel().querySelectorAll('a')].some(
      (a) => a.textContent?.trim() === 'Înapoi la căutare',
    );

  // FR-007: the way back follows the reason, whichever garage it names.
  it('offers the way back to the search when a picked garage stopped taking requests', async () => {
    await open({ candidates: [candidate('g-berceni', 'Atelier Berceni')] });
    send.mockRejectedValueOnce(
      refusal(400, {
        code: 'garage_cannot_receive',
        garageId: 'g-berceni',
        garageName: 'Atelier Berceni',
        reason: 'not_taking_requests',
        status: 400,
      }),
    );
    tick('Atelier Berceni').click();
    await settle();
    type('Scârțâie la frânare');
    await press();

    expect(back()).toBe(true);
  });

  it('closes on Înapoi la căutare and hands the opener the search for the brand', async () => {
    await open();
    send.mockRejectedValueOnce(
      refusal(400, {
        code: 'garage_cannot_receive',
        garageId: GARAGE.id,
        garageName: GARAGE.name,
        reason: 'not_taking_requests',
        status: 400,
      }),
    );
    type('Scârțâie la frânare');
    await press();

    link('Înapoi la căutare')?.click();

    await expect(result).resolves.toEqual({ go: '/ro/garages?brand=dacia' });
  });

  it('keeps the way back away when the profile’s garage does not do the jobs', async () => {
    await open();
    send.mockRejectedValueOnce(
      refusal(400, {
        code: 'garage_cannot_receive',
        garageId: GARAGE.id,
        garageName: GARAGE.name,
        reason: 'jobs',
        status: 400,
      }),
    );
    type('Scârțâie la frânare');
    await press();

    expect(text()).toContain('Service Auto Militari');
    expect(back()).toBe(false);
  });

  it('offers the way back to the search when the profile’s garage stopped taking requests', async () => {
    await open();
    send.mockRejectedValueOnce(
      refusal(400, {
        code: 'garage_cannot_receive',
        garageId: GARAGE.id,
        garageName: GARAGE.name,
        reason: 'not_taking_requests',
        status: 400,
      }),
    );
    type('Scârțâie la frânare');
    await press();

    expect(text()).toContain('Service Auto Militari nu primește cereri acum.');
    expect(
      [...panel().querySelectorAll('a')].some(
        (a) => a.textContent?.trim() === 'Înapoi la căutare',
      ),
    ).toBe(true);
  });
});
