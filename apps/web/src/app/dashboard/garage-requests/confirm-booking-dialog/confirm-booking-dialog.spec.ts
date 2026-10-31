import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import {
  BookingsService,
  type ConfirmOptionsDto,
  type GarageRequestSummaryDto,
} from '@motor-fix/data-access';
import { formatSlot, I18n } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';
import { toast } from '@motor-fix/ui-cockpit';

import {
  type ConfirmBookingData,
  ConfirmBookingDialog,
  type ConfirmBookingResult,
} from './confirm-booking-dialog';
import { Session } from '../../session';
import { quotedRow } from '../garage-requests.testing';

jest.mock('@motor-fix/ui-cockpit', () => ({
  ...jest.requireActual('@motor-fix/ui-cockpit'),
  toast: jest.fn(),
}));

@Component({
  template: '<button type="button" id="opener">Confirmă programarea</button>',
})
class Host {
  readonly overlays = inject(Overlays);
}

const HOUR = 3_600_000;
const STARTS = new Date(Date.now() + 3 * 24 * HOUR).toISOString();

const row = (): GarageRequestSummaryDto => {
  const base = quotedRow(
    {
      booking: {
        confirmBy: new Date(Date.now() + 5 * HOUR + 30 * 60_000).toISOString(),
        durationMinutes: 90,
        id: 'booking-1',
        lift: null,
        mechanic: null,
        startsAt: STARTS,
        status: 'awaiting_confirmation',
        toReassign: false,
      },
      car: {
        brand: 'BMW',
        engine: null,
        fuel: 'diesel',
        model: 'X3',
        plate: 'B123ABC',
        year: 2019,
      },
      driver: { phone: '+40722111222', shortName: 'Irina S.' },
    },
    { jobs: [{ included: true, requestJobId: 'rj-1' }], status: 'accepted' },
  );
  return base;
};

const TEAM: ConfirmOptionsDto = {
  liftCount: 2,
  mechanicRequired: true,
  mechanics: [
    { id: 'mech-1', name: 'Ion Popescu' },
    { id: 'mech-2', name: 'Maria Ionescu' },
  ],
  needsLift: false,
};

let confirm: jest.Mock;
let options: jest.Mock;
let result: Promise<ConfirmBookingResult | 'cancelled'>;

async function settle() {
  for (let i = 0; i < 6; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

async function open({
  capabilities = ['garage.requests', 'garage.team'],
  language = 'ro',
  offered = TEAM,
}: {
  capabilities?: string[];
  language?: 'ro' | 'en';
  offered?: ConfirmOptionsDto;
} = {}) {
  confirm = jest.fn(async () => ({ id: 'booking-1', status: 'confirmed' }));
  options = jest.fn(async () => offered);
  TestBed.configureTestingModule({
    providers: [
      provideRouter([{ children: [], path: '**' }]),
      { provide: Session, useValue: { shown: () => ({ capabilities }) } },
      {
        provide: BookingsService,
        useValue: {
          confirmControllerConfirm: confirm,
          confirmControllerOptions: options,
        },
      },
    ],
  });
  await TestBed.inject(I18n).enter('garage');
  if (language === 'en') await TestBed.inject(I18n).use('en');
  const host = TestBed.createComponent(Host);
  document.body.appendChild(host.nativeElement);
  (host.nativeElement as HTMLElement)
    .querySelector<HTMLButtonElement>('#opener')
    ?.focus();
  result = host.componentInstance.overlays.open<
    ConfirmBookingResult,
    ConfirmBookingData
  >(ConfirmBookingDialog, {
    data: { row: row() },
    shape: 'drawer',
    title: 'garage.quotes.confirm.title',
  });
  await settle();
  return host.nativeElement as HTMLElement;
}

const panel = () =>
  document.querySelector<HTMLElement>('mf-overlay-panel') as HTMLElement;
const text = () => (panel()?.textContent ?? '').replace(/\s+/g, ' ');

const button = (name: string) =>
  [...panel().querySelectorAll('button')].find(
    (b) => b.textContent?.replace(/\s+/g, ' ').trim() === name,
  ) as HTMLButtonElement | undefined;

// A select by its visible label.
function select(label: string) {
  const tag = [...panel().querySelectorAll('label')].find(
    (l) => l.textContent?.replace(/\s+/g, ' ').trim() === label,
  );
  const id = tag?.getAttribute('for');
  return id ? panel().querySelector<HTMLSelectElement>(`select#${id}`) : null;
}

const choices = (el: HTMLSelectElement | null) =>
  [...(el?.options ?? [])]
    .filter((o) => o.value !== '' || o.textContent?.trim())
    .map((o) => o.textContent?.trim());

async function choose(label: string, shown: string) {
  const el = select(label) as HTMLSelectElement;
  const option = [...el.options].find((o) => o.textContent?.trim() === shown);
  el.value = option?.value ?? '';
  el.dispatchEvent(new Event('change'));
  await settle();
}

const press = async (name = 'Confirmă') => {
  button(name)?.click();
  await settle();
};

// The message tied to a select, announced as it appears.
function messageOf(el: HTMLSelectElement | null) {
  const ids = el?.getAttribute('aria-describedby')?.split(' ') ?? [];
  const said = ids
    .map((id) => document.getElementById(id))
    .find((m) => m?.textContent?.trim());
  return said ?? null;
}

const refusal = (status: number, body: Record<string, unknown>) =>
  new HttpErrorResponse({ error: body, status });

afterEach(() => {
  document.querySelectorAll('.cdk-overlay-container').forEach((n) => {
    n.innerHTML = '';
  });
  (toast as unknown as jest.Mock).mockClear();
  TestBed.resetTestingModule();
});

// @traces 389-FR-014
// @traces 389-FR-017
describe('the confirm panel: what it shows', () => {
  it('names the booking under the title, with the time left first', async () => {
    await open();

    expect(panel().querySelector('h2')?.textContent?.trim()).toBe(
      'Confirmă programarea',
    );
    const left = panel().querySelector('.left');
    expect(left?.textContent).toContain('încă 5 h');
    expect(text().indexOf('încă 5 h')).toBeLessThan(text().indexOf('Irina S.'));
    expect(text()).toContain('Irina S.');
    expect(text()).toContain('BMW X3 · 2019');
    expect(text()).toContain('Schimb de ulei și filtre');
    expect(text()).toContain('90 min');
    const slot = panel().querySelector(`time[datetime="${STARTS}"]`);
    expect(slot?.textContent?.trim()).toBe(
      formatSlot(STARTS, 'ro', new Date()),
    );
  });

  it('reads the choices for the booking it confirms', async () => {
    await open();

    expect(options).toHaveBeenCalledWith({ id: 'booking-1' });
  });

  it('offers the mechanics by name, none picked, and the lifts after Fără elevator', async () => {
    await open();

    const mechanic = select('Mecanic');
    expect(mechanic).not.toBeNull();
    expect(mechanic?.value).toBe('');
    expect(
      [...(mechanic?.options ?? [])]
        .filter((o) => o.value)
        .map((o) => o.textContent?.trim()),
    ).toEqual(['Ion Popescu', 'Maria Ionescu']);
    const lift = select('Elevator');
    expect(choices(lift)).toEqual([
      'Fără elevator',
      'Elevator 1',
      'Elevator 2',
    ]);
    expect(lift?.selectedOptions[0]?.textContent?.trim()).toBe('Fără elevator');
    expect(mechanic?.hasAttribute('hlminput')).toBe(true);
  });

  it('reads in English', async () => {
    await open({ language: 'en' });

    expect(panel().querySelector('h2')?.textContent?.trim()).toBe(
      'Confirm the booking',
    );
    expect(select('Mechanic')).not.toBeNull();
    expect(choices(select('Lift'))).toEqual(['No lift', 'Lift 1', 'Lift 2']);
    expect(button('Confirm')).toBeDefined();
    expect(button('Cancel')).toBeDefined();
  });

  it('shows nothing of the car’s history or its plate', async () => {
    await open();

    expect(text()).not.toMatch(/Istoric|history/i);
    expect(text()).not.toContain('B123ABC');
  });
});

// @traces 389-FR-014
describe('the confirm panel: which choices it offers', () => {
  it('has no mechanic select when the garage works without a team', async () => {
    await open({
      offered: {
        liftCount: 2,
        mechanicRequired: false,
        mechanics: [],
        needsLift: false,
      },
    });

    expect(select('Mecanic')).toBeNull();
    expect(select('Elevator')).not.toBeNull();
  });

  it('has no lift select when the garage schedules no lifts', async () => {
    await open({ offered: { ...TEAM, liftCount: 0 } });

    expect(select('Elevator')).toBeNull();
    expect(select('Mecanic')).not.toBeNull();
  });

  it('confirms with nothing to choose when both are off', async () => {
    await open({
      offered: {
        liftCount: 0,
        mechanicRequired: false,
        mechanics: [],
        needsLift: false,
      },
    });

    expect(panel().querySelector('select')).toBeNull();

    await press();

    expect(confirm).toHaveBeenCalledWith({ body: {}, id: 'booking-1' });
    await expect(result).resolves.toBe('confirmed');
  });
});

// @traces 389-FR-004
// @traces 389-FR-014
describe('the confirm panel: a team with no mechanic yet', () => {
  const EMPTY: ConfirmOptionsDto = {
    liftCount: 2,
    mechanicRequired: true,
    mechanics: [],
    needsLift: false,
  };

  it('shows the required mechanic select with nothing to pick and says to add one first', async () => {
    await open({ offered: EMPTY });

    const el = select('Mecanic');
    expect(el).not.toBeNull();
    expect(el?.required).toBe(true);
    expect(choices(el)).toEqual(['Alege mecanicul']);
    expect(messageOf(el)?.textContent).toContain(
      'Adaugă mai întâi un mecanic în echipă.',
    );
  });

  it('links to the team page, closing the panel', async () => {
    await open({ offered: EMPTY });

    const link = [...panel().querySelectorAll('a')].find(
      (a) => a.textContent?.trim() === 'Deschide echipa',
    );
    expect(link?.getAttribute('href')).toBe('/app/garage/team');

    link?.click();
    await settle();

    await expect(result).resolves.toBe('cancelled');
  });

  it('gives a receptionist, who cannot open the team page, the text without the link', async () => {
    await open({ capabilities: ['garage.requests'], offered: EMPTY });

    expect(messageOf(select('Mecanic'))?.textContent).toContain(
      'Adaugă mai întâi un mecanic în echipă.',
    );
    expect(text()).not.toContain('Deschide echipa');
    expect(panel().querySelector('#mf-confirm-mechanic-none a')).toBeNull();
  });

  it('keeps Confirm off, so nothing is sent', async () => {
    await open({ offered: EMPTY });

    expect(button('Confirmă')?.disabled).toBe(true);
    await press();

    expect(confirm).not.toHaveBeenCalled();
  });

  it('says it in English', async () => {
    await open({ language: 'en', offered: EMPTY });

    expect(messageOf(select('Mechanic'))?.textContent).toContain(
      'Add a mechanic to your team first.',
    );
    expect(text()).toContain('Open the team');
  });
});

// @traces 389-FR-014
describe('the confirm panel: confirming', () => {
  it('asks for a mechanic before sending', async () => {
    await open();

    await press();

    expect(confirm).not.toHaveBeenCalled();
    const mechanic = select('Mecanic');
    expect(mechanic?.getAttribute('aria-invalid')).toBe('true');
    expect(messageOf(mechanic)?.textContent?.trim()).toBe('Alege un mecanic.');
  });

  it('sends the mechanic and the lift, then closes with the row re-read', async () => {
    await open();
    await choose('Mecanic', 'Maria Ionescu');
    await choose('Elevator', 'Elevator 2');

    await press();

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0][0]).toEqual({
      body: { lift: 2, mechanicId: 'mech-2' },
      id: 'booking-1',
    });
    await expect(result).resolves.toBe('confirmed');
    expect(toast).toHaveBeenCalledWith('Programare confirmată');
  });

  it('sends no lift when Fără elevator stays picked', async () => {
    await open();
    await choose('Mecanic', 'Ion Popescu');

    await press();

    expect(confirm.mock.calls[0][0].body).toEqual({ mechanicId: 'mech-1' });
  });

  it('says Booking confirmed in English', async () => {
    await open({ language: 'en' });
    await choose('Mechanic', 'Ion Popescu');

    await press('Confirm');

    await expect(result).resolves.toBe('confirmed');
    expect(toast).toHaveBeenCalledWith('Booking confirmed');
  });

  it.each([
    ['mechanic_busy', 'Mecanic', 'Maria Ionescu e ocupat la ora asta'],
    ['mechanic_unavailable', 'Mecanic', 'Mecanicul nu e disponibil'],
    ['lift_busy', 'Elevator', 'Elevatorul 2 e ocupat la ora asta'],
  ])(
    'shows a 409 %s under %s, announced, with the choices kept',
    async (code, label, message) => {
      await open();
      await choose('Mecanic', 'Maria Ionescu');
      await choose('Elevator', 'Elevator 2');
      confirm.mockRejectedValueOnce(refusal(409, { code, status: 409 }));

      await press();

      const said = messageOf(select(label));
      expect(said?.textContent?.trim()).toBe(message);
      expect(
        said?.closest('[role="alert"]') ?? said?.getAttribute('role'),
      ).toBeTruthy();
      expect(select('Mecanic')?.selectedOptions[0]?.textContent?.trim()).toBe(
        'Maria Ionescu',
      );
      expect(select('Elevator')?.selectedOptions[0]?.textContent?.trim()).toBe(
        'Elevator 2',
      );
      expect(panel()).not.toBeNull();
    },
  );

  it('words the busy lift and the mechanic in English', async () => {
    await open({ language: 'en' });
    await choose('Mechanic', 'Ion Popescu');
    await choose('Lift', 'Lift 1');
    confirm.mockRejectedValueOnce(
      refusal(409, { code: 'lift_busy', status: 409 }),
    );

    await press('Confirm');

    expect(messageOf(select('Lift'))?.textContent?.trim()).toBe(
      'Lift 1 is busy at this time',
    );
  });

  it('shows a 409 outside_hours at the top, the panel open', async () => {
    await open();
    await choose('Mecanic', 'Ion Popescu');
    confirm.mockRejectedValueOnce(
      refusal(409, { code: 'outside_hours', status: 409 }),
    );

    await press();

    const alert = panel().querySelector('[role="alert"]');
    expect(alert?.textContent?.trim()).toBe('În afara programului');
    expect(text().indexOf('În afara programului')).toBeLessThan(
      text().indexOf('Irina S.'),
    );
    expect(select('Mecanic')?.selectedOptions[0]?.textContent?.trim()).toBe(
      'Ion Popescu',
    );
    expect(button('Confirmă')).toBeDefined();
  });

  it.each([
    ['confirmed', 'Programarea e deja confirmată'],
    ['lapsed', 'Programarea a expirat'],
    ['cancelled', 'Programarea a fost anulată'],
  ])(
    'says a booking already %s and closes for the lists to re-read',
    async (currentStatus, message) => {
      await open();
      await choose('Mecanic', 'Ion Popescu');
      confirm.mockRejectedValueOnce(
        refusal(409, {
          code: 'invalid_transition',
          currentStatus,
          status: 409,
        }),
      );

      await press();

      expect(toast).toHaveBeenCalledWith(message);
      await expect(result).resolves.toBe('refused');
    },
  );

  it('says the booking expired in English', async () => {
    await open({ language: 'en' });
    await choose('Mechanic', 'Ion Popescu');
    confirm.mockRejectedValueOnce(
      refusal(409, {
        code: 'invalid_transition',
        currentStatus: 'lapsed',
        status: 409,
      }),
    );

    await press('Confirm');

    expect(toast).toHaveBeenCalledWith('The booking has expired');
  });

  it('says outside opening hours in English', async () => {
    await open({ language: 'en' });
    await choose('Mechanic', 'Ion Popescu');
    confirm.mockRejectedValueOnce(
      refusal(409, { code: 'outside_hours', status: 409 }),
    );

    await press('Confirm');

    expect(panel().querySelector('[role="alert"]')?.textContent?.trim()).toBe(
      'Outside opening hours',
    );
  });

  it('clears a select’s message once another choice is made, and sends again', async () => {
    await open();
    await choose('Mecanic', 'Maria Ionescu');
    confirm.mockRejectedValueOnce(
      refusal(409, { code: 'mechanic_busy', status: 409 }),
    );
    await press();

    await choose('Mecanic', 'Ion Popescu');

    expect(messageOf(select('Mecanic'))).toBeNull();
    await press();
    expect(confirm).toHaveBeenCalledTimes(2);
    await expect(result).resolves.toBe('confirmed');
  });
});

// @traces 389-FR-017
describe('the confirm panel: closing', () => {
  it('closes on Renunță without confirming, the focus back on the opener', async () => {
    const host = await open();

    await press('Renunță');

    await expect(result).resolves.toBe('cancelled');
    expect(confirm).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(host.querySelector('#opener'));
  });

  it('closes on Esc as Renunță does', async () => {
    await open();

    (document.activeElement ?? document.body).dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }),
    );
    await settle();

    await expect(result).resolves.toBe('cancelled');
    expect(confirm).not.toHaveBeenCalled();
  });
});

// @traces 1384-FR-001 1384-FR-002 1384-FR-003 1384-FR-006
describe('the confirm panel: the job’s lift need', () => {
  const LIFT_JOB: ConfirmOptionsDto = { ...TEAM, needsLift: true };
  const picked = (label: string) =>
    select(label)?.selectedOptions[0]?.textContent?.trim();

  it('picks Fără elevator when no job needs a lift, and sends no lift', async () => {
    await open();

    expect(picked('Elevator')).toBe('Fără elevator');
    expect(choices(select('Elevator'))).toEqual([
      'Fără elevator',
      'Elevator 1',
      'Elevator 2',
    ]);
    await choose('Mecanic', 'Ion Popescu');
    await press();
    expect(confirm.mock.calls[0][0].body).toEqual({ mechanicId: 'mech-1' });
  });

  it('asks for a lift, none picked, when a job needs one, Fără elevator still offered', async () => {
    await open({ offered: LIFT_JOB });

    const lift = select('Elevator');
    expect(picked('Elevator')).toBe('Alege elevatorul');
    expect(lift?.value).toBe('');
    expect(choices(lift)).toEqual([
      'Alege elevatorul',
      'Fără elevator',
      'Elevator 1',
      'Elevator 2',
    ]);
    expect(lift?.required).toBe(true);
  });

  it('holds the confirm until a lift choice is made, saying so under the select', async () => {
    await open({ offered: LIFT_JOB });
    await choose('Mecanic', 'Maria Ionescu');

    await press();

    expect(confirm).not.toHaveBeenCalled();
    const lift = select('Elevator');
    expect(lift?.getAttribute('aria-invalid')).toBe('true');
    expect(messageOf(lift)?.textContent?.trim()).toBe(
      'Alege un elevator sau Fără elevator.',
    );
    expect(document.activeElement).toBe(lift);
    expect(picked('Mecanic')).toBe('Maria Ionescu');
  });

  it('confirms with no lift once Fără elevator is picked, the message gone', async () => {
    await open({ offered: LIFT_JOB });
    await choose('Mecanic', 'Ion Popescu');
    await press();

    await choose('Elevator', 'Fără elevator');

    expect(messageOf(select('Elevator'))).toBeNull();
    await press();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0][0].body).toEqual({ mechanicId: 'mech-1' });
    await expect(result).resolves.toBe('confirmed');
  });

  it('sends the lift picked and closes', async () => {
    await open({ offered: LIFT_JOB });
    await choose('Mecanic', 'Ion Popescu');
    await choose('Elevator', 'Elevator 1');

    await press();

    expect(confirm.mock.calls[0][0].body).toEqual({
      lift: 1,
      mechanicId: 'mech-1',
    });
    await expect(result).resolves.toBe('confirmed');
  });

  it('asks nothing about a lift when the garage schedules none', async () => {
    await open({ offered: { ...LIFT_JOB, liftCount: 0 } });
    expect(select('Elevator')).toBeNull();
    await choose('Mecanic', 'Ion Popescu');

    await press();

    expect(confirm.mock.calls[0][0].body).toEqual({ mechanicId: 'mech-1' });
  });

  it('asks for the mechanic first, then the lift', async () => {
    await open({ offered: LIFT_JOB });

    await press();
    expect(messageOf(select('Mecanic'))?.textContent?.trim()).toBe(
      'Alege un mecanic.',
    );
    expect(messageOf(select('Elevator'))).toBeNull();
    expect(document.activeElement).toBe(select('Mecanic'));

    await choose('Mecanic', 'Ion Popescu');
    await press();
    expect(messageOf(select('Elevator'))?.textContent?.trim()).toBe(
      'Alege un elevator sau Fără elevator.',
    );
    expect(confirm).not.toHaveBeenCalled();
  });

  it('asks in English', async () => {
    await open({ language: 'en', offered: LIFT_JOB });
    expect(choices(select('Lift'))).toEqual([
      'Choose a lift',
      'No lift',
      'Lift 1',
      'Lift 2',
    ]);
    await choose('Mechanic', 'Ion Popescu');

    await press('Confirm');

    expect(messageOf(select('Lift'))?.textContent?.trim()).toBe(
      'Choose a lift or No lift.',
    );
  });
});

// @traces 1384-FR-004 1384-FR-005 1384-FR-006
describe('the confirm panel: a slot taken meanwhile', () => {
  const taken = () =>
    refusal(409, {
      code: 'slot_taken',
      detail: 'Locul tocmai a fost ocupat',
      status: 409,
    });
  const picked = (label: string) =>
    select(label)?.selectedOptions[0]?.textContent?.trim();
  const top = () =>
    panel().querySelector('p.problem[role="alert"]')?.textContent?.trim();

  async function refusedOnce() {
    await choose('Mecanic', 'Maria Ionescu');
    await choose('Elevator', 'Elevator 2');
    confirm.mockRejectedValueOnce(taken());
    await press();
  }

  it('says so at the top, reads the choices again and keeps both picks', async () => {
    await open();
    await refusedOnce();

    expect(top()).toBe('Locul tocmai a fost ocupat');
    expect(options).toHaveBeenCalledTimes(2);
    expect(panel()).not.toBeNull();
    expect(picked('Mecanic')).toBe('Maria Ionescu');
    expect(picked('Elevator')).toBe('Elevator 2');

    await press();
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(confirm.mock.calls[1][0].body).toEqual({
      lift: 2,
      mechanicId: 'mech-2',
    });
  });

  it('clears a lift no longer offered to the opening choice, the mechanic kept', async () => {
    await open({ offered: { ...TEAM, needsLift: true } });
    options.mockResolvedValueOnce({ ...TEAM, liftCount: 1, needsLift: true });
    await refusedOnce();

    expect(picked('Elevator')).toBe('Alege elevatorul');
    expect(choices(select('Elevator'))).toEqual([
      'Alege elevatorul',
      'Fără elevator',
      'Elevator 1',
    ]);
    expect(picked('Mecanic')).toBe('Maria Ionescu');
  });

  it('clears a mechanic no longer offered, the lift kept', async () => {
    await open();
    options.mockResolvedValueOnce({
      ...TEAM,
      mechanics: [{ id: 'mech-1', name: 'Ion Popescu' }],
    });
    await refusedOnce();

    expect(picked('Mecanic')).toBe('Alege mecanicul');
    expect(picked('Elevator')).toBe('Elevator 2');
  });

  it('clears both when neither is offered any more', async () => {
    await open();
    options.mockResolvedValueOnce({
      ...TEAM,
      liftCount: 1,
      mechanics: [{ id: 'mech-1', name: 'Ion Popescu' }],
    });
    await refusedOnce();

    expect(picked('Mecanic')).toBe('Alege mecanicul');
    expect(picked('Elevator')).toBe('Fără elevator');
  });

  it('keeps the choices and lets the person press again when the re-read fails', async () => {
    await open();
    options.mockRejectedValueOnce(refusal(500, { code: 'error', status: 500 }));
    await refusedOnce();

    expect(top()).toBeTruthy();
    expect(top()).not.toBe('Locul tocmai a fost ocupat');
    expect(picked('Mecanic')).toBe('Maria Ionescu');
    expect(picked('Elevator')).toBe('Elevator 2');
    expect(button('Confirmă')?.disabled).toBe(false);
  });

  it('sends nothing while the choices are being read again', async () => {
    await open();
    let land: (o: ConfirmOptionsDto) => void = () => undefined;
    options.mockImplementationOnce(
      () => new Promise<ConfirmOptionsDto>((resolve) => (land = resolve)),
    );
    await refusedOnce();

    expect(button('Confirmă')?.disabled).toBe(true);
    expect(select('Mecanic')?.disabled).toBe(true);
    expect(select('Elevator')?.disabled).toBe(true);
    await press();
    expect(confirm).toHaveBeenCalledTimes(1);

    land(TEAM);
    await settle();
    expect(button('Confirmă')?.disabled).toBe(false);
  });

  it('clears the message on the next press, not on a choice change', async () => {
    await open();
    await refusedOnce();

    await choose('Elevator', 'Elevator 1');
    expect(top()).toBe('Locul tocmai a fost ocupat');

    confirm.mockImplementationOnce(() => new Promise(() => undefined));
    await press();
    expect(top()).toBeUndefined();
    expect(confirm).toHaveBeenCalledTimes(2);
  });

  it('says it in English', async () => {
    await open({ language: 'en' });
    await choose('Mechanic', 'Ion Popescu');
    confirm.mockRejectedValueOnce(
      refusal(409, {
        code: 'slot_taken',
        detail: 'The slot was just taken',
        status: 409,
      }),
    );

    await press('Confirm');

    expect(top()).toBe('The slot was just taken');
  });
});
