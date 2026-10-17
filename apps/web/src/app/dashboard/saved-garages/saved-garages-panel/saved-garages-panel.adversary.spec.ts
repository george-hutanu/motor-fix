import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import {
  type CarDto,
  type MeDto,
  PlacesService,
  type SavedGarageItemDto,
  type SavedGaragesPageDto,
  SavedGaragesService,
} from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';

import { SavedGaragesPanel } from './saved-garages-panel';
import { SavedGarages } from '../../../public/saved-garages/saved-garages';
import { fakeLive, wait } from '../../garage-requests/garage-requests.testing';
import { Live } from '../../live';
import { Session } from '../../session';
import {
  fakeSavedGarages,
  pageOf,
  savedCar,
  savedItem,
  savedItems,
} from '../saved-garages.testing';

let list: jest.Mock;
let saved: ReturnType<typeof fakeSavedGarages>;

async function render({
  answers,
  cars,
  limit = 3,
  more = [],
  moreFailed = false,
}: {
  answers: (SavedGaragesPageDto | Error)[];
  cars?: CarDto[];
  limit?: number | undefined;
  more?: SavedGarageItemDto[];
  moreFailed?: boolean;
}) {
  const live = fakeLive();
  saved = fakeSavedGarages();
  let call = 0;
  list = jest.fn(async () => {
    const answer = answers[Math.min(call++, answers.length - 1)];
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
        provide: PlacesService,
        useValue: { placesControllerSearch: async () => ({ items: [] }) },
      },
    ],
  });
  await TestBed.inject(I18n).enter('driver');
  const fixture = TestBed.createComponent(SavedGaragesPanel);
  fixture.componentRef.setInput('limit', limit);
  fixture.componentRef.setInput('more', more);
  fixture.componentRef.setInput('moreFailed', moreFailed);
  if (cars) fixture.componentRef.setInput('cars', cars);
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
const names = (element: HTMLElement) =>
  [...element.querySelectorAll('a[data-profile]')].map((a) => text(a));
const seeAll = (element: HTMLElement) =>
  element.querySelector<HTMLAnchorElement>('a.see-all');

afterEach(() => TestBed.resetTestingModule());

// @traces 291-FR-009
describe('the saved garages panel under attack: the cut', () => {
  it('shows no Vezi toate for exactly three saved garages', async () => {
    const { element } = await render({ answers: [pageOf(savedItems(3))] });

    expect(names(element)).toHaveLength(3);
    expect(seeAll(element)).toBeNull();
  });

  it('shows Vezi toate to /app/driver/saved for four', async () => {
    const { element } = await render({ answers: [pageOf(savedItems(4))] });

    expect(names(element)).toEqual(['Service 1', 'Service 2', 'Service 3']);
    expect(seeAll(element)?.getAttribute('href')).toBe('/app/driver/saved');
  });

  it('shows three rows and the link when only the total says more than three', async () => {
    const { element } = await render({
      answers: [pageOf(savedItems(3), { total: 500 })],
    });

    expect(names(element)).toHaveLength(3);
    expect(seeAll(element)).not.toBeNull();
  });

  it('cuts a full page of twenty and its further rows to three', async () => {
    const { element } = await render({
      answers: [pageOf(savedItems(20), { nextCursor: 'c', total: 45 })],
      more: [savedItem({ garageId: 'far', name: 'Far' })],
    });

    expect(names(element)).toEqual(['Service 1', 'Service 2', 'Service 3']);
  });

  it('shows a row that appears in both the first page and the further rows once', async () => {
    const { element } = await render({
      answers: [pageOf(savedItems(2), { nextCursor: 'c', total: 3 })],
      limit: undefined,
      more: [
        savedItem({ garageId: 'garage-2', name: 'Service 2' }),
        savedItem({ garageId: 'garage-3', name: 'Service 3' }),
      ],
    });

    expect(names(element)).toEqual(['Service 1', 'Service 2', 'Service 3']);
  });

  it('drops Vezi toate when a removal brings four down to three', async () => {
    const { element, settle } = await render({
      answers: [pageOf(savedItems(4))],
    });

    element.querySelector<HTMLButtonElement>('button[data-remove]')?.click();
    await settle();

    expect(seeAll(element)).toBeNull();
    expect(names(element)).toEqual(['Service 2', 'Service 3', 'Service 4']);
  });
});

// @traces 291-FR-012
describe('the saved garages panel under attack: states', () => {
  it('shows the empty state when the last row is removed', async () => {
    const { element, settle } = await render({
      answers: [pageOf(savedItems(1))],
    });

    element.querySelector<HTMLButtonElement>('button[data-remove]')?.click();
    await settle();

    expect(text(element)).toContain('Nu ai salvat încă niciun service.');
    expect(document.activeElement?.hasAttribute('data-find-more')).toBe(true);
  });

  it('shows the error and no rows when the first read fails, and reads again on Reîncearcă', async () => {
    const { element, settle } = await render({
      answers: [new Error('boom'), pageOf(savedItems(1))],
    });
    expect(text(element.querySelector('[role="alert"]'))).toBe(
      'Nu am putut încărca service‑urile salvate.',
    );
    expect(names(element)).toEqual([]);

    [...element.querySelectorAll<HTMLButtonElement>('button')]
      .find((b) => text(b) === 'Reîncearcă')
      ?.click();
    await settle();

    expect(names(element)).toEqual(['Service 1']);
  });

  it('shows no error alert when a further page failed but the flag is off', async () => {
    const { element } = await render({ answers: [pageOf(savedItems(2))] });

    expect(element.querySelector('[data-more-failed]')).toBeNull();
  });

  it('sends the one Caută altele to Home, not to the results, for a driver whose cars are an empty list', async () => {
    const { element } = await render({
      answers: [pageOf([])],
      cars: [],
    });

    const links =
      element.querySelectorAll<HTMLAnchorElement>('a[data-find-more]');
    expect([...links].map((a) => a.getAttribute('href'))).toEqual(['/ro']);
  });

  it('sends Caută altele to the first car’s brand in the results', async () => {
    const { element } = await render({
      answers: [pageOf(savedItems(1))],
      cars: [
        savedCar({ brandId: 'brand-dacia' }),
        savedCar({ brandId: 'brand-bmw', id: 'c2' }),
      ],
    });

    expect(
      element.querySelector('a[data-find-more]')?.getAttribute('href'),
    ).toBe('/ro/garages?brand=brand-dacia');
  });
});
