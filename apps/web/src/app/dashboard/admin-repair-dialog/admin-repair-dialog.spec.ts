// @traces 1405-FR-002 1405-FR-003 1405-FR-004 1405-FR-005 1405-FR-007 1405-FR-008
import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { type AdminRepairDto, AdminService } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { type OverlayResult, Overlays } from '@motor-fix/overlays';

import {
  type AdminRepairData,
  AdminRepairDialog,
  type AdminRepairResult,
} from './admin-repair-dialog';

@Component({ template: '' })
class Host {
  readonly overlays = inject(Overlays);
}

const VERSION = '2026-10-30T10:00:00.000Z';

const repair = (extra: Partial<AdminRepairDto> = {}): AdminRepairDto => ({
  car: { brandName: 'Dacia', model: 'Logan', year: 2018 },
  correctedBy: null,
  costBani: 45000,
  doneOn: '2025-03-12',
  garageName: 'Garaj Nordic',
  id: 'r-1',
  odometerKm: 91300,
  version: VERSION,
  what: 'Schimb ulei și filtre',
  ...extra,
});

let correct: jest.Mock;
let reread: jest.Mock;
let saved: jest.Mock;
let result: Promise<OverlayResult<AdminRepairResult>>;

async function settle() {
  for (let i = 0; i < 6; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

async function open(
  loaded: AdminRepairDto = repair(),
  language: 'ro' | 'en' = 'ro',
) {
  correct ??= jest.fn(
    async ({ body }: { body: Partial<AdminRepairDto> }) =>
      ({
        ...loaded,
        ...body,
        correctedBy: 'admin',
        version: '2026-10-30T11:00:00.000Z',
      }) as AdminRepairDto,
  );
  reread ??= jest.fn(async () => loaded);
  saved = jest.fn();
  TestBed.configureTestingModule({
    providers: [
      {
        provide: AdminService,
        useValue: {
          adminRepairsControllerCorrect: correct,
          adminRepairsControllerOpen: reread,
        },
      },
    ],
  });
  if (language === 'en') await TestBed.inject(I18n).use('en');
  await TestBed.inject(I18n).enter('admin');
  const host = TestBed.createComponent(Host);
  result = host.componentInstance.overlays.open<
    AdminRepairResult,
    AdminRepairData
  >(AdminRepairDialog, {
    data: { repair: loaded, saved },
    shape: 'dialog',
    title: 'admin.users.dialogs.repair.title',
  });
  await settle();
}

const panel = () =>
  document.querySelector<HTMLElement>('mf-overlay-panel') as HTMLElement;
const squash = (value: string | null | undefined) =>
  (value ?? '').replace(/\s+/g, ' ').trim();
const text = () => squash(panel().textContent);

// The view's lines as "label: value".
const lines = () => {
  const dl = panel().querySelector('dl');
  if (!dl) return [];
  return [...dl.querySelectorAll('dt')].map(
    (dt) =>
      `${squash(dt.textContent)}: ${squash(dt.nextElementSibling?.textContent)}`,
  );
};

function field(label: string): HTMLInputElement {
  const found = [...panel().querySelectorAll('label')].find(
    (l) => squash(l.textContent) === label,
  );
  const input = found?.htmlFor ? document.getElementById(found.htmlFor) : null;
  if (!(input instanceof HTMLInputElement)) throw new Error(`no ${label}`);
  return input;
}

function type(input: HTMLInputElement, value: string) {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

const button = (name: string) =>
  [...panel().querySelectorAll('button')].find(
    (b) => squash(b.textContent) === name,
  ) as HTMLButtonElement | undefined;

async function press(name: string) {
  const found = button(name);
  if (!found) throw new Error(`no button ${name}`);
  found.click();
  await settle();
}

const conflict = () =>
  new HttpErrorResponse({
    error: { code: 'stale_version', status: 409 },
    status: 409,
  });

beforeEach(() => {
  correct = undefined as unknown as jest.Mock;
  reread = undefined as unknown as jest.Mock;
});

afterEach(() => {
  document.querySelectorAll('.cdk-overlay-container').forEach((n) => {
    n.innerHTML = '';
  });
  TestBed.resetTestingModule();
});

describe('the repair dialog, showing the repair', () => {
  it('is titled after the driver who added it', async () => {
    await open();

    expect(squash(panel().querySelector('h2')?.textContent)).toBe(
      'Reparație adăugată de șofer',
    );
  });

  it('shows the car, the garage, what was done, the date, the odometer and the amount', async () => {
    await open();

    expect(lines()).toEqual([
      'Mașina: Dacia Logan 2018',
      'Service: Garaj Nordic',
      'Ce s‑a făcut: Schimb ulei și filtre',
      'Data: 12 mart. 2025',
      'Kilometraj: 91.300 km',
      'Suma: 450 lei',
    ]);
  });

  it('leaves out the odometer and the amount when the driver gave none', async () => {
    await open(repair({ costBani: null, odometerKm: null }));

    expect(lines()).toEqual([
      'Mașina: Dacia Logan 2018',
      'Service: Garaj Nordic',
      'Ce s‑a făcut: Schimb ulei și filtre',
      'Data: 12 mart. 2025',
    ]);
  });

  it('says nothing of a correction when there was none', async () => {
    await open();

    expect(text()).not.toContain('Corectată');
  });

  it('says MotorFix corrected it', async () => {
    await open(repair({ correctedBy: 'admin' }));

    expect(text()).toContain('Corectată de MotorFix');
  });

  it('says the garage corrected it, by name', async () => {
    await open(repair({ correctedBy: 'garage' }));

    expect(text()).toContain('Corectată de Garaj Nordic');
  });

  it('says the opening is recorded in the history', async () => {
    await open();

    expect(text()).toContain('Deschiderea este înregistrată în istoric');
  });

  it('offers Corectează and Închide, and no delete', async () => {
    await open();

    const names = [...panel().querySelectorAll('button')].map((b) =>
      squash(b.textContent),
    );
    expect(names).toEqual(expect.arrayContaining(['Corectează', 'Închide']));
    expect(names.some((n) => n.toLowerCase().includes('șterge'))).toBe(false);
  });

  it('closes cancelled on Închide and sends nothing', async () => {
    await open();

    await press('Închide');

    await expect(result).resolves.toBe('cancelled');
    expect(correct).not.toHaveBeenCalled();
    expect(reread).not.toHaveBeenCalled();
  });

  it('speaks English', async () => {
    await open(repair({ correctedBy: 'admin' }), 'en');

    expect(squash(panel().querySelector('h2')?.textContent)).toBe(
      'Repair added by the driver',
    );
    expect(lines()).toEqual([
      'Car: Dacia Logan 2018',
      'Garage: Garaj Nordic',
      'What was done: Schimb ulei și filtre',
      'Date: 12 Mar 2025',
      'Odometer: 91,300 km',
      'Amount: 450 lei',
    ]);
    expect(text()).toContain('Corrected by MotorFix');
    expect(text()).toContain('This opening is recorded in the history');
    expect(button('Correct')).toBeDefined();
    expect(button('Close')).toBeDefined();
  });
});

describe('the repair dialog, correcting the repair', () => {
  it('turns into the form with the loaded values, the car and the garage read-only', async () => {
    await open();

    await press('Corectează');

    expect(field('Ce s‑a făcut').value).toBe('Schimb ulei și filtre');
    expect(field('Data').value).toBe('2025-03-12');
    expect(field('Data').type).toBe('date');
    expect(field('Kilometraj, în km').value).toBe('91300');
    expect(field('Suma, în lei').value).toBe('450');
    expect(text()).toContain('Dacia Logan 2018');
    expect(text()).toContain('Garaj Nordic');
    const inputs = [...panel().querySelectorAll('input')].map((i) => i.id);
    expect(inputs).toHaveLength(4);
    expect(button('Salvează')?.type).toBe('submit');
    expect(button('Renunță')).toBeDefined();
  });

  it('sends only the changed amount, in bani, with the loaded version', async () => {
    await open();
    await press('Corectează');

    type(field('Suma, în lei'), '480');
    await press('Salvează');

    expect(correct).toHaveBeenCalledTimes(1);
    expect(correct).toHaveBeenCalledWith({
      body: { costBani: 48000, version: VERSION },
      id: 'r-1',
    });
  });

  it('sends lei with decimals as whole bani', async () => {
    await open();
    await press('Corectează');

    type(field('Suma, în lei'), '480.5');
    await press('Salvează');

    expect(correct.mock.calls[0][0].body).toEqual({
      costBani: 48050,
      version: VERSION,
    });
  });

  it('sends a cleared amount as null', async () => {
    await open();
    await press('Corectează');

    type(field('Suma, în lei'), '');
    await press('Salvează');

    expect(correct.mock.calls[0][0].body).toEqual({
      costBani: null,
      version: VERSION,
    });
  });

  it('sends each changed field, trimmed, and nothing unchanged', async () => {
    await open();
    await press('Corectează');

    type(field('Ce s‑a făcut'), '  Schimb ulei  ');
    type(field('Data'), '2025-03-11');
    type(field('Kilometraj, în km'), '91000');
    await press('Salvează');

    expect(correct.mock.calls[0][0].body).toEqual({
      doneOn: '2025-03-11',
      odometerKm: 91000,
      version: VERSION,
      what: 'Schimb ulei',
    });
  });

  it('sends the version alone when nothing changed', async () => {
    await open();
    await press('Corectează');

    await press('Salvează');

    expect(correct.mock.calls[0][0].body).toEqual({ version: VERSION });
  });

  it('shows the corrected values after the save and tells the opener', async () => {
    await open();
    await press('Corectează');

    type(field('Suma, în lei'), '480');
    await press('Salvează');

    expect(lines()).toContain('Suma: 480 lei');
    expect(text()).toContain('Corectată de MotorFix');
    expect(button('Corectează')).toBeDefined();
    expect(saved).toHaveBeenCalledWith(
      expect.objectContaining({ correctedBy: 'admin', costBani: 48000 }),
    );
  });

  it('sends the new version on the next correction', async () => {
    await open();
    await press('Corectează');
    type(field('Suma, în lei'), '480');
    await press('Salvează');

    await press('Corectează');
    type(field('Suma, în lei'), '490');
    await press('Salvează');

    expect(correct.mock.calls[1][0].body).toEqual({
      costBani: 49000,
      version: '2026-10-30T11:00:00.000Z',
    });
  });

  it('disables Salvează and shows progress while the save is on its way', async () => {
    let answer: (value: AdminRepairDto) => void = () => undefined;
    correct = jest.fn(
      () =>
        new Promise<AdminRepairDto>((resolve) => {
          answer = resolve;
        }),
    );
    await open();
    await press('Corectează');
    type(field('Suma, în lei'), '480');

    button('Salvează')?.click();
    await settle();

    const save = panel().querySelector<HTMLButtonElement>(
      'button[type="submit"]',
    );
    expect(save?.getAttribute('aria-busy')).toBe('true');
    expect(save?.getAttribute('aria-disabled')).toBe('true');
    answer(repair({ correctedBy: 'admin', costBani: 48000 }));
    await settle();
    expect(lines()).toContain('Suma: 480 lei');
  });

  it('goes back to the repair, unchanged, on Renunță', async () => {
    await open();
    await press('Corectează');
    type(field('Suma, în lei'), '480');

    await press('Renunță');

    expect(correct).not.toHaveBeenCalled();
    expect(lines()).toContain('Suma: 450 lei');
    expect(button('Corectează')).toBeDefined();
  });

  it.each([
    ['what was done left empty', 'Ce s‑a făcut', '   ', 'Scrie ce s‑a făcut'],
    [
      'what was done over 200 characters',
      'Ce s‑a făcut',
      'a'.repeat(201),
      'Scrie ce s‑a făcut',
    ],
    ['a date after today', 'Data', '2999-01-01', 'Alege o zi până azi'],
    ['a date left empty', 'Data', '', 'Alege o zi până azi'],
    [
      'an odometer over 2 000 000',
      'Kilometraj, în km',
      '2000001',
      'Un număr întreg',
    ],
    ['a negative odometer', 'Kilometraj, în km', '-1', 'Un număr întreg'],
    ['a fractional odometer', 'Kilometraj, în km', '1.5', 'Un număr întreg'],
    ['a cleared odometer', 'Kilometraj, în km', '', 'Un număr întreg'],
    ['an amount over 920 000 lei', 'Suma, în lei', '920000.01', 'O sumă'],
    ['a negative amount', 'Suma, în lei', '-1', 'O sumă'],
    ['an amount with three decimals', 'Suma, în lei', '1.005', 'O sumă'],
  ])(
    'refuses %s at the field before sending',
    async (_, label, value, said) => {
      await open();
      await press('Corectează');

      type(field(label), value);
      await press('Salvează');

      expect(correct).not.toHaveBeenCalled();
      const input = field(label);
      const described = (input.getAttribute('aria-describedby') ?? '')
        .split(' ')
        .map((id) => squash(document.getElementById(id)?.textContent))
        .join(' ');
      expect(described).toContain(said);
    },
  );

  it.each([
    ['200 characters of what was done', 'Ce s‑a făcut', 'a'.repeat(200)],
    [
      'today',
      'Data',
      new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Bucharest' }).format(
        new Date(),
      ),
    ],
    ['an odometer of 2 000 000', 'Kilometraj, în km', '2000000'],
    ['an odometer of 0', 'Kilometraj, în km', '0'],
    ['an amount of 920 000 lei', 'Suma, în lei', '920000'],
    ['an amount of 0', 'Suma, în lei', '0'],
  ])('accepts %s', async (_, label, value) => {
    await open();
    await press('Corectează');

    type(field(label), value);
    await press('Salvează');

    expect(correct).toHaveBeenCalledTimes(1);
  });

  it('accepts an odometer left empty when the driver gave none', async () => {
    await open(repair({ odometerKm: null }));
    await press('Corectează');

    await press('Salvează');

    expect(correct.mock.calls[0][0].body).toEqual({ version: VERSION });
  });

  it("shows a field's 400 at that field and keeps the values", async () => {
    correct = jest.fn(async () => {
      throw new HttpErrorResponse({
        error: {
          code: 'validation_failed',
          errors: [{ code: 'odometerKm', field: 'odometerKm' }],
          status: 400,
        },
        status: 400,
      });
    });
    await open();
    await press('Corectează');
    type(field('Kilometraj, în km'), '91000');

    await press('Salvează');

    const input = field('Kilometraj, în km');
    expect(input.value).toBe('91000');
    const described = (input.getAttribute('aria-describedby') ?? '')
      .split(' ')
      .map((id) => squash(document.getElementById(id)?.textContent))
      .join(' ');
    expect(described).toContain('Un număr întreg');
  });

  it('speaks English in the form', async () => {
    await open(repair(), 'en');
    await press('Correct');

    expect(field('What was done').value).toBe('Schimb ulei și filtre');
    expect(field('Odometer, in km').value).toBe('91300');
    expect(field('Amount, in lei').value).toBe('450');
    expect(button('Save')).toBeDefined();
    expect(button('Cancel')).toBeDefined();
  });
});

describe('the repair dialog, when the repair changed or is gone', () => {
  it('says it changed meanwhile, re-reads once and stays in the form with the new values', async () => {
    correct = jest.fn(async () => {
      throw conflict();
    });
    reread = jest.fn(async () =>
      repair({
        correctedBy: 'garage',
        costBani: 47000,
        version: '2026-10-30T10:30:00.000Z',
      }),
    );
    await open();
    await press('Corectează');
    type(field('Ce s‑a făcut'), 'Altceva');

    await press('Salvează');

    expect(text()).toContain(
      'Reparația a fost modificată între timp. Am reîncărcat valorile.',
    );
    expect(reread).toHaveBeenCalledTimes(1);
    expect(reread).toHaveBeenCalledWith({ id: 'r-1' });
    expect(field('Suma, în lei').value).toBe('470');
    expect(field('Ce s‑a făcut').value).toBe('Schimb ulei și filtre');
    expect(button('Salvează')).toBeDefined();
  });

  it('sends the re-read version on the next save', async () => {
    correct = jest
      .fn()
      .mockRejectedValueOnce(conflict())
      .mockResolvedValueOnce(repair({ costBani: 48000 }));
    reread = jest.fn(async () =>
      repair({ version: '2026-10-30T10:30:00.000Z' }),
    );
    await open();
    await press('Corectează');
    type(field('Suma, în lei'), '480');
    await press('Salvează');

    type(field('Suma, în lei'), '480');
    await press('Salvează');

    expect(correct.mock.calls[1][0].body).toEqual({
      costBani: 48000,
      version: '2026-10-30T10:30:00.000Z',
    });
  });

  it('says the re-read failed and keeps the form when it does', async () => {
    correct = jest.fn(async () => {
      throw conflict();
    });
    reread = jest.fn(async () => {
      throw new HttpErrorResponse({ status: 503 });
    });
    await open();
    await press('Corectează');
    type(field('Suma, în lei'), '480');

    await press('Salvează');

    expect(text()).toContain('nu s‑a reîncărcat');
    expect(text()).not.toContain('Am reîncărcat valorile');
    expect(field('Suma, în lei')).toBeDefined();
  });

  it('closes gone when the save answers 404', async () => {
    correct = jest.fn(async () => {
      throw new HttpErrorResponse({ status: 404 });
    });
    await open();
    await press('Corectează');
    type(field('Suma, în lei'), '480');

    await press('Salvează');

    await expect(result).resolves.toBe('gone');
  });

  it('closes gone when the re-read after a 409 answers 404', async () => {
    correct = jest.fn(async () => {
      throw conflict();
    });
    reread = jest.fn(async () => {
      throw new HttpErrorResponse({ status: 404 });
    });
    await open();
    await press('Corectează');
    type(field('Suma, în lei'), '480');

    await press('Salvează');

    await expect(result).resolves.toBe('gone');
  });

  it('says in English that it changed meanwhile', async () => {
    correct = jest.fn(async () => {
      throw conflict();
    });
    await open(repair(), 'en');
    await press('Correct');
    type(field('Amount, in lei'), '480');

    await press('Save');

    expect(text()).toContain(
      'The repair changed meanwhile. We reloaded the values.',
    );
  });
});
