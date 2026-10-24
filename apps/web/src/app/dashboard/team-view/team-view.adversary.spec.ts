import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import type { EventKind, LiveMessage } from '@motor-fix/contracts';
import {
  type GarageMechanicDto,
  type GarageMechanicsDto,
  GaragesService,
  type MeDto,
} from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';
import { filter, Subject } from 'rxjs';

import { TeamView } from './team-view';
import { Live } from '../live';
import { MechanicCard } from '../mechanic-card/mechanic-card';
import { Session } from '../session';

const GARAGE = '0f9c2a54-6a1e-4f43-9d2b-2f5a3c1d7e10';
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const mechanic = (
  over: Partial<GarageMechanicDto> = {},
): GarageMechanicDto => ({
  brandIds: [],
  certifications: [],
  futureBookings: 0,
  hasAccount: true,
  id: 'mechanic-1',
  isOwner: false,
  name: 'Andrei Popescu',
  onProfile: true,
  rating: '4.9',
  reviewCount: 58,
  roleTitle: null,
  speciality: 'Frâne, suspensie',
  specialties: ['Frâne', 'suspensie'],
  years: null,
  ...over,
});

const SEEDED = [
  mechanic(),
  mechanic({
    hasAccount: false,
    id: 'mechanic-2',
    name: 'Costel Radu',
    onProfile: false,
    rating: null,
    reviewCount: 0,
    speciality: null,
  }),
  mechanic({
    id: 'mechanic-3',
    name: 'Tudor Ilie',
    onProfile: false,
    rating: '4.5',
    reviewCount: 1,
    speciality: 'Electrică',
  }),
];

const me = {
  garageAccess: [{ garageId: GARAGE, role: 'owner' }],
  garageId: GARAGE,
  landing: '/app/garage',
} as unknown as MeDto;

let events: Subject<LiveMessage>;
let resync: Subject<void>;
let list: jest.Mock;
let open: jest.Mock;
let navigateByUrl: jest.Mock;

async function render(
  answer: () => Promise<GarageMechanicsDto> = async () => ({
    brands: [],
    items: SEEDED,
  }),
  language: 'ro' | 'en' = 'ro',
) {
  events = new Subject();
  resync = new Subject();
  list = jest.fn(answer);
  open = jest.fn(async () => 'cancelled');
  navigateByUrl = jest.fn(async () => true);
  TestBed.configureTestingModule({
    providers: [
      {
        provide: GaragesService,
        useValue: { garageMechanicsControllerList: list },
      },
      { provide: Session, useValue: { shown: signal(me) } },
      { provide: Overlays, useValue: { open } },
      { provide: Router, useValue: { navigateByUrl } },
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
  await TestBed.inject(I18n).enter('garage');
  if (language === 'en') await TestBed.inject(I18n).use('en');
  const fixture = TestBed.createComponent(TeamView);
  const element = fixture.nativeElement as HTMLElement;
  const settle = async () => {
    for (let i = 0; i < 3; i++) {
      fixture.detectChanges();
      await fixture.whenStable();
    }
  };
  return { element, settle };
}

const text = (element: Element | null) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
const rows = (element: HTMLElement) => [
  ...element.querySelectorAll<HTMLElement>('[data-mechanic]'),
];
const lamp = (row: HTMLElement) =>
  row.querySelector<HTMLElement>('[data-state]');
const countLine = (element: HTMLElement) =>
  element.querySelector('[data-count]');
const message = (kind: string, id = 'mechanic-1') =>
  ({ at: '2026-10-24T09:00:00.000Z', id, kind }) as LiveMessage;

afterEach(() => TestBed.resetTestingModule());

// @traces 055-FR-007 055-FR-008
describe('Mecanici, plural boundaries', () => {
  const cellOf = async (count: number) => {
    const { element, settle } = await render(async () => ({
      brands: [],
      items: [mechanic({ rating: '4.0', reviewCount: count })],
    }));
    await settle();
    const cell = text(rows(element)[0].querySelector('[data-rating]'));
    TestBed.resetTestingModule();
    return cell;
  };
  const lineOf = async (n: number) => {
    const { element, settle } = await render(async () => ({
      brands: [],
      items: Array.from({ length: n }, (_, i) => mechanic({ id: `m-${i}` })),
    }));
    await settle();
    const line = text(countLine(element));
    TestBed.resetTestingModule();
    return line;
  };

  it.each([
    [3, '4,0 · 3 recenzii'],
    [19, '4,0 · 19 recenzii'],
    [21, '4,0 · 21 de recenzii'],
    [100, '4,0 · 100 de recenzii'],
    [101, '4,0 · 101 recenzii'],
    [119, '4,0 · 119 recenzii'],
    [120, '4,0 · 120 de recenzii'],
  ])('reads %i reviews with the Romanian plural', async (count, expected) => {
    expect(await cellOf(count)).toBe(expected);
  });

  it.each([
    [19, '19 mecanici pe profil'],
    [21, '21 de mecanici pe profil'],
    [101, '101 mecanici pe profil'],
    [120, '120 de mecanici pe profil'],
  ])(
    'counts %i mechanics on the profile with the Romanian plural',
    async (n, expected) => {
      expect(await lineOf(n)).toBe(expected);
    },
  );
});

// @traces 055-FR-006 055-FR-007 055-FR-013
describe('Mecanici, awkward rows', () => {
  it('shows no rating when the count is 0 even if a rating value came with it', async () => {
    const { element, settle } = await render(async () => ({
      brands: [],
      items: [mechanic({ rating: '4.9', reviewCount: 0 })],
    }));
    await settle();

    expect(text(rows(element)[0].querySelector('[data-rating]'))).toBe(
      'fără recenzii',
    );
  });

  it('shows no rating when a count came with a null rating', async () => {
    const { element, settle } = await render(async () => ({
      brands: [],
      items: [mechanic({ rating: null, reviewCount: 5 })],
    }));
    await settle();

    const cell = text(rows(element)[0].querySelector('[data-rating]'));
    expect(cell).not.toContain('NaN');
    expect(cell).toBe('fără recenzii');
  });

  it('shows an empty-string speciality as no speciality', async () => {
    const { element, settle } = await render(async () => ({
      brands: [],
      items: [mechanic({ speciality: '' })],
    }));
    await settle();

    expect(rows(element)[0].querySelector('.speciality')).toBeNull();
  });

  it('shows a whitespace-only speciality as no speciality', async () => {
    const { element, settle } = await render(async () => ({
      brands: [],
      items: [mechanic({ speciality: '   ' })],
    }));
    await settle();

    expect(rows(element)[0].querySelector('.speciality')).toBeNull();
  });

  it('keeps two cards of the same name as two rows', async () => {
    const { element, settle } = await render(async () => ({
      brands: [],
      items: [mechanic({ id: 'a' }), mechanic({ id: 'b' })],
    }));
    await settle();

    expect(rows(element)).toHaveLength(2);
  });

  it('renders a thousand rows in the order given', async () => {
    const items = Array.from({ length: 1000 }, (_, i) =>
      mechanic({ id: `m-${i}`, name: `Mecanic ${i}` }),
    );
    const { element, settle } = await render(async () => ({
      brands: [],
      items,
    }));
    await settle();

    const shown = rows(element).map((r) => text(r.querySelector('.name')));
    expect(shown).toHaveLength(1000);
    expect(shown[0]).toBe('Mecanic 0');
    expect(shown[999]).toBe('Mecanic 999');
  });

  it('keeps a very long name in its row without a second row', async () => {
    const long = 'Ion '.repeat(60).trim();
    const { element, settle } = await render(async () => ({
      brands: [],
      items: [mechanic({ name: long })],
    }));
    await settle();

    expect(rows(element)).toHaveLength(1);
    expect(text(rows(element)[0].querySelector('.name'))).toBe(long);
  });

  it('says a card with no account and on the profile is on the profile', async () => {
    const { element, settle } = await render(async () => ({
      brands: [],
      items: [mechanic({ hasAccount: false, onProfile: true })],
    }));
    await settle();

    expect(text(lamp(rows(element)[0]))).toBe('pe profil');
  });
});

// @traces 055-FR-009 055-FR-010
describe('Mecanici, states under failure', () => {
  it('shows the retry panel for a network error with nothing loaded', async () => {
    const { element, settle } = await render(async () => {
      throw new HttpErrorResponse({ status: 0 });
    });
    await settle();

    expect(text(element.querySelector('[role="alert"]'))).toBe(
      'Nu am putut încărca echipa. Reîncearcă.',
    );
    expect(navigateByUrl).not.toHaveBeenCalled();
  });

  it.each([401, 403, 500, 503])(
    'shows the retry panel and does not leave for a %i',
    async (status) => {
      const { element, settle } = await render(async () => {
        throw new HttpErrorResponse({ status });
      });
      await settle();

      expect(element.querySelector('[role="alert"]')).not.toBeNull();
      expect(navigateByUrl).not.toHaveBeenCalled();
    },
  );

  it('shows the failure in English', async () => {
    const { element, settle } = await render(async () => {
      throw new HttpErrorResponse({ status: 500 });
    }, 'en');
    await settle();

    expect(text(element.querySelector('[role="alert"]'))).toBe(
      'We could not load the team. Try again.',
    );
  });

  it('shows the empty state in English with its button', async () => {
    const { element, settle } = await render(
      async () => ({ brands: [], items: [] }),
      'en',
    );
    await settle();

    expect(text(element.querySelector('mf-empty-state'))).toContain(
      'You have not added mechanics yet',
    );
    expect(
      [...element.querySelectorAll('button')].map((b) => text(b)),
    ).toContain('Add a mechanic');
  });

  it('keeps the empty state, not the failure, after a re-read that returns nothing', async () => {
    let items = SEEDED;
    const { element, settle } = await render(async () => ({
      brands: [],
      items,
    }));
    await settle();
    items = [];

    events.next(message('mechanic.updated'));
    await wait(350);
    await settle();

    expect(text(element.querySelector('mf-empty-state'))).toContain(
      'Încă nu ai adăugat mecanici',
    );
    expect(countLine(element)).toBeNull();
    expect(rows(element)).toHaveLength(0);
  });

  it('sends the view home when a live re-read answers 404 with a list on screen', async () => {
    let gone = false;
    const { settle } = await render(async () => {
      if (gone) throw new HttpErrorResponse({ status: 404 });
      return { brands: [], items: SEEDED };
    });
    await settle();
    gone = true;

    events.next(message('mechanic.updated'));
    await wait(350);
    await settle();

    expect(navigateByUrl).toHaveBeenCalledWith('/app/garage');
  });

  // ST-56: the button now opens an empty card; inviting stays in the frame.
  it('opens a new card from the add button shown above a loaded list too', async () => {
    const { element, settle } = await render();
    await settle();

    [...element.querySelectorAll('button')]
      .find((b) => text(b) === 'Adaugă un mecanic')
      ?.click();

    expect(open).toHaveBeenCalledWith(
      MechanicCard,
      expect.objectContaining({ data: { brands: [], garageId: GARAGE } }),
    );
  });
});

// @traces 055-FR-012
describe('Mecanici, live events that must not refresh', () => {
  it.each([
    'invite.sent',
    'invite.revoked',
    'review.posted',
    'booking.created',
  ])('does not read again on %s', async (kind) => {
    const { settle } = await render();
    await settle();

    events.next(message(kind));
    await wait(350);
    await settle();

    expect(list).toHaveBeenCalledTimes(1);
  });

  it('reads once, not many times, for a burst of fifty events', async () => {
    const { settle } = await render();
    await settle();

    for (let i = 0; i < 50; i++) events.next(message('rating.updated'));
    await wait(600);
    await settle();

    expect(list.mock.calls.length).toBeLessThanOrEqual(3);
  });

  it('shows the list from the re-read after a rating change', async () => {
    let rating = '4.9';
    const { element, settle } = await render(async () => ({
      brands: [],
      items: [mechanic({ rating })],
    }));
    await settle();
    rating = '3.1';

    events.next(message('rating.updated'));
    await wait(350);
    await settle();

    expect(text(rows(element)[0].querySelector('[data-rating]'))).toBe(
      '3,1 · 58 de recenzii',
    );
  });
});
