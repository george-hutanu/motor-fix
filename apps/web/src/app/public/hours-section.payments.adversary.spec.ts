import { hoursComplete } from '@motor-fix/contracts/garage-hours';

import {
  hoursOf,
  mergeHours,
  setCourtesy,
  toggleFacility,
  togglePayment,
} from './hours-section';
import { leiDigits } from './lei-input';

const draft = (section: unknown) => ({ steps: { '5': section } });

describe('payment ticks', () => {
  it('ticks in cash, card, transfer order whatever the order they were ticked', () => {
    let list = togglePayment([], 'transfer');
    list = togglePayment(list, 'cash');
    list = togglePayment(list, 'card');
    expect(list).toEqual(['cash', 'card', 'transfer']);
  });

  it('unticks the one toggled and nothing else, and twice returns to the start', () => {
    const start = ['cash', 'card'] as const;
    const once = togglePayment([...start], 'card');
    expect(once).toEqual(['cash']);
    expect(togglePayment(once, 'card')).toEqual(['cash', 'card']);
  });

  it('does not change the list it was given', () => {
    const list: ('cash' | 'card' | 'transfer')[] = ['cash'];
    togglePayment(list, 'card');
    expect(list).toEqual(['cash']);
  });
});

describe('courtesy car terms', () => {
  it('starts paid with no price and keeps a price already given', () => {
    expect(setCourtesy(undefined, true)).toEqual({ paid: true });
    expect(setCourtesy({ paid: true, pricePerDayBani: 12_000 }, true)).toEqual({
      paid: true,
      pricePerDayBani: 12_000,
    });
  });

  it('drops the price when free is chosen and does not bring it back on paid', () => {
    const free = setCourtesy({ paid: true, pricePerDayBani: 12_000 }, false);
    expect(free).toEqual({ paid: false });
    expect(setCourtesy(free, true)).toEqual({ paid: true });
  });
});

describe('merging step 5 into the shared section', () => {
  it('keeps the terms only while the courtesy car facility is ticked', () => {
    const withCar = mergeHours(undefined, {
      courtesyCar: { paid: true, pricePerDayBani: 12_000 },
      facilities: ['courtesy_car'],
      payments: ['cash'],
    });
    expect(withCar['courtesyCar']).toEqual({
      paid: true,
      pricePerDayBani: 12_000,
    });
    const without = mergeHours(withCar, {
      courtesyCar: { paid: true, pricePerDayBani: 12_000 },
      facilities: toggleFacility(['courtesy_car'], 'courtesy_car'),
      payments: ['cash'],
    });
    expect('courtesyCar' in without).toBe(false);
  });

  it('leaves out an emptied payments list and keeps other stories keys', () => {
    const merged = mergeHours(
      { payments: ['cash'], place: { street: 'x' } },
      { payments: [] },
    );
    expect(merged).toEqual({ place: { street: 'x' } });
  });

  it('drops the courtesy terms when the value lists no facilities', () => {
    const merged = mergeHours(undefined, {
      courtesyCar: { paid: true, pricePerDayBani: 12_000 },
    });
    expect('courtesyCar' in merged).toBe(false);
  });

  it('merged output round-trips through the reader and stays complete', () => {
    const merged = mergeHours(undefined, {
      courtesyCar: { paid: true, pricePerDayBani: 200_000 },
      facilities: ['courtesy_car'],
      payments: ['card', 'transfer'],
    });
    const read = hoursOf(draft(merged));
    expect(read.payments).toEqual(['card', 'transfer']);
    expect(read.courtesyCar).toEqual({ paid: true, pricePerDayBani: 200_000 });
    expect(hoursComplete(read)).toBe(true);
  });
});

describe('reading step 5 from a kept draft', () => {
  it('opens a draft from before payments with nothing ticked and no courtesy terms', () => {
    const read = hoursOf(draft({ facilities: ['courtesy_car'] }));
    expect(read.payments).toBeUndefined();
    expect(read.courtesyCar).toBeUndefined();
    expect(hoursComplete(read)).toBe(false);
  });

  it.each([
    ['a duplicate payment', { payments: ['cash', 'cash'] }],
    ['an unknown payment', { payments: ['crypto'] }],
    ['payments as a string', { payments: 'cash' }],
    [
      'a price off the lei grid',
      { courtesyCar: { paid: true, pricePerDayBani: 150 } },
    ],
    [
      'a price over the cap',
      { courtesyCar: { paid: true, pricePerDayBani: 200_100 } },
    ],
    [
      'a price as a string',
      { courtesyCar: { paid: true, pricePerDayBani: '12000' } },
    ],
    [
      'a courtesy car with another key',
      { courtesyCar: { extra: 1, paid: true } },
    ],
  ])('drops %s and keeps the other keys', (_label, bad) => {
    const read = hoursOf(
      draft({
        ...bad,
        facilities: ['courtesy_car'],
        payments: undefined,
        ...bad,
      }),
    );
    expect(read.payments).toBeUndefined();
    expect(read.courtesyCar).toBeUndefined();
    expect(read.facilities).toEqual(['courtesy_car']);
  });
});

describe('the price field text', () => {
  it.each([
    ['1.200 lei', '1200'],
    ['120', '120'],
    ['00120', '120'],
    ['0', '0'],
    ['', ''],
    ['abc', ''],
    ['-5', '5'],
    ['12,50', '1250'],
    ['１２０', ''],
    ['٣٤٥', ''],
    ['12345678901234', '123456789'],
  ])('turns %j into %j', (typed, digits) => {
    expect(leiDigits(typed)).toBe(digits);
  });
});
