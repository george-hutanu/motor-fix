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
  now?: string,
) {
  if (now) {
    jest.useRealTimers();
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
      now: new Date(now),
    });
  }
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
  (button('Salvează') ?? button('Save'))?.click();
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

const stale = () =>
  status(409, { code: 'stale_version', detail: 'x', status: 409 });

// @traces 1400-FR-005
describe('Corectează reparația, adversarial limits', () => {
  it('takes the next Romanian day when it is already past midnight there', async () => {
    await open(repair(), 'ro', '2026-10-30T22:30:00Z');
    await typeInto('doneOn', '2026-10-31');
    expect(field('doneOn')?.getAttribute('max')).toBe('2026-10-31');

    await save();

    expect(correct).toHaveBeenCalledTimes(1);
  });

  it('uses the summer offset for today in Romania', async () => {
    await open(repair(), 'ro', '2026-07-15T21:30:00Z');
    await typeInto('doneOn', '2026-07-16');
    expect(field('doneOn')?.getAttribute('max')).toBe('2026-07-16');

    await save();

    expect(correct).toHaveBeenCalledTimes(1);
  });

  it('refuses the day after the summer Romanian today', async () => {
    await open(repair(), 'ro', '2026-07-15T20:30:00Z');
    await typeInto('doneOn', '2026-07-16');

    await save();

    expect(errorOf('doneOn')).toBe('Data nu poate fi în viitor');
    expect(correct).not.toHaveBeenCalled();
  });

  it.each([
    ['1.15', 115],
    ['0,29', 29],
    ['19.99', 1999],
    ['4.35', 435],
    ['0.07', 7],
    ['920000,00', 92_000_000],
  ])(
    'turns the amount %s into %i bani without float drift',
    async (value, bani) => {
      await open();
      await typeInto('costBani', value);

      await save();

      expect(correct.mock.calls[0][0].body.costBani).toBe(bani);
    },
  );

  it.each(['1e3', '0x10', '450,', ',5', '١٢٣', '4 50', '--5', '450,5,5'])(
    'refuses the amount %j and sends nothing',
    async (value) => {
      await open();
      await typeInto('costBani', value);

      await save();

      expect(correct).not.toHaveBeenCalled();
      expect(errorOf('costBani')).not.toBe('');
    },
  );

  it.each(['1e3', '+5', '0x10', '-1', '٣', '141300.0', '1,000'])(
    'refuses the odometer %j and sends nothing',
    async (value) => {
      await open();
      await typeInto('odometerKm', value);

      await save();

      expect(correct).not.toHaveBeenCalled();
      expect(errorOf('odometerKm')).not.toBe('');
    },
  );

  it('takes a what of 200 characters with Romanian diacritics and refuses 201', async () => {
    await open();
    await typeInto('what', 'ș'.repeat(201));
    await save();
    expect(correct).not.toHaveBeenCalled();

    await typeInto('what', 'ș'.repeat(200));
    await save();

    expect(correct.mock.calls[0][0].body.what).toBe('ș'.repeat(200));
  });

  it('refuses a what of only newlines and tabs', async () => {
    await open();
    await typeInto('what', '\n\t  ');

    await save();

    expect(errorOf('what')).toBe('Între 1 și 200 de caractere');
    expect(correct).not.toHaveBeenCalled();
  });

  it('counts a what of 200 characters plus surrounding spaces as 200', async () => {
    await open();
    await typeInto('what', ` ${'a'.repeat(200)} `);

    await save();

    expect(correct.mock.calls[0][0].body.what).toBe('a'.repeat(200));
  });

  it('refuses the odometer one past the cap and takes the cap in English too', async () => {
    await open(repair(), 'en');
    await typeInto('odometerKm', '2000001');
    await save();
    expect(errorOf('odometerKm')).toBe(
      'A whole number between 0 and 2,000,000 km',
    );
    expect(correct).not.toHaveBeenCalled();
  });

  it('refuses the amount one bani past the cap in English', async () => {
    await open(repair(), 'en');
    await typeInto('costBani', '920000.01');
    await save();
    expect(errorOf('costBani')).toBe('At most 920,000 lei');
    expect(correct).not.toHaveBeenCalled();
  });

  it('does not round three decimals that would round to the same amount', async () => {
    await open();
    await typeInto('costBani', '450,001');

    await save();

    expect(errorOf('costBani')).toBe('Cel mult două zecimale');
    expect(correct).not.toHaveBeenCalled();
  });

  it('sends a repair that had no odometer when only the what changes', async () => {
    await open(repair({ odometerKm: null }));
    await typeInto('what', 'Altceva');

    await save();

    expect(correct).toHaveBeenCalledTimes(1);
    expect(correct.mock.calls[0][0].body).toEqual({
      version: '2026-10-30T08:00:00.000Z',
      what: 'Altceva',
    });
  });

  it('closes without a request when a repair with no amount and no odometer is saved untouched', async () => {
    await open(repair({ costBani: null, odometerKm: null }));

    await save();

    expect(correct).not.toHaveBeenCalled();
    await expect(result).resolves.toBe('cancelled');
  });
});

// @traces 1400-FR-005
describe('Corectează reparația, the lower-odometer confirmation, attacked', () => {
  it('asks for an odometer of 0 against a loaded reading', async () => {
    await open();
    await typeInto('odometerKm', '0');

    await save();

    expect(correct).not.toHaveBeenCalled();
    expect(panel().querySelector('[data-lower]')).not.toBeNull();
  });

  it('never sends a lower odometer while another field stays invalid', async () => {
    await open();
    await typeInto('odometerKm', '14130');
    await typeInto('what', '');

    await save();
    await save();
    await save();

    expect(correct).not.toHaveBeenCalled();
  });

  it('asks again when the lower value is retyped after a detour', async () => {
    await open();
    await typeInto('odometerKm', '14130');
    await save();
    await typeInto('odometerKm', '150000');
    await typeInto('odometerKm', '14130');

    await save();

    expect(correct).not.toHaveBeenCalled();
    expect(panel().querySelector('[data-lower]')).not.toBeNull();
  });

  it('keeps the confirmation for the odometer when another field is edited', async () => {
    await open();
    await typeInto('odometerKm', '14130');
    await save();
    await typeInto('what', 'Altceva');

    await save();

    expect(correct).toHaveBeenCalledTimes(1);
    expect(correct.mock.calls[0][0].body).toEqual({
      odometerKm: 14_130,
      version: '2026-10-30T08:00:00.000Z',
      what: 'Altceva',
    });
  });

  it('drops the note when the odometer goes back to the loaded reading, and closes without a request', async () => {
    await open();
    await typeInto('odometerKm', '14130');
    await save();
    await typeInto('odometerKm', '141300');

    await save();

    expect(panel()?.querySelector('[data-lower]') ?? null).toBeNull();
    expect(correct).not.toHaveBeenCalled();
    await expect(result).resolves.toBe('cancelled');
  });

  it('hides the note once the odometer is raised above the loaded reading', async () => {
    await open();
    await typeInto('odometerKm', '14130');
    await save();
    await typeInto('odometerKm', '141301');

    expect(panel().querySelector('[data-lower]')).toBeNull();
  });

  it('does not ask for an odometer equal to the loaded reading changed elsewhere', async () => {
    await open();
    await typeInto('what', 'Altceva');

    await save();

    expect(correct).toHaveBeenCalledTimes(1);
  });

  it('does not treat a failed send of a confirmed lower value as a fresh confirmation', async () => {
    await open();
    correct.mockRejectedValueOnce(status(500, { code: 'error', status: 500 }));
    await typeInto('odometerKm', '14130');
    await save();
    await save();

    await save();

    expect(correct).toHaveBeenCalledTimes(2);
    expect(correct.mock.calls[1][0].body.odometerKm).toBe(14_130);
  });

  it('names the loaded reading in English with a comma separator', async () => {
    await open(repair(), 'en');
    await typeInto('odometerKm', '10');

    await save();
    expect(text(panel().querySelector('[data-lower]'))).toBe(
      'The odometer is lower than the one on record (141,300 km). Check it and press Save again.',
    );
  });
});

// @traces 1400-FR-007
describe('Corectează reparația, 409 attacked', () => {
  it('closes without a request when saved untouched right after a reload', async () => {
    await open();
    correct.mockRejectedValueOnce(stale());
    refresh.mockResolvedValueOnce(
      repair({ odometerKm: 141_400, version: 'v9' }),
    );
    await typeInto('odometerKm', '141500');
    await save();

    await save();

    expect(correct).toHaveBeenCalledTimes(1);
    await expect(result).resolves.toBe('cancelled');
  });

  it('reloads again on a second 409 and sends the newest version', async () => {
    await open();
    correct.mockRejectedValueOnce(stale()).mockRejectedValueOnce(stale());
    refresh
      .mockResolvedValueOnce(repair({ version: 'v2' }))
      .mockResolvedValueOnce(repair({ version: 'v3' }));
    await typeInto('odometerKm', '141500');
    await save();
    await typeInto('odometerKm', '141500');
    await save();
    await typeInto('odometerKm', '141500');

    await save();

    expect(refresh).toHaveBeenCalledTimes(2);
    expect(correct.mock.calls[2][0].body).toEqual({
      odometerKm: 141_500,
      version: 'v3',
    });
  });

  it('stays open and does not claim the repair is unshared when the re-read itself fails', async () => {
    await open();
    correct.mockRejectedValueOnce(stale());
    refresh.mockRejectedValueOnce(status(500, { code: 'error', status: 500 }));
    await typeInto('odometerKm', '141500');

    await save();

    expect(await still()).toBe('open');
  });

  it('clears the stale note after the next successful save attempt fails differently', async () => {
    await open();
    correct.mockRejectedValueOnce(stale());
    refresh.mockResolvedValueOnce(repair({ version: 'v2' }));
    await typeInto('odometerKm', '141500');
    await save();
    correct.mockRejectedValueOnce(status(500, { code: 'error', status: 500 }));
    await typeInto('odometerKm', '141500');

    await save();

    expect(panel().querySelector('[data-stale]')).toBeNull();
  });

  it('reloads with an English message', async () => {
    await open(repair(), 'en');
    correct.mockRejectedValueOnce(stale());
    refresh.mockResolvedValueOnce(repair({ version: 'v2' }));
    await typeInto('odometerKm', '141500');

    await save();

    expect(text(panel().querySelector('[data-stale]'))).toBe(
      'The repair changed meanwhile. We reloaded the values.',
    );
  });

  it('clears an inline field error shown before the reload', async () => {
    await open();
    await typeInto('what', '');
    await save();
    expect(errorOf('what')).not.toBe('');
    correct.mockRejectedValueOnce(stale());
    refresh.mockResolvedValueOnce(repair({ version: 'v2' }));
    await typeInto('what', 'Altceva');
    await save();

    expect(errorOf('what')).toBe('');
  });
});

// @traces 1400-FR-008
describe('Corectează reparația, 400 and 404 attacked', () => {
  it('reads a 400 naming a field the form lacks as the shared problem and stays open', async () => {
    await open();
    correct.mockRejectedValueOnce(
      status(400, {
        code: 'validation_failed',
        errors: [{ code: 'bad', field: 'version' }],
        status: 400,
      }),
    );
    await typeInto('odometerKm', '141500');

    await save();

    expect(text(panel().querySelector('[data-problem]'))).not.toBe('');
    expect(await still()).toBe('open');
  });

  it.each([
    ['no body', undefined],
    ['a string body', 'Bad Request'],
    ['null errors', { code: 'validation_failed', errors: null, status: 400 }],
    ['empty errors', { code: 'validation_failed', errors: [], status: 400 }],
    ['errors that are not a list', { errors: 'doneOn', status: 400 }],
    ['an entry without a field', { errors: [{ code: 'x' }], status: 400 }],
    ['an entry that is null', { errors: [null], status: 400 }],
  ])(
    'reads a 400 with %s as the shared problem and stays open',
    async (_, body) => {
      await open();
      correct.mockRejectedValueOnce(status(400, body));
      await typeInto('odometerKm', '141500');

      await save();

      expect(text(panel().querySelector('[data-problem]'))).not.toBe('');
      expect(await still()).toBe('open');
    },
  );

  it('shows two fields of one 400 each at its own field', async () => {
    await open();
    correct.mockRejectedValueOnce(
      status(400, {
        code: 'validation_failed',
        errors: [
          { code: 'futureDay', field: 'doneOn' },
          { code: 'odometerWithin', field: 'odometerKm' },
        ],
        status: 400,
      }),
    );
    await typeInto('odometerKm', '141500');

    await save();

    expect(errorOf('doneOn')).not.toBe('');
    expect(errorOf('odometerKm')).not.toBe('');
    expect(await still()).toBe('open');
  });

  it('lets a field be saved again after a 400 on it was fixed', async () => {
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
    await typeInto('doneOn', '2025-03-15');

    await save();

    expect(correct).toHaveBeenCalledTimes(2);
    expect(correct.mock.calls[1][0].body.doneOn).toBe('2025-03-15');
  });

  it('closes as unshared on 404 whatever the body', async () => {
    await open();
    correct.mockRejectedValueOnce(status(404, undefined));
    await typeInto('odometerKm', '141500');

    await save();

    await expect(result).resolves.toBe('unshared');
  });

  it('treats a network failure (status 0) as the shared problem and stays open', async () => {
    await open();
    correct.mockRejectedValueOnce(status(0, undefined));
    await typeInto('odometerKm', '141500');

    await save();

    expect(text(panel().querySelector('[data-problem]'))).not.toBe('');
    expect(await still()).toBe('open');
  });

  it('treats a non-HTTP throw as the shared problem and stays open', async () => {
    await open();
    correct.mockRejectedValueOnce(new TypeError('boom'));
    await typeInto('odometerKm', '141500');

    await save();

    expect(text(panel().querySelector('[data-problem]'))).not.toBe('');
    expect(await still()).toBe('open');
  });

  it('treats 403 as the shared problem, not as unshared', async () => {
    await open();
    correct.mockRejectedValueOnce(status(403, { code: 'forbidden' }));
    await typeInto('odometerKm', '141500');

    await save();

    expect(await still()).toBe('open');
  });
});
