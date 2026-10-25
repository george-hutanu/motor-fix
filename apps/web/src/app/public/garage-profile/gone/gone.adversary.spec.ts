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

const card = (slug: string, brand: BrandRefDto = BMW): SimilarGarageDto => ({
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
});

async function render(
  language: 'ro' | 'en',
  inputs: { missing?: boolean; similar?: unknown } = {},
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
  if (inputs.missing !== undefined)
    fixture.componentRef.setInput('missing', inputs.missing);
  if (inputs.similar !== undefined)
    fixture.componentRef.setInput('similar', inputs.similar);
  fixture.detectChanges();
  await fixture.whenStable();
  return fixture.nativeElement as HTMLElement;
}

const said = (el: Element | null | undefined) =>
  el?.textContent?.replace(/\s+/g, ' ').trim();

// @traces 385-FR-008 385-FR-009 385-FR-011
describe('the no-longer-available view with hostile answers', () => {
  it('shows exactly 3 cards for a thousand items', async () => {
    const items = Array.from({ length: 1000 }, (_, i) => card(`g${i}`));

    const page = await render('ro', { similar: { brand: BMW, items } });

    expect(page.querySelectorAll('mf-result-card')).toHaveLength(3);
    expect(page.querySelectorAll('ul > li')).toHaveLength(3);
  });

  it('shows the one card when exactly one is found, with no empty slots', async () => {
    const page = await render('ro', {
      similar: { brand: BMW, items: [card('alfa')] },
    });

    expect(page.querySelectorAll('mf-result-card')).toHaveLength(1);
    expect(page.querySelectorAll('ul > li')).toHaveLength(1);
    expect(page.querySelectorAll('a[href="/ro"]')).toHaveLength(0);
  });

  it('keeps one heading and no search link when cards are shown', async () => {
    const page = await render('en', {
      similar: { brand: BMW, items: [card('alfa')] },
    });

    expect(page.querySelectorAll('h1')).toHaveLength(1);
    expect(page.textContent).not.toContain('Find a garage');
  });

  it('falls back to the search link when the answer has no items list', async () => {
    const page = await render('ro', { similar: { brand: BMW } });

    expect(page.querySelector('mf-result-card')).toBeNull();
    expect(said(page.querySelector('a'))).toBe('Caută un service pentru BMW');
  });

  it('draws no search link and no card while the read is still pending', async () => {
    const page = await render('ro');

    expect(said(page.querySelector('h1'))).toBe(
      'Acest service nu mai este disponibil pe MotorFix.',
    );
    expect(page.querySelector('mf-result-card')).toBeNull();
    expect(page.querySelector('[role="alert"], .error')).toBeNull();
  });

  it('prints a brand name with markup as text, not as elements', async () => {
    const evil: BrandRefDto = {
      id: 'x',
      name: '<img src=x onerror=1>',
      slug: 'x',
    };

    const page = await render('en', { similar: { brand: evil, items: [] } });

    expect(page.querySelector('img')).toBeNull();
    expect(said(page.querySelector('a'))).toBe(
      'Find a garage for <img src=x onerror=1>',
    );
  });

  it('keeps accents in the brand name and encodes the slug in the search address', async () => {
    const odd: BrandRefDto = { id: 'c', name: 'Citroën', slug: 'citro&en=1' };

    const page = await render('ro', { similar: { brand: odd, items: [] } });

    const link = page.querySelector('a');
    expect(said(link)).toBe('Caută un service pentru Citroën');
    expect(link?.getAttribute('href')).toBe('/ro/garages?brand=citro%26en%3D1');
  });

  it('draws no search link for a garage nobody can see, even with an empty answer', async () => {
    const page = await render('en', {
      missing: true,
      similar: { brand: BMW, items: [] } satisfies SimilarGaragesDto,
    });

    expect(said(page.querySelector('h1'))).toBe('Page not found');
    expect(page.querySelectorAll('a')).toHaveLength(1);
    expect(page.querySelector('a')?.getAttribute('href')).toBe('/en');
  });

  it('opens a card with the brand slug encoded', async () => {
    const odd: BrandRefDto = { id: 'o', name: 'O', slug: 'a&b' };

    const page = await render('ro', {
      similar: { brand: null, items: [card('alfa', odd)] },
    });

    expect(
      page.querySelector('mf-result-card a.view')?.getAttribute('href'),
    ).toBe('/ro/garages/alfa?brand=a%26b');
  });
});
