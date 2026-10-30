import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Component, input, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { GarageRequestSummaryDto, MeDto } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';

import { QuoteSentRow } from './quote-sent-row';
import { Session } from '../../session';
import { ConfirmBookingDialog } from '../confirm-booking-dialog/confirm-booking-dialog';
import { quotedRow, requestRow } from '../garage-requests.testing';
import { GarageRequestsFeed } from '../garage-requests-feed';

@Component({
  imports: [QuoteSentRow],
  template: '<ul><li [mfQuoteSentRow]="row()" [now]="now()"></li></ul>',
})
class Host {
  readonly row = input.required<GarageRequestSummaryDto>();
  readonly now = input.required<Date>();
}

// 13:00 in Bucharest, a Friday.
const NOW = new Date('2026-10-09T10:00:00Z');

type Role = 'owner' | 'receptionist' | 'mechanic';
const me = (role: Role, canAnswerQuotes = false) =>
  ({
    capabilities: ['garage.requests'],
    garageAccess: [
      {
        features: {},
        garageId: 'garage-1',
        name: 'Service Auto',
        permissions: {
          canAnswerQuotes,
          canMoveBookings: false,
          canRecordFinalPrice: false,
        },
        role,
        status: 'approved',
      },
    ],
    garageId: 'garage-1',
  }) as unknown as MeDto;

let open: jest.Mock;
let reload: jest.Mock;

async function render(
  row: GarageRequestSummaryDto,
  language: 'ro' | 'en' = 'ro',
  account: MeDto = me('owner'),
) {
  const shown = signal(account);
  open = jest.fn(async () => 'cancelled');
  reload = jest.fn();
  TestBed.configureTestingModule({
    providers: [
      { provide: Session, useValue: { current: shown, shown } },
      { provide: Overlays, useValue: { open } },
      { provide: GarageRequestsFeed, useValue: { reload, sent: jest.fn() } },
    ],
  });
  await TestBed.inject(I18n).enter('garage');
  if (language === 'en') await TestBed.inject(I18n).use('en');
  const fixture = TestBed.createComponent(Host);
  fixture.componentRef.setInput('row', row);
  fixture.componentRef.setInput('now', NOW);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return (fixture.nativeElement as HTMLElement).querySelector(
    'li',
  ) as HTMLElement;
}

const text = (el: Element | null | undefined) =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

const jobs = requestRow().jobs;
const sample = (slot: string, over: Partial<GarageRequestSummaryDto> = {}) =>
  quotedRow(
    {
      car: {
        brand: 'BMW',
        engine: null,
        fuel: 'diesel',
        model: 'X3',
        year: 2019,
      },
      driver: { shortName: 'Irina S.' },
      jobs: [
        {
          ...jobs[0],
          id: 'rj-1',
          nameEn: 'Rear brakes',
          nameRo: 'Frâne spate',
        },
        {
          ...jobs[0],
          id: 'rj-2',
          jobTypeId: 'job-oil',
          nameEn: 'Oil change',
          nameRo: 'Schimb ulei',
          position: 1,
        },
        {
          ...jobs[0],
          id: 'rj-3',
          jobTypeId: 'job-ac',
          nameEn: 'AC refill',
          nameRo: 'Încărcare freon',
          offered: false,
          position: 2,
        },
      ],
      ...over,
    },
    {
      expiresAt: new Date(NOW.getTime() + 7 * 86_400_000).toISOString(),
      fromBani: 65_000,
      jobs: [
        { included: true, requestJobId: 'rj-1' },
        { included: true, requestJobId: 'rj-2' },
        { included: false, requestJobId: 'rj-3' },
      ],
      sentAt: new Date(NOW.getTime() - 5 * 60_000).toISOString(),
      slot,
      toBani: 80_000,
    },
  );

const HOUR = 3_600_000;
const PHONE = '+40722111222';

const withOutcome = (
  outcome: NonNullable<GarageRequestSummaryDto['outcome']> | null,
  over: Partial<GarageRequestSummaryDto> = {},
): GarageRequestSummaryDto => ({
  ...sample('2026-10-10T06:00:00Z', over),
  outcome,
});

const awaiting = (
  confirmIn = 5 * HOUR + 30 * 60_000,
  driver: GarageRequestSummaryDto['driver'] = {
    phone: PHONE,
    shortName: 'Irina S.',
  },
) => {
  const base = withOutcome('accepted', {
    booking: {
      confirmBy: new Date(NOW.getTime() + confirmIn).toISOString(),
      durationMinutes: 90,
      id: 'booking-1',
      lift: null,
      mechanic: null,
      startsAt: '2026-10-10T06:00:00Z',
      status: 'awaiting_confirmation',
      toReassign: false,
    },
    driver,
  });
  return {
    ...base,
    quote: base.quote && { ...base.quote, status: 'accepted' as const },
  };
};

const booked = (
  booking: Partial<NonNullable<GarageRequestSummaryDto['booking']>> = {},
): GarageRequestSummaryDto => {
  const base = awaiting();
  return {
    ...base,
    booking: {
      ...(base.booking as NonNullable<GarageRequestSummaryDto['booking']>),
      lift: 2,
      mechanic: { id: 'mech-1', name: 'Ion Popescu' },
      status: 'confirmed',
      toReassign: false,
      ...booking,
    },
    car: { ...base.car, plate: 'B123ABC' },
    outcome: 'booked',
  };
};

const ENDINGS = [
  ['lapsed', 'Neconfirmată la timp', 'Not confirmed in time'],
  ['chose_other', 'A ales alt service', 'Chose another garage'],
  ['expired', 'Expirată', 'Expired'],
  ['withdrawn', 'Retrasă', 'Withdrawn'],
  [
    'withdrawn_suspended',
    'Retrasă · service suspendat',
    'Withdrawn · garage suspended',
  ],
  [
    'request_cancelled',
    'Cerere anulată de client',
    'Request cancelled by the customer',
  ],
  ['booking_cancelled', 'Programare anulată', 'Booking cancelled'],
  [
    'account_closed',
    'Contul clientului a fost închis',
    "The customer's account was closed",
  ],
  ['declined', 'Refuzată de client', 'Declined by the customer'],
  ['no_show', 'Clientul nu s‑a prezentat', 'The customer did not show up'],
] as const;

const ended = (outcome: (typeof ENDINGS)[number][0]) =>
  withOutcome(outcome, {
    driver: { phone: PHONE, shortName: 'Irina S.' },
  });

const confirmButton = (row: HTMLElement, name = 'Confirmă programarea') =>
  [...row.querySelectorAll('button')].find(
    (b) => b.textContent?.replace(/\s+/g, ' ').trim() === name,
  );

const stylesheet = readFileSync(join(__dirname, 'quote-sent-row.css'), 'utf8');

afterEach(() => TestBed.resetTestingModule());

// @traces 344-FR-014
// @traces 346-FR-003
describe('a row under Oferte trimise', () => {
  it('shows the driver, the car, the included jobs, the range, the slot, the sent age and the waiting tag', async () => {
    const row = await render(sample('2026-10-10T06:00:00Z'));

    expect(text(row.querySelector('.name'))).toBe('Irina S.');
    expect(text(row.querySelector('.car'))).toBe('BMW X3 · 2019');
    expect(text(row.querySelector('.jobs'))).toBe('Frâne spate · Schimb ulei');
    expect(text(row)).not.toContain('Încărcare freon');
    expect(text(row.querySelector('.range'))).toBe('650 – 800 lei');
    expect(text(row.querySelector('.slot'))).toBe('mâine, 09:00');
    expect(row.querySelector('.slot')?.getAttribute('datetime')).toBe(
      '2026-10-10T06:00:00Z',
    );
    expect(text(row.querySelector('.sent'))).toBe('trimisă acum 5 min');
    expect(text(row.querySelector('.status'))).toBe(
      'Așteaptă răspunsul clientului',
    );
    expect(text(row.querySelector('.expires'))).toBe('expiră în 7 zile');
    expect(row.getAttribute('data-tone')).toBe('amber');
    expect(
      row.querySelector('.status .lamp')?.getAttribute('aria-hidden'),
    ).toBe('true');
  });

  it('writes it in English for an English reader', async () => {
    const row = await render(sample('2026-10-10T06:00:00Z'), 'en');

    expect(text(row.querySelector('.jobs'))).toBe('Rear brakes · Oil change');
    expect(text(row.querySelector('.slot'))).toBe('tomorrow, 09:00');
    expect(text(row.querySelector('.sent'))).toBe('sent 5 min ago');
    expect(text(row.querySelector('.status'))).toBe('Waiting for the customer');
    expect(text(row.querySelector('.expires'))).toBe('expires in 7 days');
  });

  it.each([
    ['2026-10-09T13:00:00Z', 'ro', 'azi, 16:00'],
    ['2026-10-09T13:00:00Z', 'en', 'today, 16:00'],
    ['2026-10-15T11:00:00Z', 'ro', 'joi, 15 oct., 14:00'],
    ['2026-10-15T11:00:00Z', 'en', 'Thu, 15 Oct, 14:00'],
  ] as const)(
    'words the slot %s in Bucharest time (%s) as %s',
    async (slot, language, said) => {
      const row = await render(sample(slot), language);

      expect(text(row.querySelector('.slot'))).toBe(said);
    },
  );

  it('shows the description’s first line when the request names no job', async () => {
    const row = await render(
      quotedRow(
        { descriptionLine: 'Scârțâie la frânare', jobs: [] },
        { jobs: [] },
      ),
    );

    expect(text(row.querySelector('.jobs'))).toBe('Scârțâie la frânare');
  });

  it('offers no button and no link while the quote waits for the driver', async () => {
    const row = await render(sample('2026-10-10T06:00:00Z'));

    expect(row.querySelector('button, a')).toBeNull();
  });

  it('shows no tag, no lamp and no expiry when the row carries no outcome', async () => {
    const row = await render(withOutcome(null));

    expect(row.querySelector('.status')).toBeNull();
    expect(row.querySelector('.lamp')).toBeNull();
    expect(row.querySelector('.expires')).toBeNull();
    expect(row.hasAttribute('data-tone')).toBe(false);
  });
});

// @traces 346-FR-003
describe('the outcome tag of a row', () => {
  it.each(ENDINGS)('reads %s as “%s” / “%s”, grey', async (outcome, ro, en) => {
    const romanian = await render(ended(outcome));
    expect(text(romanian.querySelector('.status'))).toBe(ro);
    expect(romanian.getAttribute('data-tone')).toBe('grey');
    expect(
      romanian.querySelector('.status .lamp')?.getAttribute('aria-hidden'),
    ).toBe('true');
    TestBed.resetTestingModule();

    const english = await render(ended(outcome), 'en');
    expect(text(english.querySelector('.status'))).toBe(en);
  });

  it.each(ENDINGS)(
    'shows no button, no phone and no expiry once the quote ended as %s',
    async (outcome) => {
      const row = await render(ended(outcome));

      expect(row.querySelector('button')).toBeNull();
      expect(row.querySelector('a.phone')).toBeNull();
      expect(row.querySelector('.expires')).toBeNull();
      expect(text(row.querySelector('.sent'))).toBe('trimisă acum 5 min');
    },
  );

  it('reads the tag from the outcome, not from the quote’s status', async () => {
    const base = withOutcome('chose_other');
    const row = await render({
      ...base,
      quote: base.quote && { ...base.quote, status: 'waiting' },
    });

    expect(text(row.querySelector('.status'))).toBe('A ales alt service');
  });

  it.each([
    [5 * 60_000, 'expiră în 5 min'],
    [3 * HOUR, 'expiră în 3 h'],
    [-HOUR, 'expiră în câteva momente'],
  ])(
    'words the expiry of a waiting quote %d ms away as %s',
    async (inMs, said) => {
      const row = await render(
        withOutcome('waiting', {
          quote: {
            ...(sample('2026-10-10T06:00:00Z').quote as NonNullable<
              GarageRequestSummaryDto['quote']
            >),
            expiresAt: new Date(NOW.getTime() + inMs).toISOString(),
          },
        }),
      );

      expect(text(row.querySelector('.expires'))).toBe(said);
    },
  );

  it('colours the lamp green on a booked row and grey on an ended one, by the row’s tone', () => {
    expect(stylesheet).toMatch(
      /:host\(\[data-tone=["']?green["']?\]\) \.lamp \{[^}]*background: var\(--mf-green\)/,
    );
    expect(stylesheet).toMatch(
      /:host\(\[data-tone=["']?grey["']?\]\) \.status \{[^}]*color: var\(--mf-text-secondary\)/,
    );
    expect(stylesheet).toMatch(
      /:host\(\[data-tone=["']?grey["']?\]\) \.lamp \{[^}]*background: var\(--mf-text-secondary\)/,
    );
    expect(stylesheet).not.toMatch(/:host\(\.(accepted|declined)\)/);
  });
});

// @traces 222-FR-013
// @traces 346-FR-003
describe('a row whose quote the driver accepted', () => {
  it('says the garage has to confirm it by the deadline, in amber', async () => {
    const row = await render(awaiting());

    expect(text(row.querySelector('.status'))).toBe(
      'Acceptată · confirmă până la 18:30',
    );
    expect(row.getAttribute('data-tone')).toBe('amber');
    expect(row.querySelector('.expires')).toBeNull();
  });

  it('writes it in English for an English reader', async () => {
    const row = await render(awaiting(), 'en');

    expect(text(row.querySelector('.status'))).toBe(
      'Accepted · confirm by 18:30',
    );
  });

  it('says tomorrow when the deadline falls on the next Bucharest day', async () => {
    const row = await render(awaiting(20 * HOUR));

    expect(text(row.querySelector('.status'))).toBe(
      'Acceptată · confirmă până la mâine, 09:00',
    );
  });

  it('keeps the name, the car, the jobs, the range and the slot', async () => {
    const row = await render(awaiting());

    expect(text(row.querySelector('.name'))).toBe('Irina S.');
    expect(text(row.querySelector('.car'))).toBe('BMW X3 · 2019');
    expect(text(row.querySelector('.jobs'))).toBe('Frâne spate · Schimb ulei');
    expect(text(row.querySelector('.range'))).toBe('650 – 800 lei');
    expect(text(row.querySelector('.slot'))).toBe('mâine, 09:00');
  });

  it('links the driver’s phone for a call when the row carries it', async () => {
    const row = await render(awaiting());

    const link = row.querySelector('a.phone');
    expect(link?.getAttribute('href')).toBe(`tel:${PHONE}`);
    expect(text(link)).toBe(PHONE);
    expect(link?.getAttribute('aria-label')).toBe(`Sună clientul: ${PHONE}`);
  });

  it('shows no phone when the row carries none', async () => {
    const row = await render(awaiting(5 * HOUR, { shortName: 'Irina S.' }));

    expect(row.querySelector('a')).toBeNull();
  });

  it('gives the phone link a 44 px target', () => {
    expect(stylesheet).toMatch(/\.phone \{[^}]*min-height: 44px/);
  });
});

// @traces 389-FR-014
// @traces 346-FR-003
describe('the confirm button on an accepted row', () => {
  it.each(['owner', 'receptionist'] as const)(
    'shows Confirmă programarea to a %s',
    async (role) => {
      const row = await render(awaiting(), 'ro', me(role));

      expect(confirmButton(row)).toBeDefined();
    },
  );

  it('says Confirm the booking in English', async () => {
    const row = await render(awaiting(), 'en');

    expect(confirmButton(row, 'Confirm the booking')).toBeDefined();
  });

  it.each([true, false])(
    'is absent for a mechanic (can answer quotes: %s)',
    async (can) => {
      const row = await render(awaiting(), 'ro', me('mechanic', can));

      expect(row.querySelector('button')).toBeNull();
    },
  );

  it('is absent while the quote waits for the driver', async () => {
    const row = await render(sample('2026-10-10T06:00:00Z'));

    expect(row.querySelector('button')).toBeNull();
  });

  it('is absent on a booked row', async () => {
    const row = await render(booked());

    expect(row.querySelector('button')).toBeNull();
  });

  it('opens the confirm panel for the row and re-reads the lists once confirmed', async () => {
    const data = awaiting();
    const row = await render(data);
    open.mockResolvedValueOnce('confirmed');

    confirmButton(row)?.click();
    await new Promise((resolve) => setTimeout(resolve));

    expect(open).toHaveBeenCalledWith(ConfirmBookingDialog, {
      data: { row: data },
      shape: 'drawer',
      title: 'garage.quotes.confirm.title',
    });
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

// @traces 389-FR-015
// @traces 389-FR-017
// @traces 346-FR-003
describe('a booked row', () => {
  it('reads Acceptată · programată with the day and time, in green', async () => {
    const row = await render(booked());

    expect(text(row.querySelector('.status'))).toBe(
      'Acceptată · programată mâine, 09:00',
    );
    expect(row.getAttribute('data-tone')).toBe('green');
    expect(row.querySelector('.status time')?.getAttribute('datetime')).toBe(
      '2026-10-10T06:00:00Z',
    );
  });

  it('reads Accepted · booked in English', async () => {
    const row = await render(booked(), 'en');

    expect(text(row.querySelector('.status'))).toBe(
      'Accepted · booked tomorrow, 09:00',
    );
    expect(text(row.querySelector('.lift'))).toBe('Lift 2');
  });

  it('names the weekday and date of a later slot', async () => {
    const row = await render(booked({ startsAt: '2026-10-15T11:00:00Z' }));

    expect(text(row.querySelector('.status'))).toBe(
      'Acceptată · programată joi, 15 oct., 14:00',
    );
  });

  it('keeps the slot once it has passed', async () => {
    const row = await render(booked({ startsAt: '2026-10-08T09:00:00Z' }));

    expect(text(row.querySelector('.status'))).toMatch(
      /^Acceptată · programată /,
    );
    expect(row.getAttribute('data-tone')).toBe('green');
  });

  it('shows the mechanic, the lift, the phone and the plate, and no button', async () => {
    const row = await render(booked());

    expect(text(row.querySelector('.mechanic'))).toBe('Ion Popescu');
    expect(text(row.querySelector('.lift'))).toBe('Elevator 2');
    expect(row.querySelector('a.phone')?.getAttribute('href')).toBe(
      'tel:+40722111222',
    );
    expect(text(row.querySelector('.plate'))).toBe('B123ABC');
    expect(row.querySelector('button')).toBeNull();
    expect(text(row)).not.toContain('confirmă până la');
  });

  it('shows no phone on a booked row that carries none', async () => {
    const base = booked();
    const row = await render({
      ...base,
      driver: { shortName: 'Irina S.' },
    });

    expect(row.querySelector('a.phone')).toBeNull();
    expect(text(row.querySelector('.plate'))).toBe('B123ABC');
  });

  it('stacks the status, the booking and the phone in one column, on the 8 px step', async () => {
    const row = await render(booked());

    const state = row.querySelector('.state');
    expect(
      [...(state?.children ?? [])].map((child) => child.classList[0]),
    ).toEqual(['status', 'booking', 'phone']);
    expect(stylesheet).toMatch(
      /\.state \{[^}]*flex-direction: column;[^}]*gap: var\(--mf-space-2\)/,
    );
    // A status that wraps keeps its lamp beside the first line.
    expect(stylesheet).toMatch(/\.status \{[^}]*align-items: flex-start/);
    expect(stylesheet).toMatch(
      /\.lamp \{[^}]*margin-top: calc\(\(1lh - 8px\) \/ 2\)/,
    );
    // The 44 px target reaches below the number, never above it.
    expect(stylesheet).toMatch(/\.phone \{[^}]*align-items: flex-start/);
  });

  it('leaves out the mechanic and the lift when none was set', async () => {
    const row = await render(booked({ lift: null, mechanic: null }));

    expect(row.querySelector('.mechanic')).toBeNull();
    expect(row.querySelector('.lift')).toBeNull();
    expect(text(row.querySelector('.plate'))).toBe('B123ABC');
  });
});

// @traces 056-FR-008
describe('a booked row whose mechanic left the team', () => {
  it('reads de realocat beside the mechanic', async () => {
    const row = await render(booked({ toReassign: true }));

    const booking = text(row.querySelector('.booking'));
    expect(text(row.querySelector('.mechanic'))).toContain('Ion Popescu');
    expect(booking).toMatch(/Ion Popescu.*de realocat/);
  });

  it('reads to reassign in English', async () => {
    const row = await render(booked({ toReassign: true }), 'en');

    expect(text(row.querySelector('.booking'))).toMatch(
      /Ion Popescu.*to reassign/,
    );
  });

  it('says nothing more while the mechanic is still on the team', async () => {
    const row = await render(booked({ toReassign: false }));

    expect(text(row)).not.toContain('de realocat');
    expect(text(row.querySelector('.mechanic'))).toBe('Ion Popescu');
  });
});

describe('type scale on a phone', () => {
  // @traces 975-FR-003
  // @traces 975-FR-008
  const at = stylesheet.indexOf('@media (min-width: 768px)');
  const phone = at < 0 ? stylesheet : stylesheet.slice(0, at);
  const tablet = at < 0 ? '' : stylesheet.slice(at);

  it('sets no text under the body size on a phone', () => {
    expect(phone).not.toMatch(/font-size: var\(--mf-size-(small|label)\)/);
  });

  it('sets the car, the slot and the status small from a tablet up', () => {
    expect(tablet).toMatch(
      /\.car,\s*\.slot,\s*\.status \{\s*font-size: var\(--mf-size-small\);/,
    );
  });
});
