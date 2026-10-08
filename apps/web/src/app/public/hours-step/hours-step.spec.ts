import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { PublicHolidaysService } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';

import { HoursStep } from './hours-step';

const CALENDAR: Record<
  number,
  { day: string; nameEn: string; nameRo: string }[]
> = {
  2026: [
    {
      day: '2026-08-15',
      nameEn: 'Dormition of the Mother of God',
      nameRo: 'Adormirea Maicii Domnului',
    },
    { day: '2026-11-30', nameEn: 'Saint Andrew', nameRo: 'Sfântul Andrei' },
    { day: '2026-12-01', nameEn: 'National Day', nameRo: 'Ziua Națională' },
    { day: '2026-12-25', nameEn: 'Christmas', nameRo: 'Crăciunul' },
    { day: '2026-12-26', nameEn: 'Christmas', nameRo: 'Crăciunul' },
  ],
  2027: [
    { day: '2027-01-01', nameEn: 'New Year', nameRo: 'Anul Nou' },
    { day: '2027-01-02', nameEn: 'New Year', nameRo: 'Anul Nou' },
  ],
};

let list: jest.Mock;

async function open(language: 'ro' | 'en' = 'ro') {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      {
        provide: PublicHolidaysService,
        useValue: { publicHolidaysControllerList: list },
      },
    ],
  });
  const i18n = TestBed.inject(I18n);
  await i18n.enter('public');
  if (language === 'en') await i18n.use('en');
  const fixture = TestBed.createComponent(HoursStep);
  await settle(fixture);
  const step = fixture.nativeElement as HTMLElement;
  return { fixture, i18n, step };
}

type Fixture = Awaited<ReturnType<typeof open>>['fixture'];

async function settle(fixture: Fixture) {
  for (let i = 0; i < 3; i++) {
    fixture.detectChanges();
    await fixture.whenStable();
  }
}

const text = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
const select = (step: HTMLElement, name: string) =>
  step.querySelector<HTMLSelectElement>(`select[name="${name}"]`);
const tick = (step: HTMLElement, name: string) =>
  step.querySelector<HTMLInputElement>(
    `input[type="checkbox"][name="${name}"]`,
  );
const row = (step: HTMLElement, name: string) =>
  step.querySelector<HTMLElement>(`[data-row="${name}"]`);
const button = (scope: HTMLElement, label: string) => {
  const found = [...scope.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => text(b) === label || b.getAttribute('aria-label') === label,
  );
  if (!found) throw new Error(`no button ${label}`);
  return found;
};

async function choose(
  fixture: Fixture,
  field: HTMLSelectElement | null,
  value: string,
) {
  if (!field) throw new Error('no field');
  field.value = value;
  field.dispatchEvent(new Event('change'));
  await settle(fixture);
}

async function type(
  fixture: Fixture,
  field: HTMLInputElement | null,
  value: string,
) {
  if (!field) throw new Error('no field');
  field.value = value;
  field.dispatchEvent(new Event('input'));
  field.dispatchEvent(new Event('change'));
  await settle(fixture);
}

async function click(fixture: Fixture, element: HTMLElement | null) {
  if (!element) throw new Error('no element');
  element.click();
  await settle(fixture);
}

async function openByDay(fixture: Fixture, step: HTMLElement) {
  const details = step.querySelector('details');
  if (!details) throw new Error('no disclosure');
  details.open = true;
  details.dispatchEvent(new Event('toggle'));
  await settle(fixture);
}

const closedDays = (step: HTMLElement) =>
  [...step.querySelectorAll('.closed-days li')].map(text);
const chips = (step: HTMLElement) => [
  ...step.querySelectorAll<HTMLButtonElement>('.facilities button'),
];
const chip = (step: HTMLElement, name: string) => {
  const found = chips(step).find((c) => text(c).startsWith(name));
  if (!found) throw new Error(`no chip ${name}`);
  return found;
};

beforeEach(() => {
  jest.useFakeTimers({
    doNotFake: [
      'nextTick',
      'setImmediate',
      'clearImmediate',
      'setTimeout',
      'clearTimeout',
      'setInterval',
      'clearInterval',
      'queueMicrotask',
      'requestAnimationFrame',
      'cancelAnimationFrame',
      'requestIdleCallback',
      'cancelIdleCallback',
      'hrtime',
      'performance',
    ],
    now: new Date('2026-10-07T09:00:00Z'),
  });
  list = jest.fn(async ({ year }: { year: number }) => CALENDAR[year] ?? []);
});

afterEach(() => jest.useRealTimers());

describe('step 5, the opening hours', () => {
  it('starts on Monday to Friday 08:00-17:00 and a closed Saturday, keeping nothing yet', async () => {
    const { fixture, step } = await open();

    expect(text(step.querySelector('h3'))).toBe('Program');
    expect(text(row(step, 'weekdays'))).toContain('Luni – vineri');
    expect(select(step, 'weekdays-open')?.value).toBe('08:00');
    expect(select(step, 'weekdays-close')?.value).toBe('17:00');
    expect(text(row(step, 'sat'))).toContain('Sâmbătă');
    expect(tick(step, 'sat-closed')?.checked).toBe(true);
    expect(text(row(step, 'sat'))).toContain('Închis');
    expect(select(step, 'sat-open')).toBeNull();
    expect(tick(step, 'weekdays-closed')).toBeNull();
    expect(text(step.querySelector('details summary'))).toBe('Program pe zile');
    expect(fixture.componentInstance.value()).toEqual({});
  });

  it('offers the quarter hours of the day', async () => {
    const { step } = await open();

    const options = [...(select(step, 'weekdays-open')?.options ?? [])].map(
      (o) => o.value,
    );
    expect(options).toHaveLength(96);
    expect(options.slice(0, 3)).toEqual(['00:00', '00:15', '00:30']);
  });

  it('keeps the whole week once a time changes', async () => {
    const { fixture, step } = await open();

    await choose(fixture, select(step, 'weekdays-close'), '18:00');

    expect(fixture.componentInstance.value().hours).toEqual({
      fri: [['08:00', '18:00']],
      mon: [['08:00', '18:00']],
      sat: [],
      sun: [],
      thu: [['08:00', '18:00']],
      tue: [['08:00', '18:00']],
      wed: [['08:00', '18:00']],
    });
  });

  it('opens Saturday when its tick is cleared and empties it when ticked again', async () => {
    const { fixture, step } = await open();

    await click(fixture, tick(step, 'sat-closed'));
    await choose(fixture, select(step, 'sat-open'), '09:00');
    await choose(fixture, select(step, 'sat-close'), '13:00');
    expect(fixture.componentInstance.value().hours?.sat).toEqual([
      ['09:00', '13:00'],
    ]);

    await click(fixture, tick(step, 'sat-closed'));
    expect(fixture.componentInstance.value().hours?.sat).toEqual([]);
    expect(select(step, 'sat-open')).toBeNull();
  });

  it('keeps the last valid value and tells why when closing comes before opening', async () => {
    const { fixture, step } = await open();
    await choose(fixture, select(step, 'weekdays-close'), '18:00');
    const before = fixture.componentInstance.value();

    await choose(fixture, select(step, 'weekdays-close'), '07:00');

    expect(fixture.componentInstance.value()).toEqual(before);
    const error = row(step, 'weekdays')?.querySelector('.error');
    expect(text(error)).toBe('Ora de închidere trebuie să fie după deschidere');
    expect(error?.id).toBeTruthy();
    expect(
      select(step, 'weekdays-close')?.getAttribute('aria-describedby'),
    ).toContain(error?.id);
  });

  it('shows seven days by day, Monday to Sunday, with Sunday closed', async () => {
    const { fixture, step } = await open();

    await openByDay(fixture, step);

    const days = [...step.querySelectorAll<HTMLElement>('details [data-day]')];
    expect(days.map((d) => d.dataset['day'])).toEqual([
      'mon',
      'tue',
      'wed',
      'thu',
      'fri',
      'sat',
      'sun',
    ]);
    expect(text(days[0])).toContain('Luni');
    expect(text(days[6])).toContain('Duminică');
    expect(tick(step, 'sun-closed')?.checked).toBe(true);
    expect(select(step, 'mon-0-open')?.value).toBe('08:00');
    expect(text(days[0])).toContain('Adaugă pauză');
  });

  it('opens Sunday from its own row', async () => {
    const { fixture, step } = await open();
    await openByDay(fixture, step);

    await click(fixture, tick(step, 'sun-closed'));
    await choose(fixture, select(step, 'sun-0-open'), '10:00');
    await choose(fixture, select(step, 'sun-0-close'), '14:00');

    expect(fixture.componentInstance.value().hours?.sun).toEqual([
      ['10:00', '14:00'],
    ]);
  });

  it('splits a day with a break and then says the weekdays differ', async () => {
    const { fixture, step } = await open();
    await openByDay(fixture, step);
    const monday = step.querySelector<HTMLElement>('[data-day="mon"]');
    if (!monday) throw new Error('no Monday');

    await click(fixture, button(monday, 'Adaugă pauză'));

    expect(fixture.componentInstance.value().hours?.mon).toEqual([
      ['08:00', '12:00'],
      ['13:00', '17:00'],
    ]);
    expect(select(step, 'mon-1-open')?.value).toBe('13:00');
    expect(text(row(step, 'weekdays'))).toContain('Program diferit pe zile');
    expect(select(step, 'weekdays-open')).toBeNull();
    expect(step.querySelector('details')?.open).toBe(true);
  });

  it('refuses a break that leaves the day and keeps the day as it was', async () => {
    const { fixture, step } = await open();
    await openByDay(fixture, step);
    await click(
      fixture,
      button(
        step.querySelector('[data-day="mon"]') as HTMLElement,
        'Adaugă pauză',
      ),
    );
    const before = fixture.componentInstance.value();

    await choose(fixture, select(step, 'mon-1-open'), '11:00');

    expect(fixture.componentInstance.value()).toEqual(before);
    expect(text(step.querySelector('[data-day="mon"] .error'))).toBe(
      'Pauza trebuie să fie în programul zilei',
    );
  });

  it('shows a restored week in the rows', async () => {
    const { fixture, step } = await open();

    fixture.componentInstance.value.set({
      hours: {
        fri: [['08:30', '18:00']],
        mon: [['08:30', '18:00']],
        sat: [['09:00', '13:00']],
        sun: [],
        thu: [['08:30', '18:00']],
        tue: [['08:30', '18:00']],
        wed: [['08:30', '18:00']],
      },
    });
    await settle(fixture);

    expect(select(step, 'weekdays-open')?.value).toBe('08:30');
    expect(select(step, 'weekdays-close')?.value).toBe('18:00');
    expect(tick(step, 'sat-closed')?.checked).toBe(false);
    expect(select(step, 'sat-open')?.value).toBe('09:00');
  });

  it('opens the days of a restored week whose weekdays differ', async () => {
    const { fixture, step } = await open();

    fixture.componentInstance.value.set({
      hours: {
        fri: [['08:00', '15:00']],
        mon: [['08:00', '17:00']],
        sat: [],
        sun: [],
        thu: [['08:00', '17:00']],
        tue: [['08:00', '17:00']],
        wed: [['08:00', '17:00']],
      },
    });
    await settle(fixture);

    expect(text(row(step, 'weekdays'))).toContain('Program diferit pe zile');
    expect(step.querySelector('details')?.open).toBe(true);
    expect(select(step, 'fri-0-close')?.value).toBe('15:00');
  });

  it('changes every text and keeps every time when the language changes', async () => {
    const { fixture, i18n, step } = await open();
    await choose(fixture, select(step, 'weekdays-close'), '18:00');
    const before = fixture.componentInstance.value();

    await i18n.use('en');
    await settle(fixture);

    expect(text(step.querySelector('h3'))).toBe('Opening hours');
    expect(text(row(step, 'weekdays'))).toContain('Monday to Friday');
    expect(text(row(step, 'sat'))).toContain('Saturday');
    expect(text(step.querySelector('details summary'))).toBe('Hours by day');
    expect(select(step, 'weekdays-close')?.value).toBe('18:00');
    expect(fixture.componentInstance.value()).toEqual(before);

    await choose(fixture, select(step, 'weekdays-close'), '07:00');
    expect(text(row(step, 'weekdays')?.querySelector('.error'))).toBe(
      'Closing must be after opening',
    );
  });
});

describe('step 5, the closed days', () => {
  const add = async (
    fixture: Fixture,
    step: HTMLElement,
    day: string,
    note = '',
  ) => {
    await type(
      fixture,
      step.querySelector('input[type="date"][name="closedDay"]'),
      day,
    );
    await type(fixture, step.querySelector('input[name="closedNote"]'), note);
    await click(
      fixture,
      step.querySelector<HTMLButtonElement>('button.add-closed'),
    );
  };

  it('adds a day with its note to the list and the section', async () => {
    const { fixture, step } = await open();

    await add(fixture, step, '2026-12-27', 'Inventar');

    expect(fixture.componentInstance.value().closedDays).toEqual([
      { day: '2026-12-27', note: 'Inventar' },
    ]);
    expect(closedDays(step)).toHaveLength(1);
    expect(closedDays(step)[0]).toContain('Inventar');
    expect(closedDays(step)[0]).toContain('decembrie');
  });

  it.each([
    ['a legal holiday', '2026-12-01', 'E deja zi liberă legală'],
    ['a day already past', '2026-10-06', 'Data a trecut'],
    ['a day more than two years ahead', '2028-10-08', 'Cel mult 2 ani înainte'],
  ])('refuses %s with its reason and adds nothing', async (_, day, reason) => {
    const { fixture, step } = await open();

    await add(fixture, step, day);

    const error = step.querySelector('.closed-error');
    expect(text(error)).toBe(reason);
    expect(error?.id).toBeTruthy();
    for (const name of ['closedDay', 'closedNote'])
      expect(
        step
          .querySelector(`input[name="${name}"]`)
          ?.getAttribute('aria-describedby'),
      ).toBe(error?.id);
    expect(fixture.componentInstance.value().closedDays).toBeUndefined();
    expect(closedDays(step)).toEqual([]);
  });

  it('adds the same day once', async () => {
    const { fixture, step } = await open();

    await add(fixture, step, '2026-12-27');
    await add(fixture, step, '2026-12-27');

    expect(fixture.componentInstance.value().closedDays).toEqual([
      { day: '2026-12-27' },
    ]);
  });

  it('shows the 80-character limit of the note and takes no more than 80 letters', async () => {
    const { fixture, step } = await open();

    expect(
      text(step.querySelector('label:has(input[name="closedNote"])')),
    ).toContain('80');
    await add(fixture, step, '2026-12-27', '🚗'.repeat(81));

    const [kept] = fixture.componentInstance.value().closedDays ?? [];
    expect([...(kept?.note ?? '')]).toHaveLength(80);
  });

  it('removes a day from the list and the section', async () => {
    const { fixture, step } = await open();
    await add(fixture, step, '2026-12-27', 'Inventar');

    await click(
      fixture,
      step.querySelector<HTMLButtonElement>('.closed-days li button'),
    );

    expect(closedDays(step)).toEqual([]);
    expect(fixture.componentInstance.value().closedDays).toBeUndefined();
  });

  it('says the legal holidays count by themselves and lists the next ones from the calendar', async () => {
    const { step } = await open();

    expect(list).toHaveBeenCalledWith({ year: 2026 });
    expect(list).toHaveBeenCalledWith({ year: 2027 });
    expect(text(step.querySelector('.holidays'))).toContain(
      'Sărbătorile legale',
    );
    const next = [...step.querySelectorAll('.holidays li')].map(text);
    expect(next[0]).toContain('Sfântul Andrei');
    expect(next.some((line) => line.includes('Adormirea'))).toBe(false);
    expect(next.some((line) => line.includes('Anul Nou'))).toBe(true);
  });

  it('names the holidays in English', async () => {
    const { step } = await open('en');

    const next = [...step.querySelectorAll('.holidays li')].map(text);
    expect(next[0]).toContain('Saint Andrew');
  });

  it('says the list is not available and takes a legal holiday when the calendar fails', async () => {
    list.mockRejectedValue(new Error('offline'));
    const { fixture, step } = await open();

    expect(text(step.querySelector('.holidays'))).toContain(
      'nu e disponibilă acum',
    );
    await add(fixture, step, '2026-12-01');

    expect(fixture.componentInstance.value().closedDays).toEqual([
      { day: '2026-12-01' },
    ]);
  });
});

describe('step 5, the facilities', () => {
  it('shows three chips, none ticked, with the hint under them', async () => {
    const { step } = await open();

    expect(chips(step).map(text)).toEqual([
      'Mașină la schimb',
      'Preluare și predare',
      'Sală de așteptare',
    ]);
    for (const c of chips(step)) {
      expect(c.type).toBe('button');
      expect(c.getAttribute('aria-pressed')).toBe('false');
    }
    expect(text(step.querySelector('.facilities-hint'))).toBe(
      'Șoferii pot filtra după ele. Bifează doar ce oferi mereu, nu „uneori”.',
    );
    const hint = step.querySelector('.facilities-hint');
    const chipList = step.querySelector('.facilities');
    expect(
      chipList!.compareDocumentPosition(hint!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('ticks two facilities, telling the state by more than colour, and unticks on a second tap', async () => {
    const { fixture, step } = await open();

    await click(fixture, chip(step, 'Sală de așteptare'));
    await click(fixture, chip(step, 'Mașină la schimb'));

    expect(fixture.componentInstance.value().facilities).toEqual([
      'courtesy_car',
      'waiting_area',
    ]);
    const waiting = chip(step, 'Sală de așteptare');
    expect(waiting.getAttribute('aria-pressed')).toBe('true');
    expect(waiting.querySelector('mf-lamp')?.getAttribute('data-state')).toBe(
      'green',
    );
    expect(text(waiting)).not.toBe('Sală de așteptare');

    await click(fixture, chip(step, 'Mașină la schimb'));
    expect(fixture.componentInstance.value().facilities).toEqual([
      'waiting_area',
    ]);
  });

  it('changes the chips and the hint and keeps the ticks when the language changes', async () => {
    const { fixture, i18n, step } = await open();
    await click(fixture, chip(step, 'Sală de așteptare'));

    await i18n.use('en');
    await settle(fixture);

    expect(chips(step).map((c) => text(c).split(' you')[0])).toEqual([
      'Courtesy car',
      'Pick-up and drop-off',
      'Waiting area',
    ]);
    expect(text(step.querySelector('.facilities-hint'))).toBe(
      'Drivers can filter by these. Tick only what you always offer, not "sometimes".',
    );
    expect(chip(step, 'Waiting area').getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(fixture.componentInstance.value().facilities).toEqual([
      'waiting_area',
    ]);
  });
});

const payChips = (step: HTMLElement) => [
  ...step.querySelectorAll<HTMLButtonElement>('.payments button'),
];
const payChip = (step: HTMLElement, name: string) => {
  const found = payChips(step).find((c) => text(c).startsWith(name));
  if (!found) throw new Error(`no payment chip ${name}`);
  return found;
};
const radio = (step: HTMLElement, label: string) =>
  [...step.querySelectorAll('label')]
    .find((l) => text(l) === label)
    ?.querySelector<HTMLInputElement>('input[type="radio"]') ?? null;
const price = (step: HTMLElement) =>
  step.querySelector<HTMLInputElement>('input[name="courtesyPrice"]');
const statuses = (step: HTMLElement) =>
  [...step.querySelectorAll('[role="status"]')].map(text);
const describedBy = (step: HTMLElement, field: HTMLElement | null) => {
  const id = field?.getAttribute('aria-describedby');
  return id ? step.querySelector(`[id="${id}"]`) : null;
};

async function choosePaid(fixture: Fixture, step: HTMLElement) {
  await click(fixture, chip(step, 'Mașină la schimb'));
  await click(fixture, radio(step, 'Contra cost'));
}

describe('step 5, the payment methods', () => {
  it('shows a payment heading after the facilities and three chips, none ticked', async () => {
    const { step } = await open();

    const heading = [...step.querySelectorAll('h3')].find(
      (h) => text(h) === 'Plată',
    );
    expect(heading).toBeDefined();
    expect(
      step.querySelector('.facilities')!.compareDocumentPosition(heading!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(payChips(step).map(text)).toEqual([
      'Numerar',
      'Card',
      'Transfer bancar',
    ]);
    for (const c of payChips(step)) {
      expect(c.type).toBe('button');
      expect(c.getAttribute('aria-pressed')).toBe('false');
    }
  });

  it('ticks two methods, telling the state by more than colour, and unticks on a second tap', async () => {
    const { fixture, step } = await open();

    await click(fixture, payChip(step, 'Transfer bancar'));
    await click(fixture, payChip(step, 'Numerar'));

    expect(fixture.componentInstance.value().payments).toEqual([
      'cash',
      'transfer',
    ]);
    const cash = payChip(step, 'Numerar');
    expect(cash.getAttribute('aria-pressed')).toBe('true');
    expect(cash.querySelector('mf-lamp')?.getAttribute('data-state')).toBe(
      'green',
    );
    expect(text(cash)).not.toBe('Numerar');

    await click(fixture, payChip(step, 'Numerar'));
    expect(fixture.componentInstance.value().payments).toEqual(['transfer']);
  });

  it('says a payment method is needed while none is ticked', async () => {
    const { fixture, step } = await open();

    expect(statuses(step)).toContain('Alege cel puțin o modalitate de plată');

    await click(fixture, payChip(step, 'Card'));
    expect(statuses(step)).not.toContain(
      'Alege cel puțin o modalitate de plată',
    );
  });

  it('changes the chips and keeps the ticks when the language changes', async () => {
    const { fixture, i18n, step } = await open();
    await click(fixture, payChip(step, 'Card'));

    await i18n.use('en');
    await settle(fixture);

    expect(payChips(step).map((c) => text(c).split(' you')[0])).toEqual([
      'Cash',
      'Card',
      'Bank transfer',
    ]);
    expect(payChip(step, 'Card').getAttribute('aria-pressed')).toBe('true');
    expect(fixture.componentInstance.value().payments).toEqual(['card']);
  });
});

describe('step 5, the courtesy car', () => {
  it('offers free or paid under the ticked chip, free by default, with no price field', async () => {
    const { fixture, step } = await open();
    expect(radio(step, 'Gratuită')).toBeNull();

    await click(fixture, chip(step, 'Mașină la schimb'));

    const free = radio(step, 'Gratuită');
    const paid = radio(step, 'Contra cost');
    expect(free?.checked).toBe(true);
    expect(paid?.checked).toBe(false);
    expect(free?.name).toBe(paid?.name);
    expect(price(step)).toBeNull();
    expect(fixture.componentInstance.value().courtesyCar).toEqual({
      paid: false,
    });
  });

  it('shows the price per day in lei once paid and keeps it as bani', async () => {
    const { fixture, step } = await open();
    await choosePaid(fixture, step);

    const field = price(step);
    expect(field).not.toBeNull();
    expect(text(field!.closest('label'))).toContain('Preț pe zi');
    expect(text(field!.closest('label'))).toContain('lei');
    await type(fixture, field, '120');

    expect(fixture.componentInstance.value().courtesyCar).toEqual({
      paid: true,
      pricePerDayBani: 12_000,
    });
  });

  it('drops the price when switched back to free', async () => {
    const { fixture, step } = await open();
    await choosePaid(fixture, step);
    await type(fixture, price(step), '120');

    await click(fixture, radio(step, 'Gratuită'));

    expect(price(step)).toBeNull();
    expect(fixture.componentInstance.value().courtesyCar).toEqual({
      paid: false,
    });
  });

  it('removes the choice and the price from the step and the value when the chip is unticked', async () => {
    const { fixture, step } = await open();
    await choosePaid(fixture, step);
    await type(fixture, price(step), '120');

    await click(fixture, chip(step, 'Mașină la schimb'));

    expect(radio(step, 'Contra cost')).toBeNull();
    expect(price(step)).toBeNull();
    expect(fixture.componentInstance.value()).not.toHaveProperty('courtesyCar');
  });

  it('shows a field error tied to the price while paid has no price', async () => {
    const { fixture, step } = await open();
    await choosePaid(fixture, step);

    const error = describedBy(step, price(step));
    expect(error?.getAttribute('role')).toBe('status');
    expect(text(error)).not.toBe('');
  });

  it('shows a field error for a price over 2,000 lei and clears it for a price in range', async () => {
    const { fixture, step } = await open();
    await choosePaid(fixture, step);

    await type(fixture, price(step), '2001');
    expect(describedBy(step, price(step))?.getAttribute('role')).toBe('status');

    await type(fixture, price(step), '2000');
    expect(describedBy(step, price(step))).toBeNull();
  });

  it('keeps the choice and the typed price when the language changes', async () => {
    const { fixture, i18n, step } = await open();
    await choosePaid(fixture, step);
    await type(fixture, price(step), '120');

    await i18n.use('en');
    await settle(fixture);

    expect(radio(step, 'Paid')?.checked).toBe(true);
    expect(text(price(step)!.closest('label'))).toContain('Price per day');
    expect(price(step)?.value).toBe('120');
  });
});
