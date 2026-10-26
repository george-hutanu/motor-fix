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

// The dialog itself is its own spec's; here it is only what the view opens.
jest.mock(
  '../mechanic-card/mechanic-card',
  () => ({ MechanicCard: class MechanicCard {} }),
  { virtual: true },
);

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
  invite: null,
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

const BRANDS = [{ id: 'brand-dacia', name: 'Dacia' }];
const listOf = (items: GarageMechanicDto[]): GarageMechanicsDto => ({
  brands: BRANDS,
  items,
});
const OWNER = mechanic({
  hasAccount: true,
  id: 'owner-row',
  isOwner: true,
  name: 'Mihai Ionescu',
  onProfile: false,
  rating: null,
  reviewCount: 0,
  speciality: null,
  specialties: [],
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
  answer: () => Promise<GarageMechanicsDto> = async () => listOf(SEEDED),
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

// @traces 055-FR-005 055-FR-006 055-FR-013
describe('Mecanici, the team list', () => {
  it("reads the owner's garage and shows a row per card in the API's order under the panel Echipa", async () => {
    const { element, settle } = await render();
    await settle();

    expect(list).toHaveBeenCalledWith({ garageId: GARAGE });
    expect(text(element.querySelector('section.panel h2'))).toBe('Echipa');
    expect(
      rows(element).map((row) => text(row.querySelector('.name'))),
    ).toEqual(['Andrei Popescu', 'Costel Radu', 'Tudor Ilie']);
  });

  it('shows the speciality under the name, and nothing for a card without one', async () => {
    const { element, settle } = await render();
    await settle();

    const [andrei, costel] = rows(element);
    expect(text(andrei.querySelector('.speciality'))).toBe('Frâne, suspensie');
    expect(costel.querySelector('.speciality')).toBeNull();
    expect(text(costel)).not.toMatch(/·\s*·|^·|·$/);
  });

  it('says each state in words beside a decorative lamp', async () => {
    const { element, settle } = await render();
    await settle();

    expect(rows(element).map((row) => text(lamp(row)))).toEqual([
      'pe profil',
      'nu apare pe profil · fără cont',
      'nu apare pe profil',
    ]);
    expect(rows(element).map((row) => lamp(row)?.dataset['state'])).toEqual([
      'on',
      'off',
      'off',
    ]);
    for (const row of rows(element)) {
      expect(row.querySelector('.lamp')?.getAttribute('aria-hidden')).toBe(
        'true',
      );
    }
  });

  it('says each state in English', async () => {
    const { element, settle } = await render(undefined, 'en');
    await settle();

    expect(text(element.querySelector('section.panel h2'))).toBe('Team');
    expect(rows(element).map((row) => text(lamp(row)))).toEqual([
      'on the profile',
      'not on the profile · no account',
      'not on the profile',
    ]);
  });

  it('shows a name and a speciality typed with markup as text', async () => {
    const { element, settle } = await render(async () =>
      listOf([mechanic({ name: '<b>Ion</b>', speciality: '<i>x</i>' })]),
    );
    await settle();

    const [row] = rows(element);
    expect(row.querySelector('b, i')).toBeNull();
    expect(text(row.querySelector('.name'))).toBe('<b>Ion</b>');
    expect(text(row.querySelector('.speciality'))).toBe('<i>x</i>');
  });
});

// @traces 055-FR-007 055-FR-013
describe('Mecanici, the rating cell', () => {
  const ratingOf = async (
    reviewCount: number,
    rating: string | null,
    language: 'ro' | 'en' = 'ro',
  ) => {
    const { element, settle } = await render(
      async () => listOf([mechanic({ rating, reviewCount })]),
      language,
    );
    await settle();
    const cell = text(rows(element)[0].querySelector('[data-rating]'));
    TestBed.resetTestingModule();
    return cell;
  };

  it('reads the rating and the review count with Romanian plurals', async () => {
    expect(await ratingOf(1, '4.0')).toBe('4,0 · 1 recenzie');
    expect(await ratingOf(2, '4.5')).toBe('4,5 · 2 recenzii');
    expect(await ratingOf(20, '4.9')).toBe('4,9 · 20 de recenzii');
    expect(await ratingOf(0, null)).toBe('fără recenzii');
  });

  it('reads the rating and the review count in English', async () => {
    expect(await ratingOf(1, '4.0', 'en')).toBe('4.0 · 1 review');
    expect(await ratingOf(20, '4.9', 'en')).toBe('4.9 · 20 reviews');
    expect(await ratingOf(0, null, 'en')).toBe('no reviews');
  });
});

// @traces 055-FR-008 055-FR-013
describe('Mecanici, the count line', () => {
  const countOf = async (
    items: GarageMechanicDto[],
    language: 'ro' | 'en' = 'ro',
  ) => {
    const { element, settle } = await render(
      async () => listOf(items),
      language,
    );
    await settle();
    const line = countLine(element);
    TestBed.resetTestingModule();
    return line && text(line);
  };
  const onProfile = (n: number) =>
    Array.from({ length: n }, (_, i) => mechanic({ id: `m-${i}` }));

  it('counts the cards on the profile with Romanian plurals', async () => {
    expect(await countOf(onProfile(1))).toBe('1 mecanic pe profil');
    expect(await countOf(onProfile(2))).toBe('2 mecanici pe profil');
    expect(await countOf(onProfile(20))).toBe('20 de mecanici pe profil');
    expect(await countOf(SEEDED)).toBe('1 mecanic pe profil');
  });

  it('counts in English', async () => {
    expect(await countOf(onProfile(1), 'en')).toBe('1 mechanic on the profile');
    expect(await countOf(onProfile(2), 'en')).toBe(
      '2 mechanics on the profile',
    );
  });

  it('says the team is not on the profile when no card is', async () => {
    const off = [mechanic({ onProfile: false })];

    expect(await countOf(off)).toBe('Echipa nu apare pe profil');
    expect(await countOf(off, 'en')).toBe('The team is not on the profile');
  });

  it('has no count line with no card', async () => {
    expect(await countOf([])).toBeNull();
  });
});

// @traces 055-FR-009 055-FR-010 055-FR-011
describe('Mecanici, empty, loading and failing', () => {
  // @traces 056-FR-012
  it('shows the empty state with a button that opens the card dialog for a new card', async () => {
    const { element, settle } = await render(async () => listOf([]));
    await settle();

    const empty = element.querySelector('mf-empty-state');
    expect(empty?.querySelector('svg')?.getAttribute('data-icon')).toBe(
      'wrench',
    );
    expect(text(empty)).toContain('Încă nu ai adăugat mecanici');
    expect(countLine(element)).toBeNull();
    const add = [...(empty?.querySelectorAll('button') ?? [])].find(
      (b) => text(b) === 'Adaugă un mecanic',
    );
    add?.click();
    expect(open).toHaveBeenCalledWith(
      MechanicCard,
      expect.objectContaining({
        data: { brands: BRANDS, garageId: GARAGE },
        shape: 'dialog',
      }),
    );
  });

  it('shows three skeleton rows while the first read is on its way', async () => {
    const { element, settle } = await render(() => new Promise(() => {}));
    await settle();

    expect(element.querySelectorAll('[data-skeleton]')).toHaveLength(3);
    expect(rows(element)).toHaveLength(0);
  });

  it('says the read failed and reads again on Reîncearcă', async () => {
    let fail = true;
    const { element, settle } = await render(async () => {
      if (fail) throw new HttpErrorResponse({ status: 500 });
      return listOf(SEEDED);
    });
    await settle();

    expect(text(element.querySelector('[role="alert"]'))).toBe(
      'Nu am putut încărca echipa. Reîncearcă.',
    );
    fail = false;
    [...element.querySelectorAll('button')]
      .find((b) => text(b) === 'Reîncearcă')
      ?.click();
    await settle();

    expect(list).toHaveBeenCalledTimes(2);
    expect(rows(element)).toHaveLength(3);
    expect(element.querySelector('[role="alert"]')).toBeNull();
  });

  // @traces 055-FR-003
  it('sends the view home on a 404, never saying the list is empty', async () => {
    const { element, settle } = await render(async () => {
      throw new HttpErrorResponse({ status: 404 });
    });
    await settle();

    expect(navigateByUrl).toHaveBeenCalledWith('/app/garage');
    expect(text(element)).not.toContain('Încă nu ai adăugat mecanici');
  });
});

// @traces 055-FR-012 055-FR-010 055-FR-011
describe('Mecanici, kept current', () => {
  it.each(['mechanic.updated', 'invite.accepted', 'rating.updated'])(
    'reads again on %s',
    async (kind) => {
      const { settle } = await render();
      await settle();

      events.next(message(kind));
      await wait(350);
      await settle();

      expect(list).toHaveBeenCalledTimes(2);
    },
  );

  it('does not read again on a posted review, only on its rating', async () => {
    const { settle } = await render();
    await settle();

    events.next(message('review.posted'));
    await wait(350);
    await settle();

    expect(list).toHaveBeenCalledTimes(1);
  });

  it('reads again on the stream resync, as when the connection returns', async () => {
    const { settle } = await render();
    await settle();

    resync.next();
    await wait(350);
    await settle();

    expect(list).toHaveBeenCalledTimes(2);
  });

  it('keeps the list and shows no error when a re-read fails', async () => {
    let fail = false;
    const { element, settle } = await render(async () => {
      if (fail) throw new HttpErrorResponse({ status: 0 });
      return listOf(SEEDED);
    });
    await settle();
    fail = true;

    events.next(message('mechanic.updated'));
    await wait(350);
    await settle();

    expect(list).toHaveBeenCalledTimes(2);
    expect(rows(element)).toHaveLength(3);
    expect(element.querySelector('[role="alert"]')).toBeNull();
  });
});

// @traces 056-FR-019
describe("Mecanici, the owner's row and the years", () => {
  it("shows the owner's row first, named, with proprietar beside the name", async () => {
    const { element, settle } = await render(async () =>
      listOf([OWNER, ...SEEDED]),
    );
    await settle();

    const [owner, ...others] = rows(element);
    expect(text(owner.querySelector('.name'))).toBe('Mihai Ionescu');
    expect(text(owner)).toContain('proprietar');
    for (const row of others) expect(text(row)).not.toContain('proprietar');
  });

  it("says owner in English on the owner's row", async () => {
    const { element, settle } = await render(
      async () => listOf([OWNER, ...SEEDED]),
      'en',
    );
    await settle();

    expect(text(rows(element)[0])).toContain('owner');
  });

  const lineOf = async (years: number | null, language: 'ro' | 'en' = 'ro') => {
    const { element, settle } = await render(
      async () =>
        listOf([
          mechanic({ speciality: 'Frâne', specialties: ['Frâne'], years }),
        ]),
      language,
    );
    await settle();
    const line = text(rows(element)[0].querySelector('.speciality'));
    TestBed.resetTestingModule();
    return line;
  };

  it('follows the speciality with the years, with Romanian plurals', async () => {
    expect(await lineOf(1)).toBe('Frâne · 1 an');
    expect(await lineOf(2)).toBe('Frâne · 2 ani');
    expect(await lineOf(19)).toBe('Frâne · 19 ani');
    expect(await lineOf(20)).toBe('Frâne · 20 de ani');
  });

  it('reads the years in English', async () => {
    expect(await lineOf(1, 'en')).toBe('Frâne · 1 year');
    expect(await lineOf(21, 'en')).toBe('Frâne · 21 years');
  });

  it('adds no tail for no years or 0', async () => {
    expect(await lineOf(null)).toBe('Frâne');
    expect(await lineOf(0)).toBe('Frâne');
  });
});

// @traces 056-FR-012 056-FR-016
describe('Mecanici, opening the card dialog', () => {
  it("opens a new card from the panel header's Adaugă un mecanic", async () => {
    const { element, settle } = await render();
    await settle();

    [
      ...element.querySelectorAll<HTMLButtonElement>(
        'section.panel header button',
      ),
    ]
      .find((b) => text(b) === 'Adaugă un mecanic')
      ?.click();

    expect(open).toHaveBeenCalledTimes(1);
    const [task, options] = open.mock.calls[0];
    expect(task).toBe(MechanicCard);
    expect(options).toMatchObject({
      data: { brands: BRANDS, garageId: GARAGE },
      shape: 'dialog',
    });
    expect(options.data.card).toBeUndefined();
  });

  it.each([0, 1])(
    'opens the card of row %i, the owner included, filled in',
    async (index) => {
      const items = [OWNER, ...SEEDED];
      const { element, settle } = await render(async () => listOf(items));
      await settle();

      rows(element)[index].querySelector('button')?.click();

      expect(open).toHaveBeenCalledWith(
        MechanicCard,
        expect.objectContaining({
          data: {
            brands: BRANDS,
            card: items[index],
            garageId: GARAGE,
            refresh: expect.any(Function),
          },
          shape: 'dialog',
        }),
      );
    },
  );

  it('makes each row a button reachable by keyboard', async () => {
    const { element, settle } = await render();
    await settle();

    for (const row of rows(element)) {
      const tap = row.querySelector('button');
      expect(tap?.getAttribute('type')).toBe('button');
      expect(text(tap)).toContain(text(row.querySelector('.name')));
    }
  });

  it.each(['saved', 'removed'])(
    'reads the list again once the dialog closes %s',
    async (outcome) => {
      const { element, settle } = await render();
      await settle();
      open.mockResolvedValueOnce(outcome);

      rows(element)[0].querySelector('button')?.click();
      await settle();

      expect(list).toHaveBeenCalledTimes(2);
    },
  );

  it('does not read again when the dialog is cancelled', async () => {
    const { element, settle } = await render();
    await settle();

    rows(element)[0].querySelector('button')?.click();
    await settle();

    expect(list).toHaveBeenCalledTimes(1);
  });

  it("shows the empty state beside the owner's row when it is the only one, with no count line", async () => {
    const { element, settle } = await render(async () => listOf([OWNER]));
    await settle();

    expect(rows(element)).toHaveLength(1);
    expect(text(element.querySelector('mf-empty-state'))).toContain(
      'Încă nu ai adăugat mecanici',
    );
    expect(countLine(element)).toBeNull();
    expect(text(element)).not.toContain('Echipa nu apare pe profil');
  });

  it("counts the owner's row on the profile like any row when it is the only one", async () => {
    const { element, settle } = await render(async () =>
      listOf([{ ...OWNER, onProfile: true }]),
    );
    await settle();

    expect(text(countLine(element))).toBe('1 mecanic pe profil');
    expect(text(element.querySelector('mf-empty-state'))).toContain(
      'Încă nu ai adăugat mecanici',
    );
  });
});

// @traces 056-FR-013
describe('Mecanici, kept current as cards come and go', () => {
  it.each(['mechanic.added', 'mechanic.removed'])(
    'reads again on %s',
    async (kind) => {
      const { settle } = await render();
      await settle();

      events.next(message(kind));
      await wait(350);
      await settle();

      expect(list).toHaveBeenCalledTimes(2);
    },
  );
});

const invited = (expiresAt: string) =>
  mechanic({
    hasAccount: false,
    id: 'mechanic-4',
    invite: {
      email: 'elena@example.ro',
      expiresAt,
      id: 'invite-1',
      phone: null,
      sentAt: '2026-10-25T11:00:00.000Z',
    },
    name: 'Elena Stan',
    onProfile: false,
  });
const OPEN = invited('2099-01-01T00:00:00.000Z');
const EXPIRED = invited('2000-01-01T00:00:00.000Z');

// @traces 1255-FR-012
describe("Mecanici, a card's invite", () => {
  it('says whether the invite is sent or has expired, the lamp off', async () => {
    const { element, settle } = await render(async () =>
      listOf([OPEN, { ...EXPIRED, id: 'mechanic-5' }]),
    );
    await settle();

    expect(rows(element).map((row) => text(lamp(row)))).toEqual([
      'nu apare pe profil · invitație trimisă',
      'nu apare pe profil · invitație expirată',
    ]);
    expect(rows(element).map((row) => lamp(row)?.dataset['state'])).toEqual([
      'off',
      'off',
    ]);
  });

  it('says it in English', async () => {
    const { element, settle } = await render(
      async () => listOf([OPEN, { ...EXPIRED, id: 'mechanic-5' }]),
      'en',
    );
    await settle();

    expect(rows(element).map((row) => text(lamp(row)))).toEqual([
      'not on the profile · invite sent',
      'not on the profile · invite expired',
    ]);
  });

  it.each(['invite.sent', 'invite.revoked'])(
    'reads again on %s',
    async (kind) => {
      const { settle } = await render();
      await settle();

      events.next(message(kind, 'invite-1'));
      await wait(350);
      await settle();

      expect(list).toHaveBeenCalledTimes(2);
    },
  );

  it("lets the open card read the list again and answers the card's new state", async () => {
    const { element, settle } = await render(async () => listOf([OPEN]));
    await settle();
    rows(element)[0].querySelector('button')?.click();
    await settle();
    const [, options] = open.mock.calls[0];
    const revoked = { ...OPEN, invite: null };
    list.mockResolvedValueOnce(listOf([revoked]));

    const fresh = await options.data.refresh();

    expect(list).toHaveBeenCalledTimes(2);
    expect(fresh).toEqual(revoked);
  });
});
