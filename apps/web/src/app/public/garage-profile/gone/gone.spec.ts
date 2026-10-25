import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type {
  BrandRefDto,
  SimilarGarageDto,
  SimilarGaragesDto,
} from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';

import { Gone } from './gone';

const BMW: BrandRefDto = { id: 'b-bmw', name: 'BMW', slug: 'bmw' };
const DACIA: BrandRefDto = { id: 'b-dacia', name: 'Dacia', slug: 'dacia' };

const card = (
  slug: string,
  brand: BrandRefDto = BMW,
  over: Partial<SimilarGarageDto> = {},
): SimilarGarageDto => ({
  brand,
  brandNote: null,
  businessKind: 'company',
  city: 'București',
  distanceKm: 1.2,
  doesNotTake: [],
  facilities: [],
  id: slug,
  labourFromLei: null,
  name: `Service ${slug}`,
  rating: null,
  refusalPhrase: null,
  reviewCount: 0,
  slug,
  stance: 'works_on',
  worksOn: [brand],
  ...over,
});

async function render(
  language: 'ro' | 'en',
  {
    missing = false,
    similar,
  }: { missing?: boolean; similar?: SimilarGaragesDto | null } = {},
) {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
    ],
  });
  const i18n = TestBed.inject(I18n);
  await i18n.enter('public');
  await i18n.use(language);
  const fixture = TestBed.createComponent(Gone);
  fixture.componentRef.setInput('missing', missing);
  if (similar !== undefined) fixture.componentRef.setInput('similar', similar);
  fixture.detectChanges();
  await fixture.whenStable();
  return fixture.nativeElement as HTMLElement;
}

const said = (el: Element | null | undefined) =>
  el?.textContent?.replace(/\s+/g, ' ').trim();

// @traces 307-FR-015 385-FR-008
describe('the no-longer-available view', () => {
  it('says the garage is no longer on MotorFix, in Romanian', async () => {
    const page = await render('ro', { similar: null });

    expect(said(page.querySelector('h1'))).toBe(
      'Acest service nu mai este disponibil pe MotorFix.',
    );
  });

  it('says the same in English', async () => {
    const page = await render('en', { similar: null });

    expect(said(page.querySelector('h1'))).toBe(
      'This garage is no longer available on MotorFix.',
    );
  });

  it('says the page does not exist for a garage nobody can see, inside the site frame', async () => {
    const page = await render('ro', { missing: true });

    expect(said(page.querySelector('h1'))).toBe('Pagina nu există');
    expect(page.textContent).toContain(
      'Adresa nu duce la nicio pagină MotorFix.',
    );
    expect(page.querySelector('a')?.getAttribute('href')).toBe('/ro');
    expect(page.querySelector('main, header')).toBeNull();
    expect(page.querySelector('mf-result-card')).toBeNull();
  });

  it('never draws a card for a garage nobody can see, even when handed some', async () => {
    const page = await render('ro', {
      missing: true,
      similar: { brand: BMW, items: [card('alfa')] },
    });

    expect(page.querySelector('mf-result-card')).toBeNull();
    expect(page.textContent).not.toContain('Service‑uri similare');
  });
});

// @traces 385-FR-008 385-FR-009 385-FR-011
describe('the similar garages on the no-longer-available view', () => {
  it('lists each similar garage as a result card, one per list item, under the line after the heading', async () => {
    const page = await render('ro', {
      similar: {
        brand: BMW,
        items: [card('alfa'), card('beta'), card('gamma')],
      },
    });

    const line = page.querySelector('h1 ~ p');
    expect(said(line)).toBe('Service‑uri similare în apropiere');
    const items = page.querySelectorAll('ul > li');
    expect(items).toHaveLength(3);
    for (const item of Array.from(items))
      expect(item.querySelectorAll('mf-result-card')).toHaveLength(1);
    expect(
      Array.from(page.querySelectorAll('mf-result-card h2')).map(said),
    ).toEqual(['Service alfa', 'Service beta', 'Service gamma']);
  });

  it('says the line in English', async () => {
    const page = await render('en', {
      similar: { brand: BMW, items: [card('alfa')] },
    });

    expect(said(page.querySelector('h1 ~ p'))).toBe('Similar garages nearby');
  });

  it("opens each garage's profile with the brand the card was drawn for", async () => {
    const page = await render('ro', {
      similar: {
        brand: null,
        items: [card('alfa', DACIA), card('beta', BMW)],
      },
    });

    const links = Array.from(
      page.querySelectorAll('mf-result-card a.view'),
    ).map((a) => a.getAttribute('href'));
    expect(links).toEqual([
      '/ro/garages/alfa?brand=dacia',
      '/ro/garages/beta?brand=bmw',
    ]);
  });

  it('shows no more than 3 cards', async () => {
    const page = await render('ro', {
      similar: {
        brand: BMW,
        items: ['a', 'b', 'c', 'd'].map((slug) => card(slug)),
      },
    });

    expect(page.querySelectorAll('mf-result-card')).toHaveLength(3);
  });

  it('never names the garage that is gone', async () => {
    const page = await render('ro', {
      similar: { brand: BMW, items: [card('alfa')] },
    });

    expect(page.querySelectorAll('h1')).toHaveLength(1);
    expect(page.textContent).not.toContain('undefined');
  });

  it('leads to the results for the brand when nothing similar is nearby', async () => {
    const page = await render('ro', { similar: { brand: BMW, items: [] } });

    expect(page.querySelector('mf-result-card')).toBeNull();
    expect(page.textContent).not.toContain('Service‑uri similare');
    const link = page.querySelector('a');
    expect(said(link)).toBe('Caută un service pentru BMW');
    expect(link?.getAttribute('href')).toBe('/ro/garages?brand=bmw');
  });

  it('says the brand link in English', async () => {
    const page = await render('en', { similar: { brand: BMW, items: [] } });

    const link = page.querySelector('a');
    expect(said(link)).toBe('Find a garage for BMW');
    expect(link?.getAttribute('href')).toBe('/en/garages?brand=bmw');
  });

  it.each([
    ['the link had no brand', { brand: null, items: [] }],
    ['the read failed', null],
  ])('leads home to search when %s', async (_, similar) => {
    const page = await render('ro', { similar });

    expect(page.querySelector('mf-result-card')).toBeNull();
    const link = page.querySelector('a');
    expect(said(link)).toBe('Caută un service');
    expect(link?.getAttribute('href')).toBe('/ro');
    expect(page.querySelector('[role="alert"], .error')).toBeNull();
  });

  it('says the home link in English', async () => {
    const page = await render('en', { similar: null });

    const link = page.querySelector('a');
    expect(said(link)).toBe('Find a garage');
    expect(link?.getAttribute('href')).toBe('/en');
  });
});
