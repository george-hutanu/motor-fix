import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { BrandRefDto, ListedGarageDto } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';

import { ResultCard } from './result-card';
import { ProfilePrefetch } from '../../profile-prefetch/profile-prefetch';

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
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
    ],
  });
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
  // @traces 267-FR-014
  it('draws the initials of the first two words of the name, hidden from screen readers', async () => {
    const card = await render(garageOf());

    const initials = card.querySelector('.initials');
    expect(said(initials)).toBe('SA');
    expect(initials?.getAttribute('aria-hidden')).toBe('true');
    expect(said(card.querySelector('h3'))).toBe('Service Auto Militari');
  });

  // @traces 267-FR-014
  it('draws one initial for a one-word name', async () => {
    const card = await render(garageOf({ name: 'dinamo' }));

    expect(said(card.querySelector('.initials'))).toBe('D');
  });

  // @traces 267-FR-014
  it('says the city and the distance on the area line', async () => {
    const card = await render(garageOf());

    expect(said(card.querySelector('.where'))).toBe('București · 2,4 km');
  });

  // @traces 267-FR-014
  it('says only the distance when the city is unknown', async () => {
    const card = await render(garageOf({ city: undefined }));

    expect(said(card.querySelector('.where'))).toBe('2,4 km');
  });

  // @traces 267-FR-014
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

  // @traces 267-FR-014
  it('lights the lamp green for a garage that takes the brand', async () => {
    const card = await render(garageOf());

    const lamp = card.querySelector('mf-lamp');
    expect(lamp?.getAttribute('data-state')).toBe('green');
    expect(said(lamp)).toBe('primește BMW');
  });

  // @traces 267-FR-014
  it.each(['does_not_take', 'unstated'] as const)(
    'lights the lamp red for a garage whose stance is %s',
    async (stance) => {
      const card = await render(garageOf({ stance }));

      const lamp = card.querySelector('mf-lamp');
      expect(lamp?.getAttribute('data-state')).toBe('red');
      expect(said(lamp)).toBe('nu primește BMW');
    },
  );

  // @traces 267-FR-014
  it('lists the brands it works on and those it does not take', async () => {
    const card = await render(garageOf());

    const lists = [...card.querySelectorAll('.list')].map(said);
    expect(lists).toEqual(['Lucrează pe BMW, Dacia', 'Nu primește Tesla']);
  });

  // @traces 267-FR-014
  it('shows the listed facilities as tags, in the order they came', async () => {
    const card = await render(
      garageOf({ facilities: ['courtesy_car', 'pickup_dropoff'] }),
    );

    expect([...card.querySelectorAll('.tags li')].map(said)).toEqual([
      'Mașină la schimb',
      'Preluare și predare',
    ]);
  });

  // @traces 267-FR-014
  it('shows no tag list when nothing is listed', async () => {
    const card = await render(garageOf({ facilities: [] }));

    expect(card.querySelector('.tags')).toBeNull();
  });

  // @traces 267-FR-014
  it('shows the labour rate in tabular numerals, the review count and the rating dial', async () => {
    const card = await render(garageOf());

    expect(said(card.querySelector('.rate'))).toBe('de la 180 lei/oră');
    expect(said(card.querySelector('.reviews'))).toBe('212 recenzii');
    expect(said(card.querySelector('mf-rating-dial .mf-dial-value'))).toBe(
      '4,9',
    );
    const css = readFileSync(join(__dirname, 'result-card.css'), 'utf8');
    expect(css).toMatch(/\.rate[^{]*\{[^}]*font-variant-numeric: tabular-nums/);
  });

  // @traces 267-FR-014
  it('shows no rate before one is set, "Fără recenzii" and an empty dial before a review', async () => {
    const card = await render(
      garageOf({ labourFromLei: null, rating: null, reviewCount: 0 }),
    );

    expect(card.querySelector('.rate')).toBeNull();
    expect(said(card.querySelector('.reviews'))).toBe('Fără recenzii');
    expect(said(card.querySelector('mf-rating-dial .mf-dial-value'))).toBe('—');
  });

  // @traces 267-FR-014
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

  // @traces 267-FR-014
  it('speaks English', async () => {
    const card = await render(
      garageOf({ reviewCount: 1, stance: 'does_not_take' }),
      { language: 'en' },
    );

    expect(said(card.querySelector('mf-lamp'))).toBe("doesn't take BMW");
    expect(said(card.querySelector('.rate'))).toBe('from 180 lei/hour');
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

  // @traces 267-FR-014
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

// @traces 1169-FR-007
describe('a result card about to be opened', () => {
  let observers: {
    callback: IntersectionObserverCallback;
    observed: Element[];
    disconnected: boolean;
  }[];
  let want: jest.SpyInstance;
  let cancel: jest.SpyInstance;

  beforeEach(() => {
    observers = [];
    (globalThis as Record<string, unknown>)['IntersectionObserver'] = class {
      private readonly seen;
      constructor(callback: IntersectionObserverCallback) {
        this.seen = {
          callback,
          disconnected: false,
          observed: [] as Element[],
        };
        observers.push(this.seen);
      }
      observe(target: Element) {
        this.seen.observed.push(target);
      }
      disconnect() {
        this.seen.disconnected = true;
      }
    };
    const prefetch = TestBed.inject(ProfilePrefetch);
    want = jest.spyOn(prefetch, 'want').mockImplementation(() => undefined);
    cancel = jest.spyOn(prefetch, 'cancel').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
    delete (globalThis as Record<string, unknown>)['IntersectionObserver'];
  });

  const pointer = (type: string, pointerType = 'mouse') => {
    const event = new Event(type);
    Object.defineProperty(event, 'pointerType', { value: pointerType });
    return event;
  };
  const intersect = (card: Element, isIntersecting = true) =>
    observers[0]?.callback(
      [{ isIntersecting, target: card } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    );

  it('pre-fetches its garage, with the brand, after the pointer rests on it for 100 ms', async () => {
    const card = await render(garageOf());
    jest.useFakeTimers();

    card.dispatchEvent(pointer('pointerenter'));
    jest.advanceTimersByTime(99);
    expect(want).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);

    expect(want).toHaveBeenCalledTimes(1);
    expect(want).toHaveBeenCalledWith('service-auto-militari', 'bmw');
  });

  it('cancels when the pointer leaves first, and never pre-fetches', async () => {
    const card = await render(garageOf());
    jest.useFakeTimers();

    card.dispatchEvent(pointer('pointerenter'));
    jest.advanceTimersByTime(50);
    card.dispatchEvent(pointer('pointerleave'));
    jest.advanceTimersByTime(500);

    expect(cancel).toHaveBeenCalledWith('service-auto-militari', 'bmw');
    expect(want).not.toHaveBeenCalled();
  });

  it('pre-fetches as soon as a touch starts on it, and a lifted finger cancels nothing', async () => {
    const card = await render(garageOf());

    card.dispatchEvent(new Event('touchstart'));
    card.dispatchEvent(pointer('pointerleave', 'touch'));

    expect(want).toHaveBeenCalledWith('service-auto-militari', 'bmw');
    expect(cancel).not.toHaveBeenCalled();
  });

  it('is not pre-fetched for being on screen at first paint', async () => {
    const card = await render(garageOf());

    expect(observers[0]?.observed).toEqual([card]);
    intersect(card);

    expect(want).not.toHaveBeenCalled();
  });

  it('is not pre-fetched for being on screen when drawn on a later page', async () => {
    const card = await render(garageOf());

    intersect(card);

    expect(want).not.toHaveBeenCalled();
  });

  it('is pre-fetched when it comes into view after it was drawn off screen', async () => {
    const card = await render(garageOf());

    intersect(card, false);
    expect(want).not.toHaveBeenCalled();
    intersect(card);

    expect(want).toHaveBeenCalledWith('service-auto-militari', 'bmw');
  });

  it('stops watching when it goes away', async () => {
    await render(garageOf());

    fixture.destroy();

    expect(observers[0]?.disconnected).toBe(true);
  });
});
