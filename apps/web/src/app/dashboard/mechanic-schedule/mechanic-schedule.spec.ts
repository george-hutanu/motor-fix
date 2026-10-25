import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import type { EventKind } from '@motor-fix/contracts';
import type { WeeklyHours } from '@motor-fix/contracts/garage-hours';
import {
  type GarageMechanicDto,
  GaragesService,
  type MechanicScheduleDto,
} from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { toast } from '@motor-fix/ui-cockpit';
import { filter, Subject } from 'rxjs';

import { MechanicSchedule } from './mechanic-schedule';
import { Live } from '../live';

jest.mock('@motor-fix/ui-cockpit', () => ({
  ...jest.requireActual('@motor-fix/ui-cockpit'),
  toast: jest.fn(),
}));

type Message = { id: string; kind: string };

const GARAGE: WeeklyHours = {
  fri: [['08:00', '19:00']],
  mon: [
    ['08:00', '12:00'],
    ['13:00', '19:00'],
  ],
  sat: [['09:00', '14:00']],
  sun: [],
  thu: [['08:00', '19:00']],
  tue: [['08:00', '19:00']],
  wed: [['08:00', '19:00']],
};
const week = (day: [string, string][], extra: Partial<WeeklyHours> = {}) =>
  ({
    fri: day,
    mon: day,
    sat: [],
    sun: [],
    thu: day,
    tue: day,
    wed: day,
    ...extra,
  }) as WeeklyHours;

const schedule = (
  over: Partial<MechanicScheduleDto> = {},
): MechanicScheduleDto => ({
  daysOff: [],
  garageHours: GARAGE,
  isDefault: false,
  workingHours: week([['08:00', '16:30']]),
  worksSaturdays: false,
  ...over,
});

const card = { id: 'mechanic-1', name: 'Elena Stan' } as GarageMechanicDto;

const refusal = (status: number, error: unknown) =>
  new HttpErrorResponse({ error, status });

let events: Subject<Message>;
let api: {
  mechanicScheduleControllerAddDayOff: jest.Mock;
  mechanicScheduleControllerRead: jest.Mock;
  mechanicScheduleControllerRemoveDayOff: jest.Mock;
  mechanicScheduleControllerWrite: jest.Mock;
};

async function render(
  first: MechanicScheduleDto = schedule(),
  language: 'ro' | 'en' = 'ro',
) {
  events = new Subject();
  api = {
    mechanicScheduleControllerAddDayOff: jest.fn(),
    mechanicScheduleControllerRead: jest.fn(async () => first),
    mechanicScheduleControllerRemoveDayOff: jest.fn(async () => undefined),
    mechanicScheduleControllerWrite: jest.fn(),
  };
  TestBed.configureTestingModule({
    providers: [
      { provide: GaragesService, useValue: api },
      {
        provide: Live,
        useValue: {
          on: (kinds: readonly EventKind[]) =>
            events.pipe(
              filter((m) => (kinds as readonly string[]).includes(m.kind)),
            ),
          resync: new Subject<void>(),
        },
      },
    ],
  });
  await TestBed.inject(I18n).enter('garage');
  if (language === 'en') await TestBed.inject(I18n).use('en');
  const fixture = TestBed.createComponent(MechanicSchedule);
  fixture.componentRef.setInput('garageId', 'garage-1');
  fixture.componentRef.setInput('card', card);
  const element = fixture.nativeElement as HTMLElement;
  const settle = async () => {
    for (let i = 0; i < 4; i++) {
      fixture.detectChanges();
      await fixture.whenStable();
      await new Promise((resolve) => setTimeout(resolve));
    }
  };
  await settle();
  return { element, settle };
}

const text = (el: Element | null | undefined) =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const row = (element: HTMLElement, day: string) =>
  element.querySelector<HTMLElement>(`[data-day="${day}"]`) as HTMLElement;
const selects = (el: HTMLElement) => [
  ...el.querySelectorAll<HTMLSelectElement>('select'),
];
const options = (select: HTMLSelectElement) =>
  [...select.options].map((o) => o.value);
const problemOf = (control: Element) =>
  text(
    document.getElementById(
      (control.getAttribute('aria-describedby') ?? '')
        .split(' ')
        .find((id) => id.endsWith('-error')) ?? '',
    ),
  );
const button = (element: HTMLElement, label: string) => {
  const found = [...element.querySelectorAll('button')].find(
    (b) => text(b) === label,
  );
  if (!found) throw new Error(`no ${label}`);
  return found;
};
function pick(select: HTMLSelectElement, value: string) {
  select.value = value;
  select.dispatchEvent(new Event('change'));
}
function type(input: HTMLInputElement, value: string) {
  input.value = value;
  input.dispatchEvent(new Event('input'));
}
const saveHours = (element: HTMLElement) =>
  button(element, 'Salvează programul').click();
const sentWeek = () =>
  api.mechanicScheduleControllerWrite.mock.calls.at(-1)?.[0].body;
const addField = (element: HTMLElement, id: string) =>
  element.querySelector<HTMLInputElement>(
    `#mf-day-off-${id}`,
  ) as HTMLInputElement;

const dayAhead = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

afterEach(() => jest.clearAllMocks());

// @traces 058-FR-014
describe("the Program tab's week", () => {
  it('shows seven rows, Monday to Sunday, from the read', async () => {
    const { element } = await render();

    expect(
      [...element.querySelectorAll('[data-day]')].map((r) =>
        text(r.querySelector('.name')),
      ),
    ).toEqual([
      'Luni',
      'Marți',
      'Miercuri',
      'Joi',
      'Vineri',
      'Sâmbătă',
      'Duminică',
    ]);
    expect(selects(row(element, 'tue')).map((s) => s.value)).toEqual([
      '08:00',
      '16:30',
    ]);
    expect(api.mechanicScheduleControllerRead).toHaveBeenCalledWith({
      garageId: 'garage-1',
      mechanicId: 'mechanic-1',
    });
  });

  it('reads "Închis" with no pickers on a day the garage is closed', async () => {
    const { element } = await render();

    expect(text(row(element, 'sun'))).toContain('Închis');
    expect(selects(row(element, 'sun'))).toHaveLength(0);
    expect(row(element, 'sun').querySelector('input')).toBeNull();
  });

  it("offers the 15-minute grid inside the garage's span of that day", async () => {
    const { element } = await render();
    const [from] = selects(row(element, 'mon'));

    expect(options(from).at(0)).toBe('08:00');
    expect(options(from).at(-1)).toBe('19:00');
    expect(options(from)).toContain('12:15');
    expect(options(from)).toHaveLength(45);
  });

  it('sends a day left unticked as none, and every day as one stretch', async () => {
    const { element, settle } = await render();
    api.mechanicScheduleControllerWrite.mockResolvedValue(schedule());
    const tick = row(element, 'wed').querySelector(
      'input[type="checkbox"]',
    ) as HTMLInputElement;

    tick.click();
    await settle();
    expect(selects(row(element, 'wed'))).toHaveLength(0);
    saveHours(element);
    await settle();

    expect(sentWeek()).toEqual({
      workingHours: week([['08:00', '16:30']], { wed: [] }),
      worksSaturdays: false,
    });
  });

  it('starts a day ticked on at the garage span', async () => {
    const { element, settle } = await render(
      schedule({ workingHours: week([['08:00', '16:30']], { fri: [] }) }),
    );
    const tick = row(element, 'fri').querySelector(
      'input[type="checkbox"]',
    ) as HTMLInputElement;

    tick.click();
    await settle();

    expect(selects(row(element, 'fri')).map((s) => s.value)).toEqual([
      '08:00',
      '19:00',
    ]);
  });

  it("shows the default line while the card follows the garage's hours", async () => {
    const { element } = await render(schedule({ isDefault: true }));

    expect(text(element)).toContain(
      'Programul service‑ului până la prima modificare',
    );
  });

  it('leaves the default line out once the hours were saved', async () => {
    const { element } = await render();

    expect(text(element)).not.toContain('prima modificare');
  });
});

// @traces 058-FR-014
describe('the Saturday switch', () => {
  const turnOn = async (element: HTMLElement, settle: () => Promise<void>) => {
    (
      element.querySelector('#mf-schedule-saturdays-input') as HTMLElement
    ).click();
    await settle();
  };

  it("fills 09:00 to 14:00 inside the garage's Saturday", async () => {
    const { element, settle } = await render(
      schedule({ garageHours: { ...GARAGE, sat: [['10:00', '16:00']] } }),
    );

    await turnOn(element, settle);

    expect(selects(row(element, 'sat')).map((s) => s.value)).toEqual([
      '10:00',
      '14:00',
    ]);
  });

  it("fills the garage's whole Saturday when the two do not meet", async () => {
    const { element, settle } = await render(
      schedule({ garageHours: { ...GARAGE, sat: [['15:00', '18:00']] } }),
    );

    await turnOn(element, settle);

    expect(selects(row(element, 'sat')).map((s) => s.value)).toEqual([
      '15:00',
      '18:00',
    ]);
  });

  it('sends the Saturday stretch with the switch', async () => {
    const { element, settle } = await render();
    api.mechanicScheduleControllerWrite.mockResolvedValue(schedule());

    await turnOn(element, settle);
    saveHours(element);
    await settle();

    expect(sentWeek()).toEqual({
      workingHours: week([['08:00', '16:30']], { sat: [['09:00', '14:00']] }),
      worksSaturdays: true,
    });
  });

  it('is not offered while the garage is closed on Saturdays', async () => {
    const { element } = await render(
      schedule({ garageHours: { ...GARAGE, sat: [] } }),
    );

    expect(element.querySelector('#mf-schedule-saturdays-input')).toBeNull();
    expect(text(row(element, 'sat'))).toContain('Închis');
  });
});

// @traces 058-FR-015
describe("the week's refusals", () => {
  it('refuses a closing before the opening under the day, without a call', async () => {
    const { element, settle } = await render();
    const [from, to] = selects(row(element, 'thu'));

    pick(from, '15:00');
    pick(to, '09:00');
    saveHours(element);
    await settle();

    expect(problemOf(from)).toBe(
      'Ora de închidere trebuie să fie după deschidere',
    );
    expect(api.mechanicScheduleControllerWrite).not.toHaveBeenCalled();
  });

  it("shows the API's code under its day and keeps the tab", async () => {
    const { element, settle } = await render();
    api.mechanicScheduleControllerWrite.mockRejectedValue(
      refusal(422, {
        code: 'validation_failed',
        errors: [{ code: 'outside_opening', field: 'workingHours.tue' }],
      }),
    );

    saveHours(element);
    await settle();

    expect(problemOf(selects(row(element, 'tue'))[0])).toBe(
      'În afara programului service‑ului',
    );
    expect(toast).not.toHaveBeenCalled();
  });

  it('words the closed Saturday under the switch', async () => {
    const { element, settle } = await render();
    api.mechanicScheduleControllerWrite.mockRejectedValue(
      refusal(422, {
        code: 'validation_failed',
        errors: [{ code: 'garage_closed_saturday', field: 'worksSaturdays' }],
      }),
    );

    saveHours(element);
    await settle();

    expect(text(element.querySelector('#mf-schedule-saturdays-error'))).toBe(
      'Service‑ul nu e deschis sâmbăta',
    );
  });

  it('shows a toast on any other failure', async () => {
    const { element, settle } = await render();
    api.mechanicScheduleControllerWrite.mockRejectedValue(refusal(500, {}));

    saveHours(element);
    await settle();

    expect(toast).toHaveBeenCalledWith(
      'Nu am putut salva programul. Încearcă din nou.',
    );
  });

  it('spins the save button while the hours are on their way', async () => {
    const { element, settle } = await render();
    api.mechanicScheduleControllerWrite.mockReturnValue(new Promise(() => {}));

    saveHours(element);
    await settle();

    expect(element.querySelector('.submit .mf-task-spinner')).not.toBeNull();
  });
});

// @traces 058-FR-017
describe('the tab kept current', () => {
  it("shows a save's answer at once, with the saved line announced", async () => {
    const { element, settle } = await render(schedule({ isDefault: true }));
    api.mechanicScheduleControllerWrite.mockResolvedValue(
      schedule({ workingHours: week([['09:00', '17:00']]) }),
    );

    saveHours(element);
    await settle();

    expect(text(element.querySelector('.saved[role="status"]'))).toBe(
      'Programul a fost salvat.',
    );
    expect(text(element)).not.toContain('prima modificare');
    expect(api.mechanicScheduleControllerRead).toHaveBeenCalledTimes(1);
  });

  it("reads again on this card's mechanic.updated, and not on another's", async () => {
    const { element, settle } = await render();
    api.mechanicScheduleControllerRead.mockResolvedValue(
      schedule({ workingHours: week([['10:00', '18:00']]) }),
    );

    events.next({ id: 'mechanic-2', kind: 'mechanic.updated' });
    await new Promise((resolve) => setTimeout(resolve, 350));
    await settle();
    expect(api.mechanicScheduleControllerRead).toHaveBeenCalledTimes(1);

    events.next({ id: 'mechanic-1', kind: 'mechanic.updated' });
    await new Promise((resolve) => setTimeout(resolve, 350));
    await settle();

    expect(api.mechanicScheduleControllerRead).toHaveBeenCalledTimes(2);
    expect(selects(row(element, 'mon')).map((s) => s.value)).toEqual([
      '10:00',
      '18:00',
    ]);
  });
});

const DAYS_OFF = [
  {
    firstDay: '2027-05-12',
    id: 'off-1',
    lastDay: '2027-05-16',
    note: 'Concediu',
  },
  { firstDay: '2027-06-01', id: 'off-2', lastDay: '2027-06-01', note: null },
];

// @traces 058-FR-014 058-FR-018 058-FR-019
describe('the days off', () => {
  it("lists each in the viewer's language, a range with its note", async () => {
    const { element } = await render(schedule({ daysOff: DAYS_OFF }));

    expect(
      [...element.querySelectorAll('.days-off li .range')].map(text),
    ).toEqual(['12 – 16 mai 2027 · Concediu', '1 iun. 2027']);
  });

  it('lists them in English for an English viewer', async () => {
    const { element } = await render(schedule({ daysOff: DAYS_OFF }), 'en');

    expect(text(element.querySelector('.days-off li .range'))).toBe(
      '12 – 16 May 2027 · Concediu',
    );
  });

  it('shows a note as text, never as markup', async () => {
    const { element } = await render(
      schedule({
        daysOff: [{ ...DAYS_OFF[1], note: '<b>la nuntă</b>' }],
      }),
    );

    expect(element.querySelector('.days-off b')).toBeNull();
    expect(text(element.querySelector('.note'))).toBe('· <b>la nuntă</b>');
  });

  it('says so when there is none', async () => {
    const { element } = await render();

    expect(text(element.querySelector('.days-off'))).toContain(
      'Nicio zi liberă.',
    );
  });

  it('removes one with its own button', async () => {
    const { element, settle } = await render(schedule({ daysOff: DAYS_OFF }));
    api.mechanicScheduleControllerRead.mockResolvedValue(
      schedule({ daysOff: [DAYS_OFF[1]] }),
    );
    const remove = element.querySelector(
      '.days-off li .remove',
    ) as HTMLButtonElement;

    expect(remove.getAttribute('aria-label')).toBe(
      'Elimină ziua liberă 12 – 16 mai 2027',
    );
    remove.click();
    await settle();

    expect(api.mechanicScheduleControllerRemoveDayOff).toHaveBeenCalledWith({
      dayOffId: 'off-1',
      garageId: 'garage-1',
      mechanicId: 'mechanic-1',
    });
    expect(element.querySelectorAll('.days-off li')).toHaveLength(1);
  });
});

// @traces 058-FR-014 058-FR-015 058-FR-016
describe('adding a day off', () => {
  const add = (element: HTMLElement) =>
    button(element, 'Adaugă zi liberă').click();

  it('sends the first day, the last and the note', async () => {
    const { element, settle } = await render();
    api.mechanicScheduleControllerAddDayOff.mockResolvedValue(
      schedule({ daysOff: [DAYS_OFF[0]] }),
    );

    type(addField(element, 'first'), dayAhead(3));
    type(addField(element, 'last'), dayAhead(5));
    type(addField(element, 'note'), ' Concediu ');
    add(element);
    await settle();

    expect(api.mechanicScheduleControllerAddDayOff).toHaveBeenCalledWith({
      body: {
        acknowledgeBookings: false,
        firstDay: dayAhead(3),
        lastDay: dayAhead(5),
        note: 'Concediu',
      },
      garageId: 'garage-1',
      mechanicId: 'mechanic-1',
    });
    expect(element.querySelectorAll('.days-off li')).toHaveLength(1);
  });

  it('sends a single day as its own last day', async () => {
    const { element, settle } = await render();
    api.mechanicScheduleControllerAddDayOff.mockResolvedValue(schedule());

    type(addField(element, 'first'), dayAhead(3));
    add(element);
    await settle();

    expect(
      api.mechanicScheduleControllerAddDayOff.mock.calls[0][0].body,
    ).toMatchObject({
      firstDay: dayAhead(3),
      lastDay: dayAhead(3),
      note: null,
    });
  });

  it.each([
    [
      'first',
      () => dayAhead(-2),
      '',
      '',
      'Ziua trebuie să fie azi sau mai târziu',
    ],
    [
      'last',
      () => dayAhead(5),
      dayAhead(3),
      '',
      'Ultima zi trebuie să fie după prima',
    ],
    ['last', () => dayAhead(5), dayAhead(400), '', 'Cel mult un an înainte'],
    [
      'note',
      () => dayAhead(5),
      '',
      'a'.repeat(121),
      'Cel mult 120 de caractere',
    ],
  ])(
    'refuses a wrong %s under its field, without a call',
    async (field, first, last, note, message) => {
      const { element, settle } = await render();

      type(addField(element, 'first'), first());
      type(addField(element, 'last'), last);
      type(addField(element, 'note'), note);
      add(element);
      await settle();

      expect(problemOf(addField(element, field))).toBe(message);
      expect(api.mechanicScheduleControllerAddDayOff).not.toHaveBeenCalled();
    },
  );

  it('shows the note limit beside it', async () => {
    const { element } = await render();

    expect(text(element.querySelector('#mf-day-off-note-hint'))).toBe(
      '0 din 120 caractere',
    );
  });

  it('words an overlap under the first day', async () => {
    const { element, settle } = await render();
    api.mechanicScheduleControllerAddDayOff.mockRejectedValue(
      refusal(409, { code: 'day_off_overlap', message: 'Overlap' }),
    );

    type(addField(element, 'first'), dayAhead(3));
    add(element);
    await settle();

    expect(problemOf(addField(element, 'first'))).toBe(
      'Se suprapune cu o zi liberă existentă',
    );
  });

  describe('over confirmed bookings', () => {
    const bookings = [
      { id: 'b-1', startsAt: '2027-05-12T07:00:00.000Z' },
      { id: 'b-2', startsAt: '2027-05-12T10:30:00.000Z' },
      { id: 'b-3', startsAt: '2027-05-13T06:00:00.000Z' },
    ];
    const warned = async () => {
      const view = await render();
      api.mechanicScheduleControllerAddDayOff
        .mockRejectedValueOnce(
          refusal(409, {
            bookings,
            code: 'bookings_on_days_off',
            message: 'Bookings',
          }),
        )
        .mockResolvedValueOnce(schedule({ daysOff: [DAYS_OFF[0]] }));
      type(addField(view.element, 'first'), dayAhead(3));
      type(addField(view.element, 'last'), dayAhead(5));
      add(view.element);
      await view.settle();
      return view;
    };

    it('warns with the count and the times, a line per day, announced', async () => {
      const { element } = await warned();
      const warning = element.querySelector('.warning') as HTMLElement;

      expect(warning.getAttribute('role')).toBe('status');
      expect([...warning.querySelectorAll('p')].map(text)).toEqual([
        '2 programări confirmate pe 12 mai 2027: 10:00, 13:30. Vor trebui realocate.',
        '1 programare confirmată pe 13 mai 2027: 09:00. Va trebui realocată.',
      ]);
      expect(toast).not.toHaveBeenCalled();
    });

    it('sends again with the bookings acknowledged on "Adaugă oricum"', async () => {
      const { element, settle } = await warned();

      button(element, 'Adaugă oricum').click();
      await settle();

      expect(
        api.mechanicScheduleControllerAddDayOff.mock.calls[1][0].body,
      ).toMatchObject({ acknowledgeBookings: true, firstDay: dayAhead(3) });
      expect(element.querySelector('.warning .bookings')).toBeNull();
      expect(element.querySelectorAll('.days-off li')).toHaveLength(1);
    });

    it('drops the warning on "Renunță" and sends nothing', async () => {
      const { element, settle } = await warned();

      button(element, 'Renunță').click();
      await settle();

      expect(element.querySelector('.warning .bookings')).toBeNull();
      expect(api.mechanicScheduleControllerAddDayOff).toHaveBeenCalledTimes(1);
    });
  });
});
