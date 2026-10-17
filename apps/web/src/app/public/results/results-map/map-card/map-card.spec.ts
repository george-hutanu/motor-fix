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
  language: 'ro' | 'en' = 'ro',
) {
  if (language === 'en') await TestBed.inject(I18n).use('en');
  fixture = TestBed.createComponent(MapCard);
  fixture.componentRef.setInput('brand', BMW);
  fixture.componentRef.setInput('pin', pin);
  fixture.componentRef.setInput('garage', garage);
  fixture.detectChanges();
  await fixture.whenStable();
  return fixture.nativeElement as HTMLElement;
}

const said = (el: Element | null | undefined) =>
  el?.textContent?.replace(/\s+/g, ' ').trim();

// @traces 270-FR-010
// @traces 270-FR-011
describe('the small card on the map', () => {
  it('shows the green lamp and the rate of the pin at once, and a placeholder for the name', async () => {
    const card = await render(PIN);

    expect(said(card.querySelector('mf-lamp'))).toBe('primește BMW');
    expect(card.querySelector('mf-lamp[data-state="green"]')).not.toBeNull();
    expect(said(card.querySelector('.rate'))).toBe('de la 180 lei/oră');
    expect(card.querySelector('.name.skeleton')).not.toBeNull();
    expect(card.querySelector('a.view')).toBeNull();
  });

  it('shows the red lamp for a garage that does not take the brand, and no rate line without a rate', async () => {
    const card = await render({
      ...PIN,
      rateLei: null,
      stance: 'does_not_take',
    });

    expect(said(card.querySelector('mf-lamp'))).toBe('nu primește BMW');
    expect(card.querySelector('mf-lamp[data-state="red"]')).not.toBeNull();
    expect(card.querySelector('.rate')).toBeNull();
  });

  it('fills the name, the rating and the link to the garage with the brand once read', async () => {
    const card = await render(PIN, GARAGE);

    expect(said(card.querySelector('.name'))).toBe('Service Auto Militari');
    expect(card.querySelector('.name.skeleton')).toBeNull();
    expect(said(card.querySelector('.reviews'))).toBe('212 recenzii');
    expect(said(card.querySelector('mf-rating-dial .mf-dial-value'))).toBe(
      '4,9',
    );
    const link = card.querySelector<HTMLAnchorElement>('a.view');
    expect(said(link)).toBe('Vezi service‑ul');
    expect(link?.getAttribute('href')).toBe(
      '/ro/garages/service-auto-militari?brand=bmw',
    );
  });

  it('says "Fără recenzii" for a garage with no review yet', async () => {
    const card = await render(PIN, {
      ...GARAGE,
      rating: null,
      reviewCount: 0,
    });

    expect(said(card.querySelector('.reviews'))).toBe('Fără recenzii');
  });

  it('speaks English', async () => {
    const card = await render(PIN, GARAGE, 'en');

    expect(said(card.querySelector('a.view'))).toBe('View garage');
  });

  it('takes no focus and is no dialog: its link is its one tab stop', async () => {
    const card = await render(PIN, GARAGE);

    expect(card.contains(document.activeElement)).toBe(false);
    expect(card.querySelector('[role="dialog"]')).toBeNull();
    expect(card.querySelectorAll('a, button, [tabindex]')).toHaveLength(1);
  });
});
