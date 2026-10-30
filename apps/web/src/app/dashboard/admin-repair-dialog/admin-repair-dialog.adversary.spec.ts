// @traces 1405-FR-003
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

const described = (input: HTMLInputElement) =>
  (input.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .map((id) => squash(document.getElementById(id)?.textContent))
    .join(' ');

describe('the repair dialog under hostile input', () => {
  it('sends one request when Salvează is tapped twice', async () => {
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
    button('Salvează')?.click();
    await settle();

    expect(correct).toHaveBeenCalledTimes(1);
    answer(repair({ costBani: 48000 }));
    await settle();
  });

  it.each([
    ['0.29', 29],
    ['1.15', 115],
    ['19.99', 1999],
    ['4.35', 435],
    ['8.2', 820],
  ])('converts %s lei to exact bani', async (lei, bani) => {
    await open();
    await press('Corectează');

    type(field('Suma, în lei'), lei);
    await press('Salvează');

    expect(correct.mock.calls[0][0].body).toEqual({
      costBani: bani,
      version: VERSION,
    });
  });

  it('treats an amount typed with a comma as the same amount or refuses it, never a different one', async () => {
    await open();
    await press('Corectează');

    type(field('Suma, în lei'), '480,5');
    await press('Salvează');

    const sent = correct.mock.calls.map((c) => c[0].body.costBani);
    expect([[], [48050]]).toContainEqual(sent);
  });

  it.each(['1e3', '0x10', 'abc', '48 0', 'Infinity', 'NaN'])(
    'refuses the amount %s at the field',
    async (value) => {
      await open();
      await press('Corectează');

      type(field('Suma, în lei'), value);
      await press('Salvează');

      expect(correct.mock.calls.map((c) => c[0].body)).toEqual([]);
      expect(described(field('Suma, în lei'))).toContain('O sumă');
    },
  );

  it.each(['1e3', '0x10', 'abc', 'Infinity'])(
    'refuses the odometer %s at the field',
    async (value) => {
      await open();
      await press('Corectează');

      type(field('Kilometraj, în km'), value);
      await press('Salvează');

      expect(correct).not.toHaveBeenCalled();
      expect(described(field('Kilometraj, în km'))).toContain(
        'Un număr întreg',
      );
    },
  );

  it('sends nothing but the version when the amount is retyped as the same value', async () => {
    await open(repair({ costBani: 45050 }));
    await press('Corectează');

    expect(field('Suma, în lei').value).toBe('450.5');
    type(field('Suma, în lei'), '450.50');
    await press('Salvează');

    expect(correct.mock.calls[0][0].body).toEqual({ version: VERSION });
  });

  it('sends nothing but the version when the text differs only in surrounding spaces', async () => {
    await open();
    await press('Corectează');

    type(field('Ce s‑a făcut'), '  Schimb ulei și filtre  ');
    await press('Salvează');

    expect(correct.mock.calls[0][0].body).toEqual({ version: VERSION });
  });

  it('sends nothing but the version when a changed field is typed back to its loaded value', async () => {
    await open();
    await press('Corectează');

    type(field('Data'), '2025-03-11');
    type(field('Data'), '2025-03-12');
    await press('Salvează');

    expect(correct.mock.calls[0][0].body).toEqual({ version: VERSION });
  });

  it('shows an amount and an odometer of zero rather than leaving them out', async () => {
    await open(repair({ costBani: 0, odometerKm: 0 }));

    expect(lines()).toEqual(
      expect.arrayContaining(['Kilometraj: 0 km', 'Suma: 0 lei']),
    );
    await press('Corectează');
    expect(field('Kilometraj, în km').value).toBe('0');
    expect(field('Suma, în lei').value).toBe('0');
  });

  it('sets an odometer on a repair that had none', async () => {
    await open(repair({ odometerKm: null }));
    await press('Corectează');

    expect(field('Kilometraj, în km').value).toBe('');
    type(field('Kilometraj, în km'), '120000');
    await press('Salvează');

    expect(correct.mock.calls[0][0].body).toEqual({
      odometerKm: 120000,
      version: VERSION,
    });
  });

  it('shows markup in what was done and the garage as plain text', async () => {
    await open(
      repair({
        garageName: '<img src=x onerror=alert(1)>',
        what: '<script>alert(1)</script>',
      }),
    );

    expect(panel().querySelector('script, img')).toBeNull();
    expect(text()).toContain('<script>alert(1)</script>');
    expect(text()).toContain('<img src=x onerror=alert(1)>');
  });

  it('keeps unicode what was done intact in the request', async () => {
    await open();
    await press('Corectează');

    type(field('Ce s‑a făcut'), 'Țeavă ăîșț 🚗 ñ');
    await press('Salvează');

    expect(correct.mock.calls[0][0].body.what).toBe('Țeavă ăîșț 🚗 ñ');
  });

  it('refuses a date written as something other than a calendar day', async () => {
    await open();
    await press('Corectează');

    type(field('Data'), '2025-02-30');
    await press('Salvează');

    expect(correct).not.toHaveBeenCalled();
  });
});

describe('the repair dialog when a save does not go through', () => {
  it('keeps the form and the values after a server error, tells no opener, and sends the same version again', async () => {
    correct = jest
      .fn()
      .mockRejectedValueOnce(new HttpErrorResponse({ status: 500 }))
      .mockResolvedValueOnce(repair({ costBani: 48000 }));
    await open();
    await press('Corectează');
    type(field('Suma, în lei'), '480');

    await press('Salvează');

    expect(saved).not.toHaveBeenCalled();
    expect(field('Suma, în lei').value).toBe('480');
    expect(button('Salvează')?.getAttribute('aria-busy')).not.toBe('true');
    await press('Salvează');
    expect(correct).toHaveBeenCalledTimes(2);
    expect(correct.mock.calls[1][0]).toEqual(correct.mock.calls[0][0]);
    expect(saved).toHaveBeenCalledTimes(1);
  });

  it('keeps the form after the network fails', async () => {
    correct = jest.fn(async () => {
      throw new HttpErrorResponse({ status: 0 });
    });
    await open();
    await press('Corectează');
    type(field('Suma, în lei'), '480');

    await press('Salvează');

    expect(field('Suma, în lei').value).toBe('480');
    expect(saved).not.toHaveBeenCalled();
  });

  it('does not tell the opener about a 409 or a 404', async () => {
    correct = jest.fn(async () => {
      throw conflict();
    });
    await open();
    await press('Corectează');

    await press('Salvează');

    expect(saved).not.toHaveBeenCalled();
  });

  it('re-reads once only when Salvează is tapped twice into a 409', async () => {
    correct = jest.fn(async () => {
      throw conflict();
    });
    await open();
    await press('Corectează');
    type(field('Suma, în lei'), '480');

    button('Salvează')?.click();
    button('Salvează')?.click();
    await settle();

    expect(correct).toHaveBeenCalledTimes(1);
    expect(reread).toHaveBeenCalledTimes(1);
  });

  it('shows the re-read values on Renunță after a 409', async () => {
    correct = jest.fn(async () => {
      throw conflict();
    });
    reread = jest.fn(async () =>
      repair({ costBani: 47000, version: '2026-10-30T10:30:00.000Z' }),
    );
    await open();
    await press('Corectează');
    type(field('Suma, în lei'), '480');
    await press('Salvează');

    await press('Renunță');

    expect(lines()).toContain('Suma: 470 lei');
  });

  it('discards the edits of every field on a 409', async () => {
    correct = jest.fn(async () => {
      throw conflict();
    });
    await open();
    await press('Corectează');
    type(field('Ce s‑a făcut'), 'Altceva');
    type(field('Data'), '2024-01-01');
    type(field('Kilometraj, în km'), '5');
    type(field('Suma, în lei'), '1');

    await press('Salvează');

    expect(field('Ce s‑a făcut').value).toBe('Schimb ulei și filtre');
    expect(field('Data').value).toBe('2025-03-12');
    expect(field('Kilometraj, în km').value).toBe('91300');
    expect(field('Suma, în lei').value).toBe('450');
  });

  it('closes gone without telling the opener of a save when the save answers 404', async () => {
    correct = jest.fn(async () => {
      throw new HttpErrorResponse({ status: 404 });
    });
    await open();
    await press('Corectează');

    await press('Salvează');

    await expect(result).resolves.toBe('gone');
    expect(saved).not.toHaveBeenCalled();
    expect(document.querySelector('mf-overlay-panel')).toBeNull();
  });

  it('shows a 400 on what was done at that field and keeps the other values', async () => {
    correct = jest.fn(async () => {
      throw new HttpErrorResponse({
        error: {
          code: 'validation_failed',
          errors: [{ code: 'what', field: 'what' }],
          status: 400,
        },
        status: 400,
      });
    });
    await open();
    await press('Corectează');
    type(field('Suma, în lei'), '480');

    await press('Salvează');

    expect(described(field('Ce s‑a făcut'))).toContain('Scrie ce s‑a făcut');
    expect(field('Suma, în lei').value).toBe('480');
  });

  it('shows the form unchanged after a failed save then Renunță', async () => {
    correct = jest.fn(async () => {
      throw new HttpErrorResponse({ status: 500 });
    });
    await open();
    await press('Corectează');
    type(field('Suma, în lei'), '480');
    await press('Salvează');

    await press('Renunță');

    expect(lines()).toContain('Suma: 450 lei');
  });

  it('tells the section a correction that answers after Escape closed the dialog', async () => {
    let answer: (value: AdminRepairDto) => void = () => undefined;
    correct = jest.fn(
      () =>
        new Promise<AdminRepairDto>((resolve) => {
          answer = resolve;
        }),
    );
    await open();
    await press('Corectează');
    button('Salvează')?.click();
    await settle();

    document.dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }),
    );
    panel().dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }),
    );
    await settle();

    answer(repair({ costBani: 48000 }));
    await settle();

    expect(saved).toHaveBeenCalledWith(repair({ costBani: 48000 }));
  });

  it('shows no delete action in the form, in either language', async () => {
    await open(repair(), 'en');
    await press('Correct');

    const names = [...panel().querySelectorAll('button')].map((b) =>
      squash(b.textContent).toLowerCase(),
    );
    expect(
      names.some((n) => n.includes('delete') || n.includes('remove')),
    ).toBe(false);
  });
});
