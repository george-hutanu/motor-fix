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
    brand = BMW,
    failed = false,
    language = 'ro' as 'ro' | 'en',
    loading = false,
    results = RESULTS,
  } = {},
) {
  if (language === 'en') await TestBed.inject(I18n).use('en');
  fixture = TestBed.createComponent(HomeCards);
  fixture.componentRef.setInput('brand', brand);
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

describe('HomeCards under hostile input', () => {
  // @traces 227-FR-004
  it('cuts a very long list at six names and counts the rest', async () => {
    const names = Array.from({ length: 200 }, (_, i) => `M${i}`);
    const [card] = cards(await render([garageOf({ worksOn: names })]));

    expect(lists(card)[0]).toBe('Lucrează pe M0, M1, M2, M3, M4, M5 +194');
  });

  // @traces 227-FR-004
  it('keeps the order the API gave and never re-sorts the names', async () => {
    const [card] = cards(
      await render([
        garageOf({ doesNotTake: ['Zeta', 'Alfa', 'Mid'], worksOn: ['Z', 'A'] }),
      ]),
    );

    expect(lists(card)).toEqual([
      'Lucrează pe Z, A',
      'Nu primește Zeta, Alfa, Mid',
    ]);
  });

  // @traces 227-FR-004
  it('shows a dash for an empty works-on list', async () => {
    const [card] = cards(
      await render([garageOf({ stance: 'unstated', worksOn: [] })]),
    );

    expect(lists(card)[0]).toBe('Lucrează pe —');
  });

  // @traces 227-FR-004
  it('cuts a refused list of seven after six names too', async () => {
    const names = 'ABCDEFG'.split('');
    const [card] = cards(await render([garageOf({ doesNotTake: names })]));

    expect(lists(card)[1]).toBe('Nu primește A, B, C, D, E, F +1');
  });

  // @traces 227-FR-003
  it('never adds the selected brand to the refused list of a garage that never marked it', async () => {
    const [card] = cards(
      await render([
        garageOf({ doesNotTake: [], stance: 'unstated', worksOn: ['Dacia'] }),
      ]),
    );

    expect(lists(card)[1]).toBe('Nu primește —');
  });

  // @traces 227-FR-003
  it('renders garage and brand names as text, never as markup', async () => {
    const hostile = '<img src=x onerror=alert(1)>';
    const [card] = cards(
      await render([garageOf({ name: hostile, worksOn: [hostile] })]),
    );

    expect(card.querySelector('img')).toBeNull();
    expect(said(card.querySelector('.name'))).toBe(hostile);
  });

  // @traces 227-FR-003
  it('keeps unicode names whole', async () => {
    const [card] = cards(
      await render([garageOf({ name: 'Șantier Țăranu — 🚗 Ünal' })]),
    );

    expect(said(card.querySelector('.name'))).toBe('Șantier Țăranu — 🚗 Ünal');
  });

  // @traces 227-FR-003
  it('never shows the city of a mobile mechanic even when one arrives', async () => {
    const [card] = cards(
      await render([
        garageOf({
          businessKind: 'mobile',
          city: 'Cluj-Napoca',
          comesToYou: true,
          serviceRadiusKm: 15,
        }),
      ]),
    );

    expect(said(card)).not.toContain('Cluj-Napoca');
    expect(said(card.querySelector('.where'))).toContain('zonă de 15 km');
  });

  // @traces 227-FR-003
  it('shows no radius for a fixed garage that carries one', async () => {
    const [card] = cards(await render([garageOf({ serviceRadiusKm: 30 })]));

    expect(said(card)).not.toContain('zonă de');
    expect(said(card.querySelector('.where'))).toBe('București · 2,4 km');
  });

  // @traces 227-FR-003
  it('shows the city alone when no place is set', async () => {
    const [card] = cards(await render([garageOf({ distanceKm: null })]));

    expect(said(card.querySelector('.where'))).toBe('București');
  });

  // @traces 227-FR-003
  it('shows a distance of zero as 0 km rather than leaving it out', async () => {
    const [card] = cards(await render([garageOf({ distanceKm: 0 })]));

    expect(said(card.querySelector('.where'))).toBe('București · 0 km');
  });

  // @traces 227-FR-003
  it('writes the distance with a point in English', async () => {
    const [card] = cards(await render([garageOf()], { language: 'en' }));

    expect(said(card.querySelector('.where'))).toBe('București · 2.4 km');
  });

  // @traces 227-FR-003
  it.each([
    [5, '5,0'],
    [1, '1,0'],
    [4.05, '4,1'],
  ])('shows a rating of %s with one decimal', async (rating, text) => {
    const [card] = cards(await render([garageOf({ rating })]));

    expect(said(card.querySelector('mf-rating-dial .mf-dial-value'))).toBe(
      text,
    );
  });

  // @traces 227-FR-003
  it('says a garage has no reviews yet in English', async () => {
    const [card] = cards(
      await render([garageOf({ rating: null, reviewCount: 0 })], {
        language: 'en',
      }),
    );

    expect(said(card.querySelector('.reviews'))).toBe('No reviews yet');
  });

  // @traces 227-FR-003
  it.each([
    [0, 'Fără recenzii'],
    [2, '2 recenzii'],
    [19, '19 recenzii'],
    [21, '21 de recenzii'],
    [100, '100 de recenzii'],
    [119, '119 recenzii'],
  ])('counts %i reviews in Romanian', async (reviewCount, text) => {
    const [card] = cards(await render([garageOf({ reviewCount })]));

    expect(said(card.querySelector('.reviews'))).toBe(text);
  });

  // @traces 227-FR-003
  it('shows a rate of zero lei rather than dropping it', async () => {
    const [card] = cards(await render([garageOf({ labourFromLei: 0 })]));

    expect(said(card.querySelector('.rate'))).toBe('de la 0 lei/oră');
  });

  // @traces 227-FR-005
  it('encodes a slug that carries reserved characters', async () => {
    const [card] = cards(await render([garageOf({ slug: 'a b/c?d' })]));

    expect(card.getAttribute('href')).toBe(
      '/ro/garages/a%20b%2Fc%3Fd?brand=bmw',
    );
  });

  // @traces 227-FR-005
  it('carries the selected brand slug, not the first garage brand', async () => {
    const dacia: BrandDto = {
      id: 'd',
      name: 'Dacia',
      popularity: 2,
      slug: 'dacia',
    };
    const [card] = cards(await render([garageOf()], { brand: dacia }));

    expect(card.getAttribute('href')).toBe(
      '/ro/garages/service-auto-militari?brand=dacia',
    );
    expect(said(card.querySelector('mf-lamp'))).toBe('Lucrează pe Dacia');
  });

  // @traces 227-FR-005
  it('links to the English profile after a language switch', async () => {
    const page = await render([garageOf()]);

    await TestBed.inject(I18n).use('en');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(cards(page)[0].getAttribute('href')).toBe(
      '/en/garages/service-auto-militari?brand=bmw',
    );
  });

  // @traces 227-FR-001
  it('encodes a place that carries reserved characters on the link', async () => {
    const page = await render([], {
      results: {
        commands: ['/', 'ro', 'garages'],
        queryParams: { brand: 'bmw', near: 'a&b=c d' },
      },
    });

    expect(
      page.querySelector<HTMLAnchorElement>('a.all')?.getAttribute('href'),
    ).toBe('/ro/garages?brand=bmw&near=a%26b%3Dc%20d');
  });

  // @traces 227-FR-006
  it('shows no card of a previous answer while loading with a failed flag still set', async () => {
    const page = await render([garageOf()], { failed: true, loading: true });

    expect(cards(page)).toHaveLength(0);
    expect(page.querySelectorAll('.card.skeleton')).toHaveLength(3);
    expect(page.querySelector('[role="alert"]')).toBeNull();
  });

  // @traces 227-FR-006
  it('shows no skeleton and no busy mark once loaded', async () => {
    const page = await render([garageOf()]);

    expect(page.querySelectorAll('.card.skeleton')).toHaveLength(0);
    expect(page.querySelector('.cards')?.getAttribute('aria-busy')).not.toBe(
      'true',
    );
  });

  // @traces 227-FR-006
  it('shows the failure in English with the same retry', async () => {
    const page = await render([], { failed: true, language: 'en' });

    expect(said(page.querySelector('[role="alert"]'))).toContain(
      'We could not load the garages',
    );
  });

  // @traces 227-FR-006
  it('replaces the cards with skeletons when the read starts again', async () => {
    const page = await render([garageOf()]);

    fixture.componentRef.setInput('loading', true);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(cards(page)).toHaveLength(0);
    expect(page.querySelectorAll('.card.skeleton')).toHaveLength(3);
  });

  // @traces 227-FR-002
  it('shows three cards for three garages and keeps their order', async () => {
    const page = await render([
      garageOf({ id: '1', name: 'Zed', slug: 'zed' }),
      garageOf({ id: '2', name: 'Alfa', slug: 'alfa' }),
      garageOf({ id: '3', name: 'Mid', slug: 'mid', stance: 'unstated' }),
    ]);

    expect(
      cards(page).map((card) => said(card.querySelector('.name'))),
    ).toEqual(['Zed', 'Alfa', 'Mid']);
  });

  // @traces 227-FR-014
  it('names a card in English', async () => {
    const [card] = cards(await render([garageOf()], { language: 'en' }));

    expect(card.getAttribute('aria-label')).toBe(
      'Service Auto Militari, Works on BMW, 4.9',
    );
  });

  // @traces 227-FR-014
  it('marks the error message as an alert and never the cards area when loaded', async () => {
    const page = await render([garageOf()]);

    expect(page.querySelector('[role="alert"]')).toBeNull();
  });

  // @traces 227-FR-007
  it('names the section after the new brand when the brand changes', async () => {
    const page = await render([garageOf()]);
    const dacia: BrandDto = {
      id: 'd',
      name: 'Dacia',
      popularity: 2,
      slug: 'dacia',
    };

    fixture.componentRef.setInput('brand', dacia);
    fixture.componentRef.setInput('results', {
      commands: ['/', 'ro', 'garages'],
      queryParams: { brand: 'dacia' },
    });
    fixture.detectChanges();
    await fixture.whenStable();

    expect(said(page.querySelector('section h2'))).toBe('Cine primește Dacia');
    expect(
      page.querySelector<HTMLAnchorElement>('a.all')?.getAttribute('href'),
    ).toBe('/ro/garages?brand=dacia');
    expect(cards(page)[0].getAttribute('href')).toBe(
      '/ro/garages/service-auto-militari?brand=dacia',
    );
  });
});
