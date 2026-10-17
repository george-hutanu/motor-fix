import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import type { BrandRefDto, ListedGarageDto } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';

import { ResultCard } from './result-card';

const BMW: BrandRefDto = { id: 'b-bmw', name: 'BMW', slug: 'bmw' };

const garage: ListedGarageDto = {
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

let fixture: ComponentFixture<ResultCard>;
let points: boolean[];
let picks: number;

beforeEach(async () => {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
    ],
  });
  await TestBed.inject(I18n).enter('public');
  fixture = TestBed.createComponent(ResultCard);
  fixture.componentRef.setInput('brand', BMW);
  fixture.componentRef.setInput('garage', garage);
  fixture.componentRef.setInput('selected', false);
  fixture.detectChanges();
  await fixture.whenStable();
  points = [];
  picks = 0;
  fixture.componentInstance.point.subscribe((on) => points.push(on));
  fixture.componentInstance.pick.subscribe(() => picks++);
  jest.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
});

const card = () => fixture.nativeElement as HTMLElement;
const click = (el: Element | null) =>
  el?.dispatchEvent(
    new MouseEvent('click', { bubbles: true, cancelable: true }),
  );

// @traces 270-FR-003
describe('a result card tap, under attack', () => {
  it('does not pick when the tap lands on an element inside the link', () => {
    const link = card().querySelector('a.view') as HTMLElement;
    const inner = document.createElement('span');
    link.append(inner);

    click(inner);

    expect(picks).toBe(0);
  });

  it('does not pick when the tap lands on an element inside the bookmark button', () => {
    const button = card().querySelector('.bookmark button') as HTMLElement;
    const inner = document.createElement('span');
    button.append(inner);

    click(inner);

    expect(picks).toBe(0);
  });

  it('picks on a tap of the card box itself', () => {
    click(card().querySelector('article'));

    expect(picks).toBe(1);
  });

  it('picks once per tap, however many taps', () => {
    const title = card().querySelector('h2');
    click(title);
    click(title);
    click(title);

    expect(picks).toBe(3);
  });

  it('picks on a modified click on the body too', () => {
    card()
      .querySelector('h2')
      ?.dispatchEvent(
        new MouseEvent('click', { bubbles: true, ctrlKey: true }),
      );

    expect(picks).toBe(1);
  });
});

// @traces 270-FR-002
describe('a result card pointer and focus, under attack', () => {
  const pointer = (type: string, pointerType: string) => {
    const event = new Event(type);
    Object.defineProperty(event, 'pointerType', { value: pointerType });
    return event;
  };

  it('stays pointed when focus moves from the link to the button inside it', () => {
    const link = card().querySelector('a.view');
    const button = card().querySelector('.bookmark button');

    link?.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    link?.dispatchEvent(
      new FocusEvent('focusout', { bubbles: true, relatedTarget: button }),
    );
    button?.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));

    expect(points.at(-1)).toBe(true);
  });

  it('says nothing more than one leave for one enter', () => {
    const el = card();
    el.dispatchEvent(pointer('pointerenter', 'mouse'));
    el.dispatchEvent(pointer('pointerleave', 'mouse'));

    expect(points).toEqual([true, false]);
  });

  it('stays pointed when the mouse leaves while the keyboard focus is still inside', () => {
    const el = card();
    el.querySelector('a.view')?.dispatchEvent(
      new FocusEvent('focusin', { bubbles: true }),
    );
    el.dispatchEvent(pointer('pointerenter', 'mouse'));
    el.dispatchEvent(pointer('pointerleave', 'mouse'));

    expect(points.at(-1)).not.toBe(false);
  });

  it('is not pointed by an unknown pointer type', () => {
    card().dispatchEvent(pointer('pointerenter', 'touch'));
    card().dispatchEvent(pointer('pointerleave', 'touch'));

    expect(points).toEqual([]);
  });
});

// @traces 270-FR-004
describe('a result card reveal, under attack', () => {
  it('reveals the same way twice', () => {
    const scroll = jest.fn();
    card().scrollIntoView = scroll;

    fixture.componentInstance.reveal(true);
    fixture.componentInstance.reveal(true);

    expect(scroll.mock.calls).toEqual([
      [{ behavior: 'smooth', block: 'nearest' }],
      [{ behavior: 'smooth', block: 'nearest' }],
    ]);
  });
});

// @traces 270-FR-007
describe('a result card selected state, under attack', () => {
  it('leaves the lamp, the link and the bookmark in place when selected', () => {
    fixture.componentRef.setInput('selected', true);
    fixture.detectChanges();

    expect(
      card().querySelector('article.card.selected mf-lamp'),
    ).not.toBeNull();
    expect(card().querySelector('a.view')?.getAttribute('href')).toBe(
      '/ro/garages/service-auto-militari?brand=bmw',
    );
    expect(card().querySelectorAll('.selected')).toHaveLength(1);
  });

  it('drops the selected class again when deselected', () => {
    fixture.componentRef.setInput('selected', true);
    fixture.detectChanges();
    fixture.componentRef.setInput('selected', false);
    fixture.detectChanges();

    expect(card().querySelector('.selected')).toBeNull();
  });
});
