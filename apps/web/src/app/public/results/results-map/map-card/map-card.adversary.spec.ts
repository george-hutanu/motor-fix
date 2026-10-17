import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type {
  BrandRefDto,
  GaragePinDto,
  ListedGarageDto,
} from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';

import { MapCard } from './map-card';

const BMW: BrandRefDto = { id: 'b-bmw', name: 'BMW', slug: 'bmw' };
const PIN: GaragePinDto = {
  id: 'militari',
  lat: 44.43,
  lng: 26.03,
  rateLei: 180,
  stance: 'works_on',
};
const GARAGE: ListedGarageDto = {
  brandNote: null,
  businessKind: 'company',
  city: 'București',
  distanceKm: 2.4,
  doesNotTake: [],
  facilities: [],
  id: 'militari',
  labourFromLei: 180,
  name: 'Service Auto Militari',
  rating: 4.9,
  refusalPhrase: null,
  reviewCount: 212,
  slug: 'service-auto-militari',
  stance: 'works_on',
  worksOn: [BMW],
};

let fixture: ComponentFixture<MapCard>;

beforeEach(async () => {
  TestBed.configureTestingModule({ providers: [provideRouter([])] });
  await TestBed.inject(I18n).enter('public');
});

async function render(
  pin: GaragePinDto,
  garage?: ListedGarageDto,
  brand: BrandRefDto = BMW,
) {
  fixture = TestBed.createComponent(MapCard);
  fixture.componentRef.setInput('brand', brand);
  fixture.componentRef.setInput('pin', pin);
  fixture.componentRef.setInput('garage', garage);
  fixture.detectChanges();
  await fixture.whenStable();
  return fixture.nativeElement as HTMLElement;
}

const said = (el: Element | null | undefined) =>
  el?.textContent?.replace(/\s+/g, ' ').trim();

// @traces 270-card-pin-link-FR-010
describe('the small card on the map, under attack', () => {
  it('shows a rate line for a rate of zero lei', async () => {
    const card = await render({ ...PIN, rateLei: 0 });

    expect(said(card.querySelector('.rate'))).toBe('de la 0 lei/oră');
  });

  it('shows the name of a garage with an unrated, reviewless profile and no dial value', async () => {
    const card = await render(PIN, { ...GARAGE, rating: null, reviewCount: 0 });

    expect(said(card.querySelector('.name'))).toBe('Service Auto Militari');
    expect(said(card.querySelector('.reviews'))).toBe('Fără recenzii');
  });

  it('keeps hostile text in a name as text', async () => {
    const card = await render(PIN, {
      ...GARAGE,
      name: '<img src=x onerror=alert(1)> Șerban & Fiii',
    });

    expect(card.querySelector('img')).toBeNull();
    expect(said(card.querySelector('.name'))).toBe(
      '<img src=x onerror=alert(1)> Șerban & Fiii',
    );
  });

  it('encodes a brand slug with reserved characters in the link', async () => {
    const card = await render(PIN, GARAGE, { ...BMW, slug: 'a&b=c d' });

    const href = card.querySelector('a.view')?.getAttribute('href') ?? '';
    expect(href).toBe('/ro/garages/service-auto-militari?brand=a%26b%3Dc%20d');
  });

  it('turns from skeleton to name when the garage arrives, with one lamp throughout', async () => {
    const card = await render(PIN);
    fixture.componentRef.setInput('garage', GARAGE);
    fixture.detectChanges();

    expect(card.querySelector('.skeleton')).toBeNull();
    expect(card.querySelectorAll('mf-lamp')).toHaveLength(1);
    expect(said(card.querySelector('.name'))).toBe('Service Auto Militari');
  });

  it('goes back to the skeleton when the garage is withdrawn', async () => {
    const card = await render(PIN, GARAGE);
    fixture.componentRef.setInput('garage', undefined);
    fixture.detectChanges();

    expect(card.querySelector('.name.skeleton')).not.toBeNull();
    expect(card.querySelector('a.view')).toBeNull();
  });

  it('shows the pin stance rather than the garage stance for the lamp', async () => {
    const card = await render(
      { ...PIN, stance: 'does_not_take' },
      { ...GARAGE, stance: 'works_on' },
    );

    expect(card.querySelector('mf-lamp[data-state="red"]')).not.toBeNull();
  });
});
