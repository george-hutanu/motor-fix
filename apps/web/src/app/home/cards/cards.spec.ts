import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { BrandDto, HomeGarageDto } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';

import { HomeCards, type ResultsRoute } from './cards';

const BMW: BrandDto = { id: 'b', name: 'BMW', popularity: 1, slug: 'bmw' };

const garageOf = (over: Partial<HomeGarageDto> = {}): HomeGarageDto => ({
  businessKind: 'company',
  city: 'București',
  distanceKm: 2.4,
  doesNotTake: ['Tesla'],
  id: 'militari',
  labourFromLei: 180,
  name: 'Service Auto Militari',
  rating: 4.9,
  reviewCount: 212,
  slug: 'service-auto-militari',
  stance: 'works_on',
  worksOn: ['BMW', 'Dacia'],
  ...over,
});

const RESULTS: ResultsRoute = {
  commands: ['/', 'ro', 'garages'],
  queryParams: { brand: 'bmw' },
};

let fixture: ComponentFixture<HomeCards>;

beforeEach(async () => {
  TestBed.configureTestingModule({ providers: [provideRouter([])] });
  await TestBed.inject(I18n).enter('public');
});

async function render(
  garages: HomeGarageDto[],
  {
    failed = false,
    language = 'ro' as 'ro' | 'en',
    loading = false,
    results = RESULTS,
  } = {},
) {
  if (language === 'en') await TestBed.inject(I18n).use('en');
  fixture = TestBed.createComponent(HomeCards);
  fixture.componentRef.setInput('brand', BMW);
  fixture.componentRef.setInput('garages', garages);
  fixture.componentRef.setInput('loading', loading);
  fixture.componentRef.setInput('failed', failed);
  fixture.componentRef.setInput('results', results);
  fixture.detectChanges();
  await fixture.whenStable();
  return fixture.nativeElement as HTMLElement;
}

const cards = (page: HTMLElement) => [
  ...page.querySelectorAll<HTMLAnchorElement>('a.card'),
];
const said = (el: Element | null | undefined) =>
  el?.textContent?.replace(/\s+/g, ' ').trim();
const lists = (card: Element) =>
  [...card.querySelectorAll('.list')].map((list) => said(list));

describe('HomeCards', () => {
  // @traces 227-FR-001
  it('titles the section with the brand and links to the results the main button opens', async () => {
    const page = await render([garageOf()]);

    expect(said(page.querySelector('section h2'))).toBe('Cine primește BMW');
    const link = page.querySelector<HTMLAnchorElement>('a.all');
    expect(said(link)).toBe('Vezi toate pe hartă');
    expect(link?.getAttribute('href')).toBe('/ro/garages?brand=bmw');
  });

  // @traces 227-FR-001
  it('keeps whatever place the main button carries on the link', async () => {
    const page = await render([], {
      results: {
        commands: ['/', 'ro', 'garages'],
        queryParams: { brand: 'bmw', near: '44.427,26.103' },
      },
    });

    expect(
      page.querySelector<HTMLAnchorElement>('a.all')?.getAttribute('href'),
    ).toBe('/ro/garages?brand=bmw&near=44.427,26.103');
  });

  // @traces 227-FR-002
  it('shows one card per garage, in the order given, and no empty card', async () => {
    const page = await render([
      garageOf(),
      garageOf({
        id: 'c',
        name: 'Service Colentina',
        slug: 'service-colentina',
      }),
    ]);

    expect(
      cards(page).map((card) => said(card.querySelector('.name'))),
    ).toEqual(['Service Auto Militari', 'Service Colentina']);
  });

  // @traces 227-FR-002
  it('keeps the title and the link with no garage, and shows no card', async () => {
    const page = await render([]);

    expect(cards(page)).toHaveLength(0);
    expect(page.querySelector('section h2')).not.toBeNull();
    expect(page.querySelector('a.all')).not.toBeNull();
  });

  // @traces 227-FR-003
  it('shows the rating, where it is, both lists, the rate and the reviews of a garage that takes the brand', async () => {
    const [card] = cards(await render([garageOf()]));

    expect(said(card.querySelector('mf-rating-dial .mf-dial-value'))).toBe(
      '4,9',
    );
    expect(said(card.querySelector('.where'))).toBe('București · 2,4 km');
    const lamp = card.querySelector('mf-lamp');
    expect(lamp?.getAttribute('data-state')).toBe('green');
    expect(said(lamp)).toBe('Lucrează pe BMW');
    expect(lists(card)).toEqual([
      'Lucrează pe BMW, Dacia',
      'Nu primește Tesla',
    ]);
    expect(said(card.querySelector('.rate'))).toBe('de la 180 lei/oră');
    expect(said(card.querySelector('.reviews'))).toBe('212 recenzii');
  });

  // @traces 227-FR-003
  it.each([
    ['does_not_take', ['BMW', 'Tesla']],
    ['unstated', ['Tesla']],
  ] as const)(
    'shows a red lamp for a garage whose answer is %s, and only its own refusals',
    async (stance, refused) => {
      const [card] = cards(
        await render([
          garageOf({ doesNotTake: [...refused], stance, worksOn: ['Dacia'] }),
        ]),
      );

      const lamp = card.querySelector('mf-lamp');
      expect(lamp?.getAttribute('data-state')).toBe('red');
      expect(said(lamp)).toBe('Nu primește BMW');
      expect(lists(card)[1]).toBe(`Nu primește ${refused.join(', ')}`);
    },
  );

  // @traces 227-FR-004
  it.each([
    [6, 'Lucrează pe A, B, C, D, E, F'],
    [7, 'Lucrează pe A, B, C, D, E, F +1'],
    [9, 'Lucrează pe A, B, C, D, E, F +3'],
  ])('cuts a list of %i names after six', async (count, shown) => {
    const names = 'ABCDEFGHI'.slice(0, count).split('');
    const [card] = cards(await render([garageOf({ worksOn: names })]));

    expect(lists(card)[0]).toBe(shown);
  });

  // @traces 227-FR-004
  it('shows a dash for an empty list', async () => {
    const [card] = cards(await render([garageOf({ doesNotTake: [] })]));

    expect(lists(card)[1]).toBe('Nu primește —');
  });

  // @traces 227-FR-003
  it('shows a mobile mechanic by its area, never a city', async () => {
    const [card] = cards(
      await render([
        garageOf({
          businessKind: 'mobile',
          city: undefined,
          comesToYou: true,
          distanceKm: null,
          serviceRadiusKm: 20,
        }),
      ]),
    );

    expect(said(card.querySelector('.where'))).toBe(
      'Mecanic mobil · vine la tine · zonă de 20 km',
    );
    expect(said(card)).not.toContain('București');
  });

  // @traces 227-FR-003
  it('leaves out the where line with no city and no distance', async () => {
    const [card] = cards(
      await render([garageOf({ city: undefined, distanceKm: undefined })]),
    );

    expect(card.querySelector('.where')).toBeNull();
  });

  // @traces 227-FR-003
  it('says a garage has no reviews yet, and leaves out a rate it has not given', async () => {
    const [card] = cards(
      await render([
        garageOf({ labourFromLei: null, rating: null, reviewCount: 0 }),
      ]),
    );

    expect(said(card.querySelector('mf-rating-dial .mf-dial-value'))).toBe('—');
    expect(said(card.querySelector('.reviews'))).toBe('Fără recenzii');
    expect(card.querySelector('.rate')).toBeNull();
  });

  // @traces 227-FR-003
  it.each([
    [1, '1 recenzie'],
    [12, '12 recenzii'],
    [20, '20 de recenzii'],
    [101, '101 recenzii'],
  ])('counts %i reviews in Romanian', async (reviewCount, text) => {
    const [card] = cards(await render([garageOf({ reviewCount })]));

    expect(said(card.querySelector('.reviews'))).toBe(text);
  });

  // @traces 227-FR-007
  it('says it all in English', async () => {
    const page = await render(
      [
        garageOf({ reviewCount: 1 }),
        garageOf({
          businessKind: 'mobile',
          city: undefined,
          distanceKm: null,
          id: 'm',
          serviceRadiusKm: 20,
          slug: 'm',
          stance: 'unstated',
        }),
      ],
      { language: 'en' },
    );

    expect(said(page.querySelector('section h2'))).toBe('Who takes your BMW');
    expect(said(page.querySelector('a.all'))).toBe('See all on the map');
    const [first, second] = cards(page);
    expect(first.getAttribute('href')).toBe(
      '/en/garages/service-auto-militari?brand=bmw',
    );
    expect(said(first.querySelector('mf-lamp'))).toBe('Works on BMW');
    expect(lists(first)).toEqual(['Works on BMW, Dacia', "Doesn't take Tesla"]);
    expect(said(first.querySelector('.rate'))).toBe('from 180 lei/hour');
    expect(said(first.querySelector('.reviews'))).toBe('1 review');
    expect(said(second.querySelector('mf-lamp'))).toBe("Doesn't take BMW");
    expect(said(second.querySelector('.where'))).toBe(
      'Mobile mechanic · comes to you · 20 km area',
    );
  });

  // @traces 227-FR-005
  it('links each card to the garage profile in the current language, with the brand', async () => {
    const page = await render([
      garageOf(),
      garageOf({ id: 'b', slug: 'atelier-berceni' }),
    ]);

    expect(cards(page).map((card) => card.getAttribute('href'))).toEqual([
      '/ro/garages/service-auto-militari?brand=bmw',
      '/ro/garages/atelier-berceni?brand=bmw',
    ]);
  });

  // @traces 227-FR-014
  it('names a card by the garage, its answer for the brand and its rating', async () => {
    const [card] = cards(await render([garageOf()]));

    expect(card.getAttribute('aria-label')).toBe(
      'Service Auto Militari, Lucrează pe BMW, 4,9',
    );
    expect(
      card.querySelector('mf-rating-dial')?.getAttribute('aria-hidden'),
    ).toBe('true');
  });

  // @traces 227-FR-006
  // @traces 227-FR-014
  it('shows three skeleton cards with no text while it loads, marked busy', async () => {
    const page = await render([garageOf()], { loading: true });

    const skeletons = page.querySelectorAll('.card.skeleton');
    expect(skeletons).toHaveLength(3);
    for (const skeleton of skeletons) {
      expect(said(skeleton)).toBe('');
      expect(skeleton.getAttribute('aria-hidden')).toBe('true');
    }
    expect(cards(page)).toHaveLength(0);
    expect(page.querySelector('.cards')?.getAttribute('aria-busy')).toBe(
      'true',
    );
    expect(page.querySelector('section h2')).not.toBeNull();
  });

  // @traces 227-FR-006
  // @traces 227-FR-014
  it('says the garages could not load, and asks again on retry', async () => {
    const page = await render([garageOf()], { failed: true });
    const retry = jest.fn();
    fixture.componentInstance.retry.subscribe(retry);

    const alert = page.querySelector('[role="alert"]');
    expect(said(alert)).toContain('Nu am putut încărca service‑urile');
    expect(cards(page)).toHaveLength(0);
    page.querySelector<HTMLButtonElement>('.cards button')?.click();
    expect(retry).toHaveBeenCalledTimes(1);
    expect(page.querySelector('a.all')).not.toBeNull();
  });

  // @traces 227-FR-007
  it('follows a language switch without being given the garages again', async () => {
    const page = await render([garageOf()]);

    await TestBed.inject(I18n).use('en');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(said(page.querySelector('section h2'))).toBe('Who takes your BMW');
    expect(said(cards(page)[0].querySelector('.reviews'))).toBe('212 reviews');
  });
});
