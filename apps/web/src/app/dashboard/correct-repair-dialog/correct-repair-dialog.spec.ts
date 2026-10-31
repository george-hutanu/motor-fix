import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CarsService, type ClientRepairDto } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { type OverlayResult, Overlays } from '@motor-fix/overlays';

import {
  type CorrectRepairData,
  CorrectRepairDialog,
  type CorrectRepairResult,
} from './correct-repair-dialog';

const repair = (over: Partial<ClientRepairDto> = {}): ClientRepairDto => ({
  car: { brandName: 'VW', model: 'Golf', year: 2015 },
  correctedAt: null,
  costBani: 45_000,
  doneOn: '2025-03-12',
  driver: { shortName: 'Andrei M.' },
  id: 'repair-1',
  odometerKm: 141_300,
  version: '2026-10-30T08:00:00.000Z',
  what: 'Schimb ulei și filtre',
  ...over,
});

@Component({
  template: '<button type="button" id="opener">Corectează</button>',
})
class Host {
  readonly overlays = inject(Overlays);
}

let correct: jest.Mock;
let refresh: jest.Mock;
let result: Promise<OverlayResult<CorrectRepairResult>>;

async function settle() {
  for (let i = 0; i < 6; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

async function open(
  item: ClientRepairDto = repair(),
  language: 'ro' | 'en' = 'ro',
) {
  correct = jest.fn(async ({ body }) =>
    repair({ ...body, correctedAt: '2026-10-30T09:00:00.000Z', version: 'v2' }),
  );
  refresh = jest.fn(async () => undefined);
  TestBed.configureTestingModule({
    providers: [
      {
        provide: CarsService,
        useValue: { clientRepairsControllerCorrect: correct },
      },
    ],
  });
  const i18n = TestBed.inject(I18n);
  await i18n.enter('garage');
  if (language === 'en') await i18n.use('en');
  const host = TestBed.createComponent(Host);
  host.detectChanges();
  document.body.appendChild(host.nativeElement);
  result = host.componentInstance.overlays.open<
    CorrectRepairResult,
    CorrectRepairData
  >(CorrectRepairDialog, {
    confirmDiscard: false,
    data: { item, refresh },
    shape: 'dialog',
    title: 'garage.clientRepairs.correct.title',
  });
  await settle();
}

const panel = () =>
  document.querySelector<HTMLElement>('mf-overlay-panel') as HTMLElement;
const text = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
const field = (name: string) =>
  panel().querySelector<HTMLInputElement>(`[name="${name}"]`);
const errorOf = (name: string) =>
  text(panel().querySelector(`#correct-repair-${name}-error`));
const button = (name: string) =>
  [...panel().querySelectorAll('button')].find((b) => text(b) === name) as
    | HTMLButtonElement
    | undefined;
const still = async () =>
  Promise.race([result, new Promise((r) => setTimeout(() => r('open'), 20))]);
const status = (code: number, body?: unknown) =>
  new HttpErrorResponse({
    error: body,
    status: code,
    statusText: String(code),
  });

async function typeInto(name: string, value: string) {
  const input = field(name);
  if (!input) throw new Error(`no ${name}`);
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('blur', { bubbles: true }));
  await settle();
}

async function save() {
  button('Salvează')?.click();
  await settle();
}

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
    // 30 Oct 2026, 23:30 in Bucharest: still the 30th there.
    now: new Date('2026-10-30T21:30:00Z'),
  });
});

afterEach(() => {
  jest.useRealTimers();
  document.querySelectorAll('.cdk-overlay-container').forEach((n) => {
    n.innerHTML = '';
  });
  TestBed.resetTestingModule();
});

// @traces 1400-FR-004
describe('Corectează reparația, the dialog', () => {
  it('shows the car and the client read-only and the four fields as the row reads', async () => {
    await open();

    expect(text(panel().querySelector('h2'))).toBe('Corectează reparația');
    expect(text(panel().querySelector('[data-subject]'))).toBe(
      'VW Golf 2015 · client Andrei M.',
    );
    expect(field('what')?.value).toBe('Schimb ulei și filtre');
    expect(field('doneOn')?.value).toBe('2025-03-12');
    expect(field('odometerKm')?.value).toBe('141300');
    expect(field('costBani')?.value).toBe('450');
  });

  it('caps the date at today in Romania', async () => {
    await open();

    expect(field('doneOn')?.getAttribute('max')).toBe('2026-10-30');
  });

  it('leaves the amount empty for a repair without one', async () => {
    await open(repair({ costBani: null }));

    expect(field('costBani')?.value).toBe('');
  });

  it('writes a decimal amount with a comma in Romanian', async () => {
    await open(repair({ costBani: 45_050 }));

    expect(field('costBani')?.value).toBe('450,50');
  });

  it('offers Salvează and Renunță, and no delete', async () => {
    await open();

    expect(button('Salvează')?.type).toBe('submit');
    expect(button('Renunță')?.type).toBe('button');
    expect(text(panel())).not.toMatch(/Șterge|Delete/);
  });

  it('reads in English', async () => {
    await open(repair(), 'en');

    expect(text(panel().querySelector('h2'))).toBe('Correct the repair');
    expect(text(panel().querySelector('[data-subject]'))).toBe(
      'VW Golf 2015 · client Andrei M.',
    );
    expect(button('Save')).toBeDefined();
    expect(button('Cancel')).toBeDefined();
    expect(field('costBani')?.value).toBe('450');
  });

  it('closes with "cancelled" on Renunță and sends nothing', async () => {
    await open();

    button('Renunță')?.click();
    await settle();

    await expect(result).resolves.toBe('cancelled');
    expect(correct).not.toHaveBeenCalled();
  });
});

// @traces 1400-FR-006 1400-FR-009
describe('Corectează reparația, what Salvează sends', () => {
  it('sends only the odometer with the version it loaded, and closes with the saved repair', async () => {
    await open();
    await typeInto('odometerKm', '141500');

    await save();

    expect(correct).toHaveBeenCalledTimes(1);
    expect(correct).toHaveBeenCalledWith({
      body: { odometerKm: 141_500, version: '2026-10-30T08:00:00.000Z' },
      id: 'repair-1',
    });
    await expect(result).resolves.toMatchObject({
      correctedAt: '2026-10-30T09:00:00.000Z',
      odometerKm: 141_500,
    });
  });

  it('compares after normalising: a trimmed what, a reformatted amount and a leading zero change nothing', async () => {
    await open();
    await typeInto('what', '  Schimb ulei și filtre  ');
    await typeInto('costBani', '450,00');
    await typeInto('odometerKm', '0141300');

    await save();

    expect(correct).not.toHaveBeenCalled();
    await expect(result).resolves.toBe('cancelled');
  });

  it('closes and sends nothing when nothing changed', async () => {
    await open();

    await save();

    expect(correct).not.toHaveBeenCalled();
    await expect(result).resolves.toBe('cancelled');
  });

  it('sends the trimmed what, the day and the amount in bani', async () => {
    await open();
    await typeInto('what', '  Schimb ulei, filtre și plăcuțe ');
    await typeInto('doneOn', '2025-03-14');
    await typeInto('costBani', '612,5');

    await save();

    expect(correct).toHaveBeenCalledWith({
      body: {
        costBani: 61_250,
        doneOn: '2025-03-14',
        version: '2026-10-30T08:00:00.000Z',
        what: 'Schimb ulei, filtre și plăcuțe',
      },
      id: 'repair-1',
    });
  });

  it('takes an amount with a dot as well as a comma', async () => {
    await open();
    await typeInto('costBani', '612.75');

    await save();

    expect(correct.mock.calls[0][0].body).toEqual({
      costBani: 61_275,
      version: '2026-10-30T08:00:00.000Z',
    });
  });

  it('clears the amount with null', async () => {
    await open();
    await typeInto('costBani', '');

    await save();

    expect(correct.mock.calls[0][0].body).toEqual({
      costBani: null,
      version: '2026-10-30T08:00:00.000Z',
    });
  });

  it('sends an amount to a repair that had none', async () => {
    await open(repair({ costBani: null }));
    await typeInto('costBani', '300');

    await save();

    expect(correct.mock.calls[0][0].body).toEqual({
      costBani: 30_000,
      version: '2026-10-30T08:00:00.000Z',
    });
  });

  it('sends once while the first save is on its way', async () => {
    await open();
    correct.mockImplementationOnce(() => new Promise(() => {}));
    await typeInto('odometerKm', '141500');

    button('Salvează')?.click();
    button('Salvează')?.click();
    await settle();

    expect(correct).toHaveBeenCalledTimes(1);
  });
});

// @traces 1400-FR-005
describe('Corectează reparația, the checks before sending', () => {
  it('refuses a date after today in Romania at the field, and sends nothing', async () => {
    await open();
    await typeInto('doneOn', '2026-10-31');

    await save();

    expect(errorOf('doneOn')).toBe('Data nu poate fi în viitor');
    expect(correct).not.toHaveBeenCalled();
    expect(await still()).toBe('open');
  });

  it('takes today in Romania', async () => {
    await open();
    await typeInto('doneOn', '2026-10-30');

    await save();

    expect(correct.mock.calls[0][0].body.doneOn).toBe('2026-10-30');
  });

  it.each([
    ['an empty what', 'what', '   ', 'Între 1 și 200 de caractere'],
    [
      'a what over 200 characters',
      'what',
      'a'.repeat(201),
      'Între 1 și 200 de caractere',
    ],
    ['an empty date', 'doneOn', '', 'Alege data reparației'],
    [
      'an empty odometer',
      'odometerKm',
      '',
      'Un număr întreg între 0 și 2.000.000 km',
    ],
    [
      'an odometer over 2 000 000 km',
      'odometerKm',
      '2000001',
      'Un număr întreg între 0 și 2.000.000 km',
    ],
    [
      'an odometer with decimals',
      'odometerKm',
      '141300,5',
      'Un număr întreg între 0 și 2.000.000 km',
    ],
    [
      'an odometer with letters',
      'odometerKm',
      '141 km',
      'Un număr întreg între 0 și 2.000.000 km',
    ],
    [
      'an amount over 920 000 lei',
      'costBani',
      '920000,01',
      'Cel mult 920.000 lei',
    ],
    [
      'an amount with three decimals',
      'costBani',
      '450,505',
      'Cel mult două zecimale',
    ],
    [
      'a negative amount',
      'costBani',
      '-5',
      'O sumă în lei, de exemplu 450 sau 450,50',
    ],
    [
      'an amount with letters',
      'costBani',
      '450 lei',
      'O sumă în lei, de exemplu 450 sau 450,50',
    ],
  ])('refuses %s at the field', async (_, name, value, message) => {
    await open();
    await typeInto(name, value);

    await save();

    expect(errorOf(name)).toBe(message);
    expect(correct).not.toHaveBeenCalled();
    expect(await still()).toBe('open');
  });

  it('takes the limits themselves', async () => {
    await open();
    await typeInto('what', 'a'.repeat(200));
    await typeInto('odometerKm', '2000000');
    await typeInto('costBani', '920000');

    await save();

    expect(correct.mock.calls[0][0].body).toEqual({
      costBani: 92_000_000,
      odometerKm: 2_000_000,
      version: '2026-10-30T08:00:00.000Z',
      what: 'a'.repeat(200),
    });
  });

  it('takes a zero amount and a zero odometer', async () => {
    await open(repair({ odometerKm: null }));
    await typeInto('odometerKm', '0');
    await typeInto('costBani', '0');

    await save();

    expect(correct.mock.calls[0][0].body).toEqual({
      costBani: 0,
      odometerKm: 0,
      version: '2026-10-30T08:00:00.000Z',
    });
  });
});

// @traces 1400-FR-005
describe('Corectează reparația, a lower odometer', () => {
  it('asks to check an odometer below the one loaded, then sends it on the next Salvează', async () => {
    await open();
    await typeInto('odometerKm', '14130');

    await save();

    expect(correct).not.toHaveBeenCalled();
    expect(text(panel().querySelector('[data-lower]'))).toBe(
      'Kilometrajul e mai mic decât cel înregistrat (141.300 km). Verifică și apasă din nou Salvează.',
    );
    expect(
      panel().querySelector('[data-lower]')?.getAttribute('aria-live'),
    ).toBe('polite');

    await save();

    expect(correct).toHaveBeenCalledTimes(1);
    expect(correct.mock.calls[0][0].body).toEqual({
      odometerKm: 14_130,
      version: '2026-10-30T08:00:00.000Z',
    });
  });

  it('asks again for another lower value typed after confirming', async () => {
    await open();
    await typeInto('odometerKm', '14130');
    await save();
    await typeInto('odometerKm', '14100');

    await save();

    expect(correct).not.toHaveBeenCalled();
    expect(panel().querySelector('[data-lower]')).not.toBeNull();
  });

  it('asks nothing of an odometer above the one loaded, or of a repair that had none', async () => {
    await open(repair({ odometerKm: null }));
    await typeInto('odometerKm', '10');

    await save();

    // Sent on the first press: nothing was asked.
    expect(correct).toHaveBeenCalledTimes(1);
    await expect(result).resolves.toMatchObject({ odometerKm: 10 });
  });
});

// @traces 1400-FR-007
describe('Corectează reparația, saved meanwhile', () => {
  const stale = () =>
    status(409, {
      code: 'stale_version',
      detail: 'The repair changed meanwhile',
      status: 409,
    });

  it('says so, reloads all four fields and the version, and stays open', async () => {
    await open();
    correct.mockRejectedValueOnce(stale());
    refresh.mockResolvedValueOnce(
      repair({
        costBani: 50_000,
        doneOn: '2025-03-13',
        odometerKm: 141_400,
        version: '2026-10-30T09:30:00.000Z',
        what: 'Schimb ulei',
      }),
    );
    await typeInto('odometerKm', '141500');
    await typeInto('what', 'Ce a scris Ion');

    await save();

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(text(panel().querySelector('[data-stale]'))).toBe(
      'Reparația a fost modificată între timp. Am reîncărcat valorile.',
    );
    expect(field('what')?.value).toBe('Schimb ulei');
    expect(field('doneOn')?.value).toBe('2025-03-13');
    expect(field('odometerKm')?.value).toBe('141400');
    expect(field('costBani')?.value).toBe('500');
    expect(await still()).toBe('open');
  });

  it('saves the re-entered value with the new version', async () => {
    await open();
    correct.mockRejectedValueOnce(stale());
    refresh.mockResolvedValueOnce(
      repair({ odometerKm: 141_400, version: '2026-10-30T09:30:00.000Z' }),
    );
    await typeInto('odometerKm', '141500');
    await save();

    await typeInto('odometerKm', '141500');
    await save();

    expect(correct).toHaveBeenCalledTimes(2);
    expect(correct.mock.calls[1][0].body).toEqual({
      odometerKm: 141_500,
      version: '2026-10-30T09:30:00.000Z',
    });
  });

  it('compares with the reloaded odometer for the lower-reading check', async () => {
    await open();
    correct.mockRejectedValueOnce(stale());
    refresh.mockResolvedValueOnce(
      repair({ odometerKm: 150_000, version: '2026-10-30T09:30:00.000Z' }),
    );
    await typeInto('odometerKm', '141500');
    await save();

    await typeInto('odometerKm', '149000');
    await save();

    expect(correct).toHaveBeenCalledTimes(1);
    expect(text(panel().querySelector('[data-lower]'))).toContain('150.000 km');
  });

  it('clears a confirmed lower reading on a reload', async () => {
    await open();
    await typeInto('odometerKm', '14130');
    await save();
    correct.mockRejectedValueOnce(stale());
    refresh.mockResolvedValueOnce(
      repair({ version: '2026-10-30T09:30:00.000Z' }),
    );
    await save();

    await typeInto('odometerKm', '14130');
    await save();

    expect(correct).toHaveBeenCalledTimes(1);
    expect(panel().querySelector('[data-lower]')).not.toBeNull();
  });

  it('closes as unshared when the re-read no longer holds the repair', async () => {
    await open();
    correct.mockRejectedValueOnce(stale());
    refresh.mockResolvedValueOnce(undefined);
    await typeInto('odometerKm', '141500');

    await save();

    await expect(result).resolves.toBe('unshared');
  });
});

// @traces 1400-FR-008
describe('Corectează reparația, the other refusals', () => {
  it('closes as unshared on 404', async () => {
    await open();
    correct.mockRejectedValueOnce(
      status(404, { code: 'not_found', status: 404 }),
    );
    await typeInto('odometerKm', '141500');

    await save();

    await expect(result).resolves.toBe('unshared');
  });

  it('shows a 400 naming a field at that field and stays open', async () => {
    await open();
    correct.mockRejectedValueOnce(
      status(400, {
        code: 'validation_failed',
        errors: [{ code: 'futureDay', field: 'doneOn' }],
        status: 400,
      }),
    );
    await typeInto('doneOn', '2025-03-14');

    await save();

    expect(errorOf('doneOn')).toBe('Data nu poate fi în viitor');
    expect(await still()).toBe('open');
  });

  it('shows the shared could-not-save problem on any other failure and stays open', async () => {
    await open();
    correct.mockRejectedValueOnce(status(500, { code: 'error', status: 500 }));
    await typeInto('odometerKm', '141500');

    await save();

    expect(text(panel().querySelector('[data-problem]'))).not.toBe('');
    expect(panel().querySelector('[data-stale]')).toBeNull();
    expect(await still()).toBe('open');
  });

  it('sends again after a failure when Salvează is pressed', async () => {
    await open();
    correct.mockRejectedValueOnce(status(500, { code: 'error', status: 500 }));
    await typeInto('odometerKm', '141500');
    await save();

    await save();

    expect(correct).toHaveBeenCalledTimes(2);
    await expect(result).resolves.toMatchObject({ odometerKm: 141_500 });
  });
});
