import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import {
  ClockPipe,
  DayPipe,
  KmPipe,
  LeiPipe,
  NumPipe,
  PctPipe,
  RatingPipe,
} from './format.pipes';
import { I18n } from './i18n';

@Component({
  imports: [ClockPipe, DayPipe, KmPipe, LeiPipe, NumPipe, PctPipe, RatingPipe],
  template: `
    <p id="price">{{ price | lei }}</p>
    <p id="range">{{ from | lei: to }}</p>
    <p id="rating">{{ rating | rating }}</p>
    <p id="count">{{ count | num }}</p>
    <p id="distance">{{ distance | km }}</p>
    <p id="share">{{ share | pct }}</p>
    <p id="day">{{ at | day }}</p>
    <p id="clock">{{ at | clock }}</p>
  `,
})
class Host {
  readonly price = 140000;
  readonly from = 80000;
  readonly to = 120000;
  readonly rating = 4.9;
  readonly count = 12345.6;
  readonly distance = 2.5;
  readonly share = 92;
  readonly at = '2026-03-09T12:30:00Z';
}

const ROMANIAN = {
  clock: '14:30',
  count: '12.345,6',
  day: '9 mart. 2026',
  distance: '2,5 km',
  price: '1.400 lei',
  range: '800–1.200 lei',
  rating: '4,9',
  share: '92%',
};

const ENGLISH = {
  clock: '14:30',
  count: '12,345.6',
  day: '9 Mar 2026',
  distance: '2.5 km',
  price: '1,400 lei',
  range: '800–1,200 lei',
  rating: '4.9',
  share: '92%',
};

function read(view: HTMLElement): Record<string, string | undefined> {
  return Object.fromEntries(
    [...view.querySelectorAll('p')].map((p) => [p.id, p.textContent?.trim()]),
  );
}

describe('format pipes', () => {
  it('render Romanian first and change every format in place with the language', async () => {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const view = fixture.nativeElement as HTMLElement;
    const price = view.querySelector('#price');

    expect(read(view)).toEqual(ROMANIAN);

    const i18n = TestBed.inject(I18n);
    await i18n.use('en');
    await fixture.whenStable();

    expect(view.querySelector('#price')).toBe(price);
    expect(read(view)).toEqual(ENGLISH);

    await i18n.use('ro');
    await fixture.whenStable();

    expect(read(view)).toEqual(ROMANIAN);
  });

  it('show a dash for a missing value', async () => {
    @Component({
      imports: [LeiPipe, DayPipe],
      template: `<p id="price">{{ none | lei }}</p><p id="day">{{ none | day }}</p>`,
    })
    class Empty {
      readonly none = null;
    }

    const fixture = TestBed.createComponent(Empty);
    await fixture.whenStable();

    expect(read(fixture.nativeElement)).toEqual({ day: '—', price: '—' });
  });
});
