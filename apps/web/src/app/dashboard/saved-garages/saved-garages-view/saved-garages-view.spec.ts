import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import {
  type CarDto,
  CarsService,
  type MeDto,
  PlacesService,
  type SavedGaragesPageDto,
  SavedGaragesService,
} from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';

import { SavedGaragesView } from './saved-garages-view';
import { SavedGarages } from '../../../public/saved-garages/saved-garages';
import {
  fakeLive,
  fakeObservers,
  wait,
} from '../../garage-requests/garage-requests.testing';
import { Live } from '../../live';
import { Session } from '../../session';
import {
  fakeSavedGarages,
  pageOf,
  savedCar,
  savedItem,
  savedItems,
} from '../saved-garages.testing';

type Answer = SavedGaragesPageDto | Error | Promise<never>;

let list: jest.Mock;
let live: ReturnType<typeof fakeLive>;
let saved: ReturnType<typeof fakeSavedGarages>;
let observers: ReturnType<typeof fakeObservers>;

async function render({
  answers = [pageOf([savedItem()])],
  cars = [savedCar()],
  language = 'ro',
  pages = {},
}: {
  answers?: Answer[];
  cars?: CarDto[];
  language?: 'ro' | 'en';
  pages?: Record<string, SavedGaragesPageDto | Error>;
} = {}) {
  observers = fakeObservers();
  live = fakeLive();
  saved = fakeSavedGarages();
  let call = 0;
  list = jest.fn(async ({ cursor }: { cursor?: string }) => {
    const answer = cursor
      ? pages[cursor]
      : answers[Math.min(call++, answers.length - 1)];
    if (answer instanceof Error) throw answer;
    return answer;
  });
  const me = signal({
    capabilities: ['driver.saved_garages'],
    city: null,
    role: 'driver',
  } as unknown as MeDto);
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: Live, useValue: live },
      { provide: Session, useValue: { current: me, shown: me } },
      { provide: SavedGarages, useValue: saved },
      {
        provide: SavedGaragesService,
        useValue: { savedGaragesControllerList: list },
      },
      {
        provide: CarsService,
        useValue: {
          carsControllerList: async () => ({
            items: cars,
            nextCursor: null,
            total: cars.length,
          }),
        },
      },
      {
        provide: PlacesService,
        useValue: { placesControllerSearch: async () => ({ items: [] }) },
      },
    ],
  });
  const i18n = TestBed.inject(I18n);
  await i18n.enter('driver');
  if (language === 'en') await i18n.use('en');
  const fixture = TestBed.createComponent(SavedGaragesView);
  const element = fixture.nativeElement as HTMLElement;
  const settle = async () => {
    for (let i = 0; i < 6; i++) {
      fixture.detectChanges();
      await fixture.whenStable();
      await wait(0);
    }
  };
  await settle();
  return { element, settle };
}

const text = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
const subtitle = (element: HTMLElement) =>
  text(element.querySelector('[data-subtitle]'));
const rows = (element: HTMLElement) =>
  [...element.querySelectorAll<HTMLElement>('mf-saved-garage-row')].map((row) =>
    text(row.querySelector('a[data-profile]')),
  );
const control = (element: Element | null, name: string) =>
  [...(element?.querySelectorAll<HTMLElement>('button, a') ?? [])].find(
    (b) => text(b) === name,
  );

afterEach(() => TestBed.resetTestingModule());

// @traces 291-FR-006
describe('Service-uri salvate: the subtitle', () => {
  it.each([
    [1, '1 service care lucrează pe mașinile tale'],
    [0, '0 service‑uri care lucrează pe mașinile tale'],
    [2, '2 service‑uri care lucrează pe mașinile tale'],
    [19, '19 service‑uri care lucrează pe mașinile tale'],
    [20, '20 de service‑uri care lucrează pe mașinile tale'],
    [101, '101 service‑uri care lucrează pe mașinile tale'],
  ])('counts %i working garages the Romanian way', async (count, said) => {
    const { element } = await render({
      answers: [pageOf(savedItems(1), { total: 25, workingCount: count })],
    });

    expect(subtitle(element)).toBe(said);
  });

  it.each([
    [1, '1 garage that works on your cars'],
    [3, '3 garages that work on your cars'],
  ])('says %i in English', async (count, said) => {
    const { element } = await render({
      answers: [pageOf(savedItems(1), { workingCount: count })],
      language: 'en',
    });

    expect(subtitle(element)).toBe(said);
  });

  it('counts the whole list, not the page shown', async () => {
    const { element } = await render({
      answers: [
        pageOf(savedItems(20), {
          nextCursor: 'c-2',
          total: 25,
          workingCount: 3,
        }),
      ],
    });

    expect(subtitle(element)).toBe(
      '3 service‑uri care lucrează pe mașinile tale',
    );
  });
});

// @traces 291-FR-009
describe('Service-uri salvate: the rows', () => {
  it('shows the first page, newest first, as the API gives it', async () => {
    const { element } = await render({ answers: [pageOf(savedItems(3))] });

    expect(rows(element)).toEqual(['Service 1', 'Service 2', 'Service 3']);
  });

  it('reads the next page with its cursor when the end comes into view, and appends it', async () => {
    const { element, settle } = await render({
      answers: [pageOf(savedItems(2), { nextCursor: 'c-2', total: 3 })],
      pages: {
        'c-2': pageOf([savedItem({ garageId: 'g-3', name: 'Service 3' })], {
          total: 3,
        }),
      },
    });

    observers.reachEnd();
    await settle();

    expect(list).toHaveBeenCalledWith({ cursor: 'c-2' });
    expect(rows(element)).toEqual(['Service 1', 'Service 2', 'Service 3']);
  });

  it('shows the error under the loaded rows when a further page fails, and reads it again on Reîncearcă', async () => {
    const { element, settle } = await render({
      answers: [pageOf(savedItems(2), { nextCursor: 'c-2', total: 3 })],
      pages: { 'c-2': new Error('down') },
    });

    observers.reachEnd();
    await settle();

    expect(rows(element)).toEqual(['Service 1', 'Service 2']);
    expect(text(element.querySelector('[data-more-failed]'))).toContain(
      'Nu am putut încărca service‑urile salvate.',
    );
    const asked = () =>
      list.mock.calls.filter(([params]) => params?.cursor === 'c-2').length;
    const before = asked();
    control(element.querySelector('[data-more-failed]'), 'Reîncearcă')?.click();
    await settle();

    expect(asked()).toBe(before + 1);
  });

  it('shows no "Vezi toate" in the view itself', async () => {
    const { element } = await render({
      answers: [pageOf(savedItems(5), { total: 5 })],
    });

    expect(control(element, 'Vezi toate')).toBeUndefined();
  });
});

// @traces 291-FR-012
describe('Service-uri salvate: its states', () => {
  it('shows three row placeholders while the first read is open', async () => {
    const { element } = await render({
      answers: [new Promise<never>(() => {})],
    });

    expect(element.querySelectorAll('.skeleton')).toHaveLength(3);
    expect(element.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it('says it could not load the list, and reads again on Reîncearcă', async () => {
    const { element, settle } = await render({
      answers: [new Error('down'), pageOf(savedItems(1))],
    });

    expect(text(element)).toContain(
      'Nu am putut încărca service‑urile salvate.',
    );
    control(element, 'Reîncearcă')?.click();
    await settle();

    expect(rows(element)).toEqual(['Service 1']);
  });

  it('says it in English, with Try again', async () => {
    const { element } = await render({
      answers: [new Error('down')],
      language: 'en',
    });

    expect(text(element)).toContain('We could not load your saved garages.');
    expect(control(element, 'Try again')).toBeDefined();
  });

  it('shows the empty state with Caută altele when nothing is saved', async () => {
    const { element } = await render({ answers: [pageOf([])] });

    expect(text(element)).toContain('Nu ai salvat încă niciun service.');
    expect(element.querySelector('mf-empty-state a')?.textContent?.trim()).toBe(
      'Caută altele',
    );
  });

  it('sends Caută altele to the results for the first car’s brand', async () => {
    const { element } = await render({
      cars: [
        savedCar({ brandId: 'b-1' }),
        savedCar({ brandId: 'b-2', id: 'c-2' }),
      ],
    });

    expect(
      element.querySelector('a[data-find-more]')?.getAttribute('href'),
    ).toBe('/ro/garages?brand=b-1');
  });

  it('sends Caută altele to Home for a driver with no car, and greys the lines', async () => {
    const { element } = await render({
      answers: [pageOf([savedItem({ brands: [] })])],
      cars: [],
    });

    expect(
      element.querySelector('a[data-find-more]')?.getAttribute('href'),
    ).toBe('/ro');
    expect(
      element.querySelector<HTMLElement>('mf-lamp')?.dataset['state'],
    ).toBe('grey');
  });

  it('names Find more in English', async () => {
    const { element } = await render({ language: 'en' });

    expect(text(element.querySelector('a[data-find-more]'))).toBe('Find more');
  });
});

// @traces 291-FR-011
describe('Service-uri salvate: removing a row', () => {
  const three = () =>
    pageOf([
      savedItem({ garageId: 'g-1', name: 'Service 1', slug: 's-1' }),
      savedItem({ garageId: 'g-2', name: 'Service 2', slug: 's-2' }),
      savedItem({ garageId: 'g-3', name: 'Service 3', slug: 's-3' }),
    ]);
  const remove = (element: HTMLElement, index: number) =>
    element
      .querySelectorAll<HTMLButtonElement>('button[data-remove]')
      [index]?.click();

  it('takes the row away at once and moves the focus to the next row', async () => {
    const { element, settle } = await render({ answers: [three()] });

    remove(element, 1);
    await settle();

    expect(saved.remove).toHaveBeenCalledWith('g-2');
    expect(rows(element)).toEqual(['Service 1', 'Service 3']);
    expect(subtitle(element)).toBe(
      '2 service‑uri care lucrează pe mașinile tale',
    );
    expect(document.activeElement?.getAttribute('href')).toBe(
      '/ro/garages/s-3',
    );
  });

  it('moves the focus to the previous row when the last one goes', async () => {
    const { element, settle } = await render({ answers: [three()] });

    remove(element, 2);
    await settle();

    expect(document.activeElement?.getAttribute('href')).toBe(
      '/ro/garages/s-2',
    );
  });

  it('moves the focus to Caută altele when the only row goes', async () => {
    const { element, settle } = await render({
      answers: [pageOf([savedItem({ garageId: 'g-1' })])],
    });

    remove(element, 0);
    await settle();

    expect(document.activeElement?.hasAttribute('data-find-more')).toBe(true);
  });

  it('puts the row back in its place on undo or a failed removal', async () => {
    const { element, settle } = await render({ answers: [three()] });
    remove(element, 0);
    await settle();

    saved.restore('g-1');
    await settle();

    expect(rows(element)).toEqual(['Service 1', 'Service 2', 'Service 3']);
  });
});

// @traces 291-FR-013
describe('Service-uri salvate: another tab', () => {
  it('reads the first page again when a garage is saved elsewhere', async () => {
    const { element, settle } = await render({
      answers: [pageOf(savedItems(1)), pageOf(savedItems(2))],
    });

    live.emit('saved_garage.added', 'garage-2');
    await wait(400);
    await settle();

    expect(rows(element)).toEqual(['Service 1', 'Service 2']);
  });
});
