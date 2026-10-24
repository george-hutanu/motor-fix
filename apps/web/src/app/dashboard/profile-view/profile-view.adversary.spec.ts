import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import type { EventKind, LiveMessage } from '@motor-fix/contracts';
import { capabilitiesOf } from '@motor-fix/contracts/capabilities';
import {
  type GarageProfileDto,
  GaragesService,
  type MeDto,
} from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { filter, Subject } from 'rxjs';

import { ProfileView } from './profile-view';
import { Live } from '../live';
import { Session } from '../session';

const GARAGE = 'garage-1';

const WEEKDAY: string[][] = [['08:00', '19:00']];

const answer = (over: Partial<GarageProfileDto> = {}): GarageProfileDto => ({
  address: 'Str. Atelierului 14, Militari',
  brandNote: null,
  businessKind: 'company',
  closedDays: [],
  courtesyCar: { paid: false },
  doesNotTake: [
    { id: 'dacia', name: 'Dacia', slug: 'dacia' },
    { id: 'lada', name: 'Lada', slug: 'lada' },
  ],
  facilities: ['courtesy_car', 'waiting_area'],
  hours: {
    fri: WEEKDAY,
    mon: WEEKDAY,
    sat: [['09:00', '14:00']],
    sun: [],
    thu: WEEKDAY,
    tue: WEEKDAY,
    wed: WEEKDAY,
  },
  id: GARAGE,
  jobTypes: [],
  name: 'Service Auto Militari',
  paymentMethods: { card: true, cash: true, transfer: false },
  phone: '+40722123456',
  photos: [],
  prices: [],
  rating: null,
  refusalPhrase: null,
  responseRate: { state: 'new' },
  reviewCount: 0,
  slug: 'service-auto-militari',
  verifiedAt: null,
  worksOn: [
    {
      fuels: ['petrol', 'diesel', 'hybrid'],
      id: 'bmw',
      name: 'BMW',
      slug: 'bmw',
    },
    { fuels: ['diesel'], id: 'audi', name: 'Audi', slug: 'audi' },
  ],
  ...over,
});

const me = {
  // The owner's row: the legal check is hers.
  capabilities: capabilitiesOf('garage', {
    canAnswerQuotes: false,
    canMoveBookings: false,
    canRecordFinalPrice: false,
  }),
  garageAccess: [{ garageId: GARAGE, role: 'owner' }],
  garageId: GARAGE,
} as unknown as MeDto;

let events: Subject<LiveMessage>;
let resync: Subject<void>;
let read: jest.Mock;
let navigate: jest.Mock;

async function render(
  load: () => Promise<GarageProfileDto> = async () => answer(),
  language: 'ro' | 'en' = 'ro',
) {
  events = new Subject();
  resync = new Subject();
  read = jest.fn(load);
  navigate = jest.fn(async () => true);
  TestBed.configureTestingModule({
    providers: [
      {
        provide: GaragesService,
        // The legal check answers 404 (no file), so its host shows nothing
        // and these cases judge the profile panel alone.
        useValue: {
          garageProfileControllerRead: read,
          legalCheckControllerRead: async () => {
            throw new HttpErrorResponse({ status: 404, statusText: '404' });
          },
        },
      },
      { provide: Session, useValue: { shown: signal(me) } },
      { provide: Router, useValue: { navigateByUrl: navigate } },
      {
        provide: Live,
        useValue: {
          events,
          on: (kinds: readonly EventKind[]) =>
            events.pipe(
              filter((m) => (kinds as readonly string[]).includes(m.kind)),
            ),
          resync,
        },
      },
    ],
  });
  const i18n = TestBed.inject(I18n);
  await i18n.enter('garage');
  await i18n.enter('public');
  if (language === 'en') await i18n.use('en');
  const fixture = TestBed.createComponent(ProfileView);
  const element = fixture.nativeElement as HTMLElement;
  const settle = async () => {
    for (let i = 0; i < 4; i++) {
      fixture.detectChanges();
      await fixture.whenStable();
      await new Promise((r) => setTimeout(r, 0));
    }
  };
  return { element, fixture, settle };
}

const text = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
const all = (element: HTMLElement, selector: string) => [
  ...element.querySelectorAll<HTMLElement>(selector),
];
const line = (element: HTMLElement, name: string) =>
  element.querySelector<HTMLElement>(`[data-line="${name}"]`);
const message = (kind: string, id: string): LiveMessage => ({
  at: '2026-10-24T09:00:00.000Z',
  id,
  kind,
});
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const status = (code: number) =>
  new HttpErrorResponse({ status: code, statusText: String(code) });

afterEach(() => TestBed.resetTestingModule());

// @traces 133-FR-006
describe('Profilul service-ului under hostile data', () => {
  it('renders markup in the garage name as text', async () => {
    const { element, settle } = await render(async () =>
      answer({ name: '<img src=x onerror=alert(1)><b>Hack</b>' }),
    );
    await settle();

    expect(element.querySelector('img')).toBeNull();
    expect(element.querySelector('b')).toBeNull();
    expect(text(line(element, 'name'))).toContain('<b>Hack</b>');
  });

  it('hides the phone line when the phone is an empty string', async () => {
    const { element, settle } = await render(async () => answer({ phone: '' }));
    await settle();

    expect(line(element, 'phone')).toBeNull();
    expect(element.querySelector('[data-phone-tag]')).toBeNull();
  });

  it('shows no address and no seat for a mobile mechanic whose answer still carries coordinates', async () => {
    const { element, settle } = await render(async () =>
      answer({
        address: 'Str. Sediului 3, Chiajna',
        businessKind: 'mobile',
        latitude: 44.9365,
        longitude: 26.0129,
        serviceRadiusKm: 20,
      }),
    );
    await settle();

    expect(text(element)).not.toContain('Chiajna');
    expect(text(element)).not.toContain('44.9365');
    expect(line(element, 'address')).toBeNull();
  });

  it('shows a mobile mechanic with a radius of 100 km', async () => {
    const { element, settle } = await render(async () =>
      answer({ businessKind: 'mobile', serviceRadiusKm: 100 }),
    );
    await settle();

    expect(text(line(element, 'area'))).toBe('Zonă de lucru: 100 km');
  });

  it('shows one closed run when every day is closed, as the public profile', async () => {
    const { element, settle } = await render(async () =>
      answer({
        hours: {
          fri: [],
          mon: [],
          sat: [],
          sun: [],
          thu: [],
          tue: [],
          wed: [],
        },
      }),
    );
    await settle();

    expect(text(line(element, 'hours'))).toContain('Închis');
  });

  it('survives hours with a malformed time', async () => {
    const { element, settle } = await render(async () =>
      answer({
        hours: {
          mon: [['8am', 'late']],
        } as unknown as GarageProfileDto['hours'],
      }),
    );
    await settle();

    expect(text(line(element, 'name'))).toBe('Nume Service Auto Militari');
    expect(text(element)).not.toContain('NaN');
    expect(text(element)).not.toContain('late');
  });

  it('renders a very long name without dropping the other lines', async () => {
    const { element, settle } = await render(async () =>
      answer({ name: 'A'.repeat(5000) }),
    );
    await settle();

    expect(text(line(element, 'name'))).toBe(`Nume ${'A'.repeat(5000)}`);
    expect(line(element, 'phone')).not.toBeNull();
  });

  it('renders three hundred brands in the answer order', async () => {
    const many = Array.from({ length: 300 }, (_, i) => ({
      fuels: ['petrol'] as 'petrol'[],
      id: `b${i}`,
      name: `Marca ${i}`,
      slug: `marca-${i}`,
    }));
    const { element, settle } = await render(async () =>
      answer({ doesNotTake: [], worksOn: many }),
    );
    await settle();

    const names = all(element, '[data-works] li').map((li) =>
      text(li.querySelector('mf-lamp')),
    );
    expect(names).toHaveLength(300);
    expect(names[0]).toBe('Marca 0');
    expect(names[299]).toBe('Marca 299');
  });

  it('shows a taken brand with no fuel ticked without a fuel line of junk', async () => {
    const { element, settle } = await render(async () =>
      answer({
        worksOn: [{ fuels: [], id: 'bmw', name: 'BMW', slug: 'bmw' }],
      }),
    );
    await settle();

    const chip = all(element, '[data-works] li')[0];
    expect(text(chip)).not.toContain('undefined');
    expect(text(chip)).not.toContain('·');
  });

  it('puts fuels in the fixed order whatever order the answer gives', async () => {
    const { element, settle } = await render(async () =>
      answer({
        worksOn: [
          {
            fuels: ['electric', 'hybrid', 'diesel', 'petrol'],
            id: 'bmw',
            name: 'BMW',
            slug: 'bmw',
          },
        ],
      }),
    );
    await settle();

    expect(
      text(all(element, '[data-works] li')[0].querySelector('[data-fuels]')),
    ).toBe('benzină · motorină · hibrid · electric');
  });
});

// @traces 133-FR-008
describe('Profilul service-ului facilities at the edges', () => {
  const label = (element: HTMLElement) =>
    text(element.querySelector('[data-facility="courtesy_car"]'));

  it('prices a courtesy car at 50 bani without calling it free', async () => {
    const { element, settle } = await render(async () =>
      answer({ courtesyCar: { paid: true, pricePerDayBani: 50 } }),
    );
    await settle();

    expect(label(element)).not.toContain('gratuit');
    expect(label(element)).not.toContain('NaN');
  });

  it('shows a courtesy car listed with no terms without the word undefined', async () => {
    const { element, settle } = await render(async () =>
      answer({ courtesyCar: undefined, facilities: ['courtesy_car'] }),
    );
    await settle();

    expect(label(element)).not.toContain('undefined');
    expect(label(element)).toMatch(/^Mașină la schimb/);
  });

  it('shows a courtesy car in English as free', async () => {
    const { element, settle } = await render(undefined, 'en');
    await settle();

    expect(label(element)).toBe('Courtesy car · free');
  });

  it('shows the courtesy car as not offered when terms exist but it is unlisted', async () => {
    const { element, settle } = await render(async () =>
      answer({
        courtesyCar: { paid: true, pricePerDayBani: 15_000 },
        facilities: [],
      }),
    );
    await settle();

    expect(label(element)).toBe('Mașină la schimb: nu');
  });

  it('lists payment in the fixed order with all three ticked', async () => {
    const { element, settle } = await render(async () =>
      answer({ paymentMethods: { card: true, cash: true, transfer: true } }),
    );
    await settle();

    expect(text(element.querySelector('[data-payment]'))).toBe(
      'Plată: numerar, card, transfer',
    );
  });

  it('shows no payment line when the answer has no payment methods object', async () => {
    const { element, settle } = await render(async () =>
      answer({
        paymentMethods:
          undefined as unknown as GarageProfileDto['paymentMethods'],
      }),
    );
    await settle();

    expect(element.querySelector('[data-payment]')).toBeNull();
  });
});

// @traces 133-FR-009
describe('Profilul service-ului public link at the edges', () => {
  it('links a slug with reserved characters without breaking the path', async () => {
    const slug = 'auto service?x=1#y';
    const { element, settle } = await render(async () => answer({ slug }));
    await settle();

    expect(
      element.querySelector('[data-public-link]')?.getAttribute('href'),
    ).toBe(`/ro/garages/${encodeURIComponent(slug)}`);
  });
});

// @traces 133-FR-010
describe('Profilul service-ului failures at the edges', () => {
  it.each([500, 502, 0])(
    'shows the retry for a %s first read',
    async (code) => {
      const { element, settle } = await render(async () => {
        throw status(code);
      });
      await settle();

      expect(all(element, 'section [data-retry]')).toHaveLength(1);
      expect(navigate).not.toHaveBeenCalled();
    },
  );

  it('shows the retry when the read fails with a non-HTTP error', async () => {
    const { element, settle } = await render(async () => {
      throw new Error('boom');
    });
    await settle();

    expect(all(element, 'section [data-retry]')).toHaveLength(1);
  });

  it('reads at most twice more when the retry is clicked twice at once', async () => {
    let fail = true;
    const { element, settle } = await render(async () => {
      if (fail) throw status(503);
      return answer();
    });
    await settle();

    fail = false;
    const [retry] = all(element, 'section [data-retry]');
    retry.click();
    retry.click();
    await settle();

    expect(read.mock.calls.length).toBeLessThanOrEqual(3);
  });

  it('moves to the dashboard when a re-read answers 403', async () => {
    let denied = false;
    const { settle } = await render(async () => {
      if (denied) throw status(403);
      return answer();
    });
    await settle();

    denied = true;
    events.next(message('garage.updated', GARAGE));
    await wait(350);
    await settle();

    expect(navigate).toHaveBeenCalledWith('/app/garage');
  });

  it('shows the panel again when a suspended garage is approved back', async () => {
    let suspended = true;
    const { element, settle } = await render(async () => {
      if (suspended) throw status(410);
      return answer();
    });
    await settle();
    expect(element.querySelector('[data-suspended]')).not.toBeNull();

    suspended = false;
    events.next(message('garage.updated', GARAGE));
    await wait(350);
    await settle();

    expect(element.querySelector('[data-suspended]')).toBeNull();
    expect(
      all(element, 'section[aria-labelledby="mf-profile-public"]'),
    ).toHaveLength(1);
    expect(element.querySelector('[data-public-link]')).not.toBeNull();
  });
});

// @traces 133-FR-011
describe('Profilul service-ului live messages at the edges', () => {
  it('ignores a live kind it does not listen to', async () => {
    const { settle } = await render();
    await settle();

    events.next(message('booking.confirmed', GARAGE));
    events.next(message('garage.created', GARAGE));
    await wait(350);
    await settle();

    expect(read).toHaveBeenCalledTimes(1);
  });

  it('reads at most three times for a burst of ten messages', async () => {
    const { settle } = await render();
    await settle();

    for (let i = 0; i < 10; i++) events.next(message('garage.updated', GARAGE));
    await wait(800);
    await settle();

    expect(read.mock.calls.length).toBeLessThanOrEqual(3);
  });

  it('does not let an older slow answer overwrite a newer fast one', async () => {
    let calls = 0;
    const { element, settle } = await render(async () => {
      calls += 1;
      if (calls === 1) return answer({ name: 'Primul' });
      if (calls === 2) {
        await wait(400);
        return answer({ name: 'Vechi' });
      }
      return answer({ name: 'Nou' });
    });
    await settle();

    events.next(message('garage.updated', GARAGE));
    await wait(330);
    events.next(message('facility.removed', GARAGE));
    await wait(1200);
    await settle();

    expect(text(line(element, 'name'))).toBe('Nume Nou');
  });

  it('stops re-reading after the view is destroyed', async () => {
    const { fixture, settle } = await render();
    await settle();

    fixture.destroy();
    events.next(message('garage.updated', GARAGE));
    resync.next();
    await wait(400);

    expect(read).toHaveBeenCalledTimes(1);
  });
});
