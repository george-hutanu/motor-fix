import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { BrandRefDto, ListedGarageDto } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';

import { ResultCard } from './result-card';

const BMW: BrandRefDto = { id: 'b-bmw', name: 'BMW', slug: 'bmw' };
const DACIA: BrandRefDto = { id: 'b-dacia', name: 'Dacia', slug: 'dacia' };
const TESLA: BrandRefDto = { id: 'b-tesla', name: 'Tesla', slug: 'tesla' };

const garageOf = (over: Partial<ListedGarageDto> = {}): ListedGarageDto => ({
  brandNote: null,
  businessKind: 'company',
  city: 'București',
  distanceKm: 2.4,
  doesNotTake: [TESLA],
  facilities: ['courtesy_car', 'waiting_area'],
  id: 'militari',
  labourFromLei: 180,
  name: 'Service Auto Militari',
  rating: 4.9,
  refusalPhrase: null,
  reviewCount: 212,
  slug: 'service-auto-militari',
  stance: 'works_on',
  worksOn: [BMW, DACIA],
  ...over,
});

let fixture: ComponentFixture<ResultCard>;

beforeEach(async () => {
  TestBed.configureTestingModule({ providers: [provideRouter([])] });
  await TestBed.inject(I18n).enter('public');
});

async function render(
  garage: ListedGarageDto,
  { language = 'ro' as 'ro' | 'en' } = {},
) {
  if (language === 'en') await TestBed.inject(I18n).use('en');
  fixture = TestBed.createComponent(ResultCard);
  fixture.componentRef.setInput('brand', BMW);
  fixture.componentRef.setInput('garage', garage);
  fixture.detectChanges();
  await fixture.whenStable();
  return fixture.nativeElement as HTMLElement;
}

const said = (el: Element | null | undefined) =>
  el?.textContent?.replace(/\s+/g, ' ').trim();

// @traces 267-FR-014
describe('ResultCard', () => {
  // @traces 267-brand-results-FR-014
  it('draws the initials of the first two words of the name, hidden from screen readers', async () => {
    const card = await render(garageOf());

    const initials = card.querySelector('.initials');
    expect(said(initials)).toBe('SA');
    expect(initials?.getAttribute('aria-hidden')).toBe('true');
    expect(said(card.querySelector('h3'))).toBe('Service Auto Militari');
  });

  // @traces 267-brand-results-FR-014
  it('draws one initial for a one-word name', async () => {
    const card = await render(garageOf({ name: 'dinamo' }));

    expect(said(card.querySelector('.initials'))).toBe('D');
  });

  // @traces 267-brand-results-FR-014
  it('says the city and the distance on the area line', async () => {
    const card = await render(garageOf());

    expect(said(card.querySelector('.where'))).toBe('București · 2,4 km');
  });

  // @traces 267-brand-results-FR-014
  it('says only the distance when the city is unknown', async () => {
    const card = await render(garageOf({ city: undefined }));

    expect(said(card.querySelector('.where'))).toBe('2,4 km');
  });

  // @traces 267-brand-results-FR-014
  it('says a mobile mechanic comes to you, with its radius, never a city', async () => {
    const card = await render(
      garageOf({
        businessKind: 'mobile',
        city: 'Chiajna',
        distanceKm: null,
        serviceRadiusKm: 20,
      }),
    );

    expect(said(card.querySelector('.where'))).toBe(
      'Mecanic mobil · vine la tine · rază 20 km',
    );
    expect(card.textContent).not.toContain('Chiajna');
  });

  // @traces 267-brand-results-FR-014
  it('lights the lamp green for a garage that takes the brand', async () => {
    const card = await render(garageOf());

    const lamp = card.querySelector('mf-lamp');
    expect(lamp?.getAttribute('data-state')).toBe('green');
    expect(said(lamp)).toBe('primește BMW');
  });

  // @traces 267-brand-results-FR-014
  it.each(['does_not_take', 'unstated'] as const)(
    'lights the lamp red for a garage whose stance is %s',
    async (stance) => {
      const card = await render(garageOf({ stance }));

      const lamp = card.querySelector('mf-lamp');
      expect(lamp?.getAttribute('data-state')).toBe('red');
      expect(said(lamp)).toBe('nu primește BMW');
    },
  );

  // @traces 267-brand-results-FR-014
  it('lists the brands it works on and those it does not take', async () => {
    const card = await render(garageOf());

    const lists = [...card.querySelectorAll('.list')].map(said);
    expect(lists).toEqual(['Lucrează pe BMW, Dacia', 'Nu primește Tesla']);
  });

  // @traces 267-brand-results-FR-014
  it('shows the listed facilities as tags, in the order they came', async () => {
    const card = await render(
      garageOf({ facilities: ['courtesy_car', 'pickup_dropoff'] }),
    );

    expect([...card.querySelectorAll('.tags li')].map(said)).toEqual([
      'Mașină la schimb',
      'Preluare și predare',
    ]);
  });

  // @traces 267-brand-results-FR-014
  it('shows no tag list when nothing is listed', async () => {
    const card = await render(garageOf({ facilities: [] }));

    expect(card.querySelector('.tags')).toBeNull();
  });

  // @traces 267-brand-results-FR-014
  it('shows the labour rate in tabular numerals, the review count and the rating dial', async () => {
    const card = await render(garageOf());

    expect(said(card.querySelector('.rate'))).toBe('de la 180 lei pe oră');
    expect(said(card.querySelector('.reviews'))).toBe('212 recenzii');
    expect(said(card.querySelector('mf-rating-dial .mf-dial-value'))).toBe(
      '4,9',
    );
    const css = readFileSync(join(__dirname, 'result-card.css'), 'utf8');
    expect(css).toMatch(/\.rate[^{]*\{[^}]*font-variant-numeric: tabular-nums/);
  });

  // @traces 267-brand-results-FR-014
  it('shows no rate before one is set, "Fără recenzii" and an empty dial before a review', async () => {
    const card = await render(
      garageOf({ labourFromLei: null, rating: null, reviewCount: 0 }),
    );

    expect(card.querySelector('.rate')).toBeNull();
    expect(said(card.querySelector('.reviews'))).toBe('Fără recenzii');
    expect(said(card.querySelector('mf-rating-dial .mf-dial-value'))).toBe('—');
  });

  // @traces 267-brand-results-FR-014
  it('links to the garage with the brand, and carries no save button', async () => {
    const card = await render(garageOf());

    const link = card.querySelector<HTMLAnchorElement>('a.view');
    expect(said(link)).toBe('Vezi service‑ul');
    expect(link?.getAttribute('href')).toBe(
      '/ro/garages/service-auto-militari?brand=bmw',
    );
    expect(card.querySelector('button')).toBeNull();
    expect(card.textContent).not.toMatch(/Salvează|Save/);
  });

  // @traces 267-brand-results-FR-014
  it('speaks English', async () => {
    const card = await render(
      garageOf({ reviewCount: 1, stance: 'does_not_take' }),
      { language: 'en' },
    );

    expect(said(card.querySelector('mf-lamp'))).toBe("doesn't take BMW");
    expect(said(card.querySelector('.rate'))).toBe('from 180 lei per hour');
    expect(said(card.querySelector('.reviews'))).toBe('1 review');
    expect([...card.querySelectorAll('.list')].map(said)).toEqual([
      'Works on BMW, Dacia',
      "Doesn't take Tesla",
    ]);
    const link = card.querySelector<HTMLAnchorElement>('a.view');
    expect(said(link)).toBe('View garage');
    expect(link?.getAttribute('href')).toBe(
      '/en/garages/service-auto-militari?brand=bmw',
    );
  });

  // @traces 267-brand-results-FR-014
  it('says a mobile mechanic comes to you in English too', async () => {
    const card = await render(
      garageOf({
        businessKind: 'mobile',
        city: undefined,
        serviceRadiusKm: 15,
      }),
      { language: 'en' },
    );

    expect(said(card.querySelector('.where'))).toBe(
      'Mobile mechanic · comes to you · 15 km radius',
    );
  });
});
