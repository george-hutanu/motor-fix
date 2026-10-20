import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
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
    expect(said(card.querySelector('h2'))).toBe('Service Auto Militari');
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

  // @traces 271-FR-006
  it('keeps the distance in one piece, so "km" never wraps away from its number', async () => {
    const card = await render(garageOf());

    expect(said(card.querySelector('.where .distance'))).toBe('2,4 km');
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
  it('links to the garage with the brand', async () => {
    const card = await render(garageOf());

    const link = card.querySelector<HTMLAnchorElement>('a.view');
    expect(said(link)).toBe('Vezi service‑ul');
    expect(link?.getAttribute('href')).toBe(
      '/ro/garages/service-auto-militari?brand=bmw',
    );
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

// @traces 290-FR-010
describe('the bookmark on a card', () => {
  it('is the icon-only save button for the garage, outside the profile link', async () => {
    const card = await render(garageOf());

    const save = card.querySelector('mf-save-garage-button button');
    expect(save?.getAttribute('aria-label')).toBe('Salvează');
    expect(save?.closest('a')).toBeNull();
    expect(save?.textContent?.trim()).toBe('');
  });

  it("sits in the card's top-right corner, not in the rating row", async () => {
    const card = await render(garageOf());

    const article = card.querySelector('article.card');
    expect(article?.lastElementChild?.tagName).toBe('MF-SAVE-GARAGE-BUTTON');
    expect(card.querySelector('.score mf-save-garage-button')).toBeNull();
  });
});

// @traces 270-FR-002
// @traces 270-FR-003
// @traces 270-FR-004
// @traces 270-FR-007
// @traces 270-FR-011
describe('a result card linked with its pin', () => {
  const pointer = (type: string, pointerType = 'mouse') => {
    const event = new Event(type);
    Object.defineProperty(event, 'pointerType', { value: pointerType });
    return event;
  };
  let points: boolean[];
  let picks: number;

  async function linked(selected = false) {
    const card = await render(garageOf());
    fixture.componentRef.setInput('selected', selected);
    fixture.detectChanges();
    points = [];
    picks = 0;
    fixture.componentInstance.point.subscribe((on) => points.push(on));
    fixture.componentInstance.pick.subscribe(() => picks++);
    return card;
  }

  it('says it is pointed at while a mouse or pen rests on it, and no longer once it leaves', async () => {
    const card = await linked();

    card.dispatchEvent(pointer('pointerenter'));
    card.dispatchEvent(pointer('pointerleave'));
    card.dispatchEvent(pointer('pointerenter', 'pen'));

    expect(points).toEqual([true, false, true]);
  });

  it('is never pointed at by a touch', async () => {
    const card = await linked();

    card.dispatchEvent(pointer('pointerenter', 'touch'));
    card.dispatchEvent(pointer('pointerleave', 'touch'));

    expect(points).toEqual([]);
  });

  it('is pointed at while its link or button holds the focus, and no longer once the focus leaves the card', async () => {
    const card = await linked();
    const link = card.querySelector<HTMLAnchorElement>('a.view');
    const button = card.querySelector<HTMLButtonElement>('.bookmark button');

    link?.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    link?.dispatchEvent(
      new FocusEvent('focusout', { bubbles: true, relatedTarget: button }),
    );
    button?.dispatchEvent(
      new FocusEvent('focusout', { bubbles: true, relatedTarget: null }),
    );

    expect(points).toEqual([true, false]);
  });

  it('is picked by a tap anywhere on it but its link and its bookmark', async () => {
    const card = await linked();
    // The link still navigates; here to nowhere, so the router is stubbed.
    jest.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);

    card
      .querySelector('h2')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    card
      .querySelector('a.view')
      ?.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true }),
      );
    card
      .querySelector('.bookmark button')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(picks).toBe(1);
  });

  it('shows the selected state, an amber border on the amber tint and an amber name, only when selected', async () => {
    const card = await linked();

    expect(card.querySelector('article.card.selected')).toBeNull();

    fixture.componentRef.setInput('selected', true);
    fixture.detectChanges();

    expect(card.querySelector('article.card.selected')).not.toBeNull();
    const css = readFileSync(join(__dirname, 'result-card.css'), 'utf8');
    const rule = css.match(/\.card\.selected\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(rule).toMatch(/border-color:\s*var\(--mf-amber-ink\)/);
    expect(rule).toMatch(/background:\s*var\(--mf-amber-tint\)/);
    expect(css).toMatch(
      /\.card\.selected h2\s*\{[^}]*color:\s*var\(--mf-amber-ink\)/,
    );
  });

  it('changes nothing on itself while only pointed at', async () => {
    const card = await linked();

    card.dispatchEvent(pointer('pointerenter'));
    fixture.detectChanges();

    expect(card.querySelector('article.card.selected')).toBeNull();
  });

  it('scrolls itself into view at the nearest edge, smoothly or at once, without taking the focus', async () => {
    const card = await linked();
    const scroll = jest.fn();
    card.scrollIntoView = scroll;
    const focused = document.activeElement;

    fixture.componentInstance.reveal(true);
    fixture.componentInstance.reveal(false);

    expect(scroll.mock.calls).toEqual([
      [{ behavior: 'smooth', block: 'nearest' }],
      [{ behavior: 'auto', block: 'nearest' }],
    ]);
    expect(document.activeElement).toBe(focused);
  });

  // @traces 1358-FR-005
  it('scrolls only the list box that holds it, never the page, to its nearest edge', async () => {
    const card = await linked();
    const box = document.createElement('div');
    box.style.overflowY = 'auto';
    card.before(box);
    box.append(card);
    const page = jest.fn();
    card.scrollIntoView = page;
    const scrolled = jest.fn();
    box.scrollBy = scrolled as typeof box.scrollBy;
    box.getBoundingClientRect = () => ({ bottom: 300, top: 100 }) as DOMRect;
    const at = (top: number, bottom: number) => {
      card.getBoundingClientRect = () => ({ bottom, top }) as DOMRect;
    };

    at(350, 430);
    fixture.componentInstance.reveal(true);
    at(40, 120);
    fixture.componentInstance.reveal(false);
    at(150, 250);
    fixture.componentInstance.reveal(true);
    // Taller than the box: its top edge comes into view.
    at(250, 600);
    fixture.componentInstance.reveal(false);

    expect(scrolled.mock.calls).toEqual([
      [{ behavior: 'smooth', top: 130 }],
      [{ behavior: 'auto', top: -60 }],
      [{ behavior: 'auto', top: 150 }],
    ]);
    expect(page).not.toHaveBeenCalled();
    box.remove();
  });

  it('adds nothing to the tab order', async () => {
    const card = await linked();

    expect(card.getAttribute('tabindex')).toBeNull();
    expect(card.querySelector('article')?.getAttribute('tabindex')).toBeNull();
  });
});
