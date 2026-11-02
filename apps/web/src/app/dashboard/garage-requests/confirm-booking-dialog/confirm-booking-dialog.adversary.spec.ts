import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import {
  BookingsService,
  type ConfirmOptionsDto,
  type GarageRequestSummaryDto,
} from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
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
        canRecordNoShow: false,
        canWithdrawNoShow: false,
        confirmBy: new Date(Date.now() + 5 * HOUR + 30 * 60_000).toISOString(),
        durationMinutes: 90,
        id: 'booking-1',
        lift: null,
        mechanic: null,
        noShowAt: null,
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

const NONE: ConfirmOptionsDto = {
  liftCount: 0,
  mechanicRequired: false,
  mechanics: [],
  needsLift: false,
};
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
const neverLands = () => new Promise<ConfirmOptionsDto>(() => undefined);

// @traces 1384-FR-001
describe('the lift select opening state, attacked', () => {
  it('opens on Fără elevator with a single lift and no lift need', async () => {
    await open({ offered: { ...TEAM, liftCount: 1 } });

    expect(choices(select('Elevator'))).toEqual([
      'Fără elevator',
      'Elevator 1',
    ]);
    expect(picked('Elevator')).toBe('Fără elevator');
  });

  it('opens on the placeholder with a single lift and a lift need', async () => {
    await open({ offered: { ...TEAM, liftCount: 1, needsLift: true } });

    expect(choices(select('Elevator'))).toEqual([
      'Alege elevatorul',
      'Fără elevator',
      'Elevator 1',
    ]);
    expect(select('Elevator')?.value).toBe('');
  });

  it('lists ten lifts in order after the placeholder and Fără elevator', async () => {
    await open({ offered: { ...TEAM, liftCount: 10, needsLift: true } });

    expect(choices(select('Elevator'))).toEqual([
      'Alege elevatorul',
      'Fără elevator',
      ...Array.from({ length: 10 }, (_, i) => `Elevator ${i + 1}`),
    ]);
  });

  it('draws no lift select at zero lifts with a lift need, and still confirms', async () => {
    await open({
      offered: { ...NONE, liftCount: 0, needsLift: true },
    });

    expect(select('Elevator')).toBeNull();
    expect(text()).not.toContain('Alege elevatorul');
    await press();
    expect(confirm).toHaveBeenCalledWith({ body: {}, id: 'booking-1' });
  });

  it('puts the English placeholder first under a lift need', async () => {
    await open({
      language: 'en',
      offered: { ...TEAM, liftCount: 1, needsLift: true },
    });

    expect(choices(select('Lift'))).toEqual([
      'Choose a lift',
      'No lift',
      'Lift 1',
    ]);
  });

  it('keeps the placeholder from being offered when no lift is needed', async () => {
    await open();

    expect(text()).not.toContain('Alege elevatorul');
    expect(select('Elevator')?.required).toBe(false);
  });
});

// @traces 1384-FR-002
describe('the required lift choice, attacked', () => {
  const LIFT_JOB: ConfirmOptionsDto = { ...TEAM, needsLift: true };

  it('shows only the mechanic message when both are missing, and marks the lift valid', async () => {
    await open({ offered: LIFT_JOB });

    await press();

    expect(messageOf(select('Mecanic'))?.textContent?.trim()).toBe(
      'Alege un mecanic.',
    );
    expect(select('Elevator')?.getAttribute('aria-invalid')).not.toBe('true');
    expect(text()).not.toContain('Alege un elevator sau Fără elevator.');
    expect(confirm).not.toHaveBeenCalled();
  });

  it('asks for the lift in a garage without a team', async () => {
    await open({ offered: { ...NONE, liftCount: 2, needsLift: true } });

    await press();

    expect(confirm).not.toHaveBeenCalled();
    expect(messageOf(select('Elevator'))?.textContent?.trim()).toBe(
      'Alege un elevator sau Fără elevator.',
    );
    expect(document.activeElement).toBe(select('Elevator'));
  });

  it('keeps asking on every press until a choice is made', async () => {
    await open({ offered: LIFT_JOB });
    await choose('Mecanic', 'Ion Popescu');

    await press();
    await press();
    await press();

    expect(confirm).not.toHaveBeenCalled();
    expect(select('Elevator')?.getAttribute('aria-invalid')).toBe('true');
  });

  it('asks again after the choice is moved back to the placeholder', async () => {
    await open({ offered: LIFT_JOB });
    await choose('Mecanic', 'Ion Popescu');
    await choose('Elevator', 'Elevator 1');
    await choose('Elevator', 'Alege elevatorul');

    await press();

    expect(confirm).not.toHaveBeenCalled();
    expect(messageOf(select('Elevator'))?.textContent?.trim()).toBe(
      'Alege un elevator sau Fără elevator.',
    );
  });

  it('clears the message when any lift is picked', async () => {
    await open({ offered: LIFT_JOB });
    await choose('Mecanic', 'Ion Popescu');
    await press();

    await choose('Elevator', 'Elevator 2');

    expect(messageOf(select('Elevator'))).toBeNull();
    expect(select('Elevator')?.getAttribute('aria-invalid')).not.toBe('true');
  });

  it('does not ask when the job needs no lift and Fără elevator is the opening pick', async () => {
    await open();
    await choose('Mecanic', 'Ion Popescu');

    await press();

    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it('moves focus to the lift select in English', async () => {
    await open({ language: 'en', offered: LIFT_JOB });
    await choose('Mechanic', 'Ion Popescu');

    await press('Confirm');

    expect(document.activeElement).toBe(select('Lift'));
    expect(messageOf(select('Lift'))?.textContent?.trim()).toBe(
      'Choose a lift or No lift.',
    );
  });
});

// @traces 1384-FR-003
describe('Fără elevator sends no lift, attacked', () => {
  it('sends no lift key at all under a lift need', async () => {
    await open({ offered: { ...TEAM, needsLift: true } });
    await choose('Mecanic', 'Ion Popescu');
    await choose('Elevator', 'Fără elevator');

    await press();

    const body = confirm.mock.calls[0][0].body;
    expect(Object.keys(body)).toEqual(['mechanicId']);
  });

  it('sends no lift after a lift was picked and then Fără elevator', async () => {
    await open({ offered: { ...TEAM, needsLift: true } });
    await choose('Mecanic', 'Ion Popescu');
    await choose('Elevator', 'Elevator 2');
    await choose('Elevator', 'Fără elevator');

    await press();

    expect(confirm.mock.calls[0][0].body).toEqual({ mechanicId: 'mech-1' });
  });

  it('sends an empty body in a garage without a team under a lift need', async () => {
    await open({ offered: { ...NONE, liftCount: 2, needsLift: true } });
    await choose('Elevator', 'Fără elevator');

    await press();

    expect(confirm).toHaveBeenCalledWith({ body: {}, id: 'booking-1' });
    await expect(result).resolves.toBe('confirmed');
  });

  it('sends lift 1, the first lift, as a number', async () => {
    await open();
    await choose('Mecanic', 'Ion Popescu');
    await choose('Elevator', 'Elevator 1');

    await press();

    expect(confirm.mock.calls[0][0].body).toEqual({
      lift: 1,
      mechanicId: 'mech-1',
    });
  });
});

// @traces 1384-FR-004
describe('a slot taken, the press and the re-read, attacked', () => {
  async function refuse() {
    await choose('Mecanic', 'Maria Ionescu');
    await choose('Elevator', 'Elevator 2');
    confirm.mockRejectedValueOnce(taken());
    await press();
  }

  it('reads the options exactly once more per refusal', async () => {
    await open();
    await refuse();

    expect(options).toHaveBeenCalledTimes(2);
    expect(options).toHaveBeenLastCalledWith({ id: 'booking-1' });
  });

  it('survives a second slot_taken in a row, reading a third time', async () => {
    await open();
    await refuse();
    confirm.mockRejectedValueOnce(taken());

    await press();

    expect(confirm).toHaveBeenCalledTimes(2);
    expect(options).toHaveBeenCalledTimes(3);
    expect(top()).toBe('Locul tocmai a fost ocupat');
    expect(picked('Mecanic')).toBe('Maria Ionescu');
    expect(picked('Elevator')).toBe('Elevator 2');
    expect(button('Confirmă')?.disabled).toBe(false);
  });

  it('confirms on the third try after two refusals', async () => {
    await open();
    await refuse();
    confirm.mockRejectedValueOnce(taken());
    await press();

    await press();

    expect(confirm).toHaveBeenCalledTimes(3);
    expect(confirm.mock.calls[2][0].body).toEqual({
      lift: 2,
      mechanicId: 'mech-2',
    });
    await expect(result).resolves.toBe('confirmed');
  });

  it('sends nothing on repeated presses while the re-read is in flight', async () => {
    await open();
    options.mockImplementationOnce(neverLands);
    await refuse();

    await press();
    await press();
    await press();

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(options).toHaveBeenCalledTimes(2);
  });

  it('sends nothing on Enter in a select while the re-read is in flight', async () => {
    await open();
    options.mockImplementationOnce(neverLands);
    await refuse();

    panel()
      .querySelector('form')
      ?.dispatchEvent(new Event('submit', { cancelable: true }));
    await settle();

    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it('sends one confirm for two quick presses while the confirm itself is in flight', async () => {
    await open();
    await choose('Mecanic', 'Ion Popescu');
    confirm.mockImplementationOnce(() => new Promise(() => undefined));

    button('Confirmă')?.click();
    button('Confirmă')?.click();
    await settle();

    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it('does not read again after a refusal that is not slot_taken', async () => {
    await open();
    await choose('Mecanic', 'Ion Popescu');
    confirm.mockRejectedValueOnce(
      refusal(409, { code: 'lift_busy', status: 409 }),
    );

    await press();

    expect(options).toHaveBeenCalledTimes(1);
  });

  it('does not read again after a server error on the confirm', async () => {
    await open();
    await choose('Mecanic', 'Ion Popescu');
    confirm.mockRejectedValueOnce(refusal(500, { code: 'error', status: 500 }));

    await press();

    expect(options).toHaveBeenCalledTimes(1);
    expect(panel()).not.toBeNull();
  });

  it('does not close the panel on slot_taken', async () => {
    await open();
    await refuse();

    let settled = false;
    result.then(() => {
      settled = true;
    });
    await settle();

    expect(settled).toBe(false);
  });

  it('shows the message at the top, above the booking summary', async () => {
    await open();
    await refuse();

    expect(text().indexOf('Locul tocmai a fost ocupat')).toBeLessThan(
      text().indexOf('Irina S.'),
    );
  });

  it('does not duplicate the top message after two refusals', async () => {
    await open();
    await refuse();
    confirm.mockRejectedValueOnce(taken());
    await press();

    expect(panel().querySelectorAll('p.problem[role="alert"]').length).toBe(1);
  });
});

// @traces 1384-FR-005
describe('the re-read changes the shape, attacked', () => {
  async function refuse(opening: ConfirmOptionsDto, reread: ConfirmOptionsDto) {
    await open({ offered: opening });
    options.mockResolvedValueOnce(reread);
    if (select('Mecanic')) await choose('Mecanic', 'Maria Ionescu');
    if (select('Elevator')) await choose('Elevator', 'Elevator 2');
    confirm.mockRejectedValueOnce(taken());
    await press();
  }

  it('keeps a lift equal to the new liftCount', async () => {
    await refuse(TEAM, { ...TEAM, liftCount: 2 });

    expect(picked('Elevator')).toBe('Elevator 2');
  });

  it('clears a lift one above the new liftCount to Fără elevator without a lift need', async () => {
    await refuse(TEAM, { ...TEAM, liftCount: 1 });

    expect(picked('Elevator')).toBe('Fără elevator');
    await press();
    expect(confirm.mock.calls[1][0].body).toEqual({ mechanicId: 'mech-2' });
  });

  it('drops the lift select when liftCount falls to 0 and sends no lift', async () => {
    await refuse(TEAM, { ...TEAM, liftCount: 0 });

    expect(select('Elevator')).toBeNull();
    expect(picked('Mecanic')).toBe('Maria Ionescu');
    await press();
    expect(confirm.mock.calls[1][0].body).toEqual({ mechanicId: 'mech-2' });
  });

  it('brings the lift select back when liftCount rises from 0', async () => {
    await refuse({ ...TEAM, liftCount: 0 }, { ...TEAM, liftCount: 2 });

    expect(choices(select('Elevator'))).toEqual([
      'Fără elevator',
      'Elevator 1',
      'Elevator 2',
    ]);
    expect(picked('Elevator')).toBe('Fără elevator');
  });

  it('drops the mechanic select when no team is required any more and sends no mechanic', async () => {
    await refuse(TEAM, { ...TEAM, mechanicRequired: false, mechanics: [] });

    expect(select('Mecanic')).toBeNull();
    expect(picked('Elevator')).toBe('Elevator 2');
    await press();
    expect(confirm.mock.calls[1][0].body).toEqual({ lift: 2 });
  });

  it('sends an empty body when both selects vanish', async () => {
    await refuse(TEAM, NONE);

    expect(panel().querySelector('select')).toBeNull();
    await press();
    expect(confirm.mock.calls[1][0].body).toEqual({});
  });

  it('keeps a kept lift when needsLift flips to true', async () => {
    await refuse(TEAM, { ...TEAM, needsLift: true });

    expect(picked('Elevator')).toBe('Elevator 2');
    expect(choices(select('Elevator'))[0]).toBe('Alege elevatorul');
  });

  it('keeps an explicit Fără elevator when needsLift flips to true', async () => {
    await open();
    options.mockResolvedValueOnce({ ...TEAM, needsLift: true });
    await choose('Mecanic', 'Maria Ionescu');
    await choose('Elevator', 'Fără elevator');
    confirm.mockRejectedValueOnce(taken());
    await press();

    expect(picked('Elevator')).toBe('Fără elevator');
    await press();
    expect(confirm.mock.calls[1][0].body).toEqual({ mechanicId: 'mech-2' });
  });

  it('keeps the placeholder when needsLift stays true and no lift was picked', async () => {
    await open({ offered: { ...TEAM, needsLift: true } });
    options.mockResolvedValueOnce({ ...TEAM, needsLift: true });
    await choose('Mecanic', 'Maria Ionescu');
    await choose('Elevator', 'Fără elevator');
    await choose('Elevator', 'Alege elevatorul');
    confirm.mockRejectedValueOnce(taken());
    await press();

    expect(confirm).not.toHaveBeenCalled();
  });

  it('falls back to the placeholder for a cleared lift when needsLift is true after the re-read', async () => {
    await refuse(TEAM, { ...TEAM, liftCount: 1, needsLift: true });

    expect(picked('Elevator')).toBe('Alege elevatorul');
    await press();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(messageOf(select('Elevator'))?.textContent?.trim()).toBe(
      'Alege un elevator sau Fără elevator.',
    );
  });

  it('asks for the mechanic again when the picked one is gone', async () => {
    await refuse(TEAM, {
      ...TEAM,
      mechanics: [{ id: 'mech-1', name: 'Ion Popescu' }],
    });

    await press();

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(messageOf(select('Mecanic'))?.textContent?.trim()).toBe(
      'Alege un mecanic.',
    );
  });

  it('keeps a mechanic whose name changed under the same id', async () => {
    await refuse(TEAM, {
      ...TEAM,
      mechanics: [
        { id: 'mech-2', name: 'Maria Popa' },
        { id: 'mech-1', name: 'Ion Popescu' },
      ],
    });

    expect(picked('Mecanic')).toBe('Maria Popa');
    await press();
    expect(confirm.mock.calls[1][0].body.mechanicId).toBe('mech-2');
  });

  it('shows the add-a-mechanic hint and keeps Confirm off when the team is emptied', async () => {
    await refuse(TEAM, { ...TEAM, mechanics: [] });

    expect(picked('Mecanic')).toBe('Alege mecanicul');
    expect(messageOf(select('Mecanic'))?.textContent).toContain(
      'Adaugă mai întâi un mecanic în echipă.',
    );
    expect(button('Confirmă')?.disabled).toBe(true);
  });

  it('keeps the mechanic when only the lifts change', async () => {
    await refuse(TEAM, { ...TEAM, liftCount: 5 });

    expect(picked('Mecanic')).toBe('Maria Ionescu');
    expect(choices(select('Elevator')).length).toBe(6);
  });

  it('clears the lift but sends the kept mechanic when the lift goes and needsLift is true', async () => {
    await refuse(
      { ...TEAM, needsLift: true },
      { ...TEAM, liftCount: 1, needsLift: true },
    );

    expect(picked('Mecanic')).toBe('Maria Ionescu');
    expect(select('Elevator')?.value).toBe('');
  });
});

// @traces 1384-FR-004 1384-FR-005
describe('a failed re-read, attacked', () => {
  async function refuseWith(failure: unknown) {
    await open();
    options.mockRejectedValueOnce(failure);
    await choose('Mecanic', 'Maria Ionescu');
    await choose('Elevator', 'Elevator 2');
    confirm.mockRejectedValueOnce(taken());
    await press();
  }

  it('re-enables the form and sends the old picks when pressed again', async () => {
    await refuseWith(refusal(500, { code: 'error', status: 500 }));

    expect(select('Mecanic')?.disabled).toBe(false);
    expect(select('Elevator')?.disabled).toBe(false);
    await press();

    expect(confirm).toHaveBeenCalledTimes(2);
    expect(confirm.mock.calls[1][0].body).toEqual({
      lift: 2,
      mechanicId: 'mech-2',
    });
  });

  it('survives a plain Error, not an HTTP response', async () => {
    await refuseWith(new Error('boom'));

    expect(picked('Mecanic')).toBe('Maria Ionescu');
    expect(button('Confirmă')?.disabled).toBe(false);
    expect(panel()).not.toBeNull();
  });

  it('survives a network failure with status 0', async () => {
    await refuseWith(new HttpErrorResponse({ status: 0 }));

    expect(picked('Elevator')).toBe('Elevator 2');
    expect(button('Confirmă')?.disabled).toBe(false);
  });

  it('survives a rejection with null', async () => {
    await refuseWith(null);

    expect(picked('Elevator')).toBe('Elevator 2');
    expect(button('Confirmă')?.disabled).toBe(false);
  });

  it('does not keep showing the slot message as if all were well after the failure', async () => {
    await refuseWith(refusal(500, { code: 'error', status: 500 }));

    expect(top()).not.toBe('Locul tocmai a fost ocupat');
    expect(top()).not.toBe('');
    expect(top()).not.toBeUndefined();
  });

  it('can still be refused again and re-read after the failed re-read', async () => {
    await refuseWith(refusal(500, { code: 'error', status: 500 }));
    confirm.mockRejectedValueOnce(taken());

    await press();

    expect(options).toHaveBeenCalledTimes(3);
    expect(top()).toBe('Locul tocmai a fost ocupat');
  });

  it('says the slot message in English and keeps the form usable after a failed re-read', async () => {
    await open({ language: 'en' });
    options.mockRejectedValueOnce(refusal(500, { code: 'error', status: 500 }));
    await choose('Mechanic', 'Ion Popescu');
    confirm.mockRejectedValueOnce(
      refusal(409, {
        code: 'slot_taken',
        detail: 'The slot was just taken',
        status: 409,
      }),
    );

    await press('Confirm');

    expect(button('Confirm')?.disabled).toBe(false);
    expect(picked('Mechanic')).toBe('Ion Popescu');
  });
});
