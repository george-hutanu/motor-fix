import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AdminService } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { type OverlayResult, Overlays } from '@motor-fix/overlays';

import {
  AdminRestoreGarage,
  type AdminRestoreGarageData,
  type RestoreResult,
} from './admin-restore-garage';

// @traces 067-FR-009 067-FR-012

@Component({ template: '' })
class Host {
  readonly overlays = inject(Overlays);
}

const TODAY = '2026-10-03';
const DATA: AdminRestoreGarageData = {
  activities: [
    { code: 'mechanics', nameEn: 'Mechanics', nameRo: 'Mecanică' },
    { code: 'brakes', nameEn: 'Brakes', nameRo: 'Frâne' },
  ],
  cause: 'recheck_failed',
  documentsDue: null,
  fromTime: '2026-09-12T08:00:00.000Z',
  garageId: 'garage-1',
  name: 'Atelier Dinamo',
  rarVerdict: 'expired',
  reason: 'Autorizație RAR expirată pe 12 sept. 2026',
  today: TODAY,
};
const RESTORED = {
  cause: 'recheck_failed',
  fromTime: DATA.fromTime,
  garageId: 'garage-1',
  id: 'suspension-1',
  lastCheckedOn: TODAY,
  liftedBy: { name: 'Ana P.' },
  note: null,
  untilTime: '2026-10-03T09:00:00.000Z',
};

let restore: jest.Mock;
let result: Promise<OverlayResult<RestoreResult>>;

async function settle() {
  for (let i = 0; i < 6; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

async function open(
  extra: Partial<AdminRestoreGarageData> = {},
  language: 'ro' | 'en' = 'ro',
) {
  restore = jest.fn(async () => RESTORED);
  TestBed.configureTestingModule({
    providers: [
      {
        provide: AdminService,
        useValue: { suspensionControllerRestore: restore },
      },
    ],
  });
  const i18n = TestBed.inject(I18n);
  if (language === 'en') await i18n.use('en');
  await i18n.enter('admin');
  const host = TestBed.createComponent(Host);
  result = host.componentInstance.overlays.open(AdminRestoreGarage, {
    data: { ...DATA, ...extra },
    shape: 'dialog',
    title: 'admin.restore.dialog',
  });
  await settle();
}

const panel = () =>
  document.querySelector<HTMLElement>('mf-overlay-panel') as HTMLElement;
const text = (el: Element | null = panel()) =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const button = (name: string) =>
  [...panel().querySelectorAll<HTMLButtonElement>('form button')].find(
    (b) => text(b) === name,
  );
const press = async (name: string) => {
  button(name)?.click();
  await settle();
};
const date = () =>
  panel().querySelector<HTMLInputElement>('input[type="date"]');
const note = () =>
  panel().querySelector<HTMLTextAreaElement>('textarea') as HTMLTextAreaElement;
const box = (code: string) =>
  panel().querySelector<HTMLInputElement>(
    `input[type="checkbox"][value="${code}"]`,
  );
const alert = () => panel().querySelector('[role="alert"]');
const part = (name: string) => panel().querySelector(`[data-part="${name}"]`);

function type(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

const refused = (status: number, body: Record<string, string>) =>
  new HttpErrorResponse({ error: { status, ...body }, status });

afterEach(() => {
  TestBed.resetTestingModule();
  document.querySelectorAll('.cdk-overlay-container').forEach((n) => {
    n.innerHTML = '';
  });
});

// The first open loads the translations and the overlay's panel once.
beforeAll(async () => {
  await open();
  TestBed.resetTestingModule();
  document.querySelectorAll('.cdk-overlay-container').forEach((n) => {
    n.innerHTML = '';
  });
}, 30_000);

describe('the restore dialog', () => {
  it('names the garage, the state as the list reads it, the reason and since when', async () => {
    await open();

    expect(text(part('name'))).toBe('Atelier Dinamo');
    expect(text(part('state'))).toBe('suspendat · autorizație RAR expirată');
    expect(text(part('reason'))).toBe(
      'Autorizație RAR expirată pe 12 sept. 2026',
    );
    expect(text(part('since'))).toBe('din 12 sept. 2026');
  });

  it('reads in English', async () => {
    await open({}, 'en');

    expect(text(part('state'))).toBe('suspended · RAR authorisation expired');
    expect(text(part('since'))).toBe('since 12 Sep 2026');
    expect(button('Put back on the map')).toBeDefined();
    expect(button('Cancel')).toBeDefined();
  });

  it('shows the name, the reason and the note as text, never as markup', async () => {
    await open({ name: '<b>Atelier</b>', reason: '<i>motiv</i>' });

    expect(text(part('name'))).toBe('<b>Atelier</b>');
    expect(panel().querySelector('b, i')).toBeNull();
  });
});

describe('restoring after a failed re-check', () => {
  it('fills the date with today, ticks every activity and fixes the result to valid', async () => {
    await open();

    expect(date()?.value).toBe(TODAY);
    expect(date()?.max).toBe(TODAY);
    expect(box('mechanics')?.checked).toBe(true);
    expect(box('brakes')?.checked).toBe(true);
    expect(text(part('result'))).toContain('Valabilă');
    expect(button('Expirată')).toBeUndefined();
  });

  it('sends the date and the ticked activities, then closes as restored', async () => {
    await open();
    type(date() as HTMLInputElement, '2026-10-02');
    box('brakes')?.click();
    await settle();

    await press('Repune pe hartă');

    expect(restore).toHaveBeenCalledWith({
      body: { recheck: { activities: ['mechanics'], checkedOn: '2026-10-02' } },
      id: 'garage-1',
    });
    expect(await result).toBe('restored');
  });

  it('holds the button with no activity ticked', async () => {
    await open();
    box('mechanics')?.click();
    box('brakes')?.click();
    await settle();

    expect(button('Repune pe hartă')?.disabled).toBe(true);
  });

  it('keeps a 422 in the dialog with the date marked and what was entered', async () => {
    await open();
    restore.mockRejectedValueOnce(
      refused(422, {
        code: 'recheck_date_invalid',
        detail: 'Data verificării trebuie să fie după ultima verificare',
        field: 'checkedOn',
      }),
    );
    type(date() as HTMLInputElement, '2026-09-01');
    await settle();

    await press('Repune pe hartă');

    expect(text(alert())).toBe(
      'Data verificării trebuie să fie după ultima verificare',
    );
    expect(date()?.getAttribute('aria-invalid')).toBe('true');
    expect(date()?.value).toBe('2026-09-01');
    expect(panel()).not.toBeNull();
  });
});

describe('restoring after overdue documents', () => {
  it('says the documents are valid when the cycle reads due', async () => {
    await open({
      activities: [],
      cause: 'documents_overdue',
      documentsDue: true,
    });

    expect(text(part('documents'))).toBe('Documente anuale valabile');
    expect(date()).toBeNull();
    expect(button('Repune pe hartă')?.disabled).toBe(false);
  });

  it('says they are not all valid and holds the button otherwise', async () => {
    await open({
      activities: [],
      cause: 'documents_overdue',
      documentsDue: false,
    });

    expect(text(part('documents'))).toBe(
      'Documentele anuale nu sunt toate valabile',
    );
    expect(button('Repune pe hartă')?.disabled).toBe(true);
  });

  it('reads both lines in English', async () => {
    await open(
      { activities: [], cause: 'documents_overdue', documentsDue: true },
      'en',
    );

    expect(text(part('documents'))).toBe('Yearly documents valid');
  });

  it('sends an optional note and nothing else', async () => {
    await open({
      activities: [],
      cause: 'documents_overdue',
      documentsDue: true,
    });
    expect(text(panel().querySelector('label[for="mf-restore-note"]'))).toBe(
      'Ce s‑a rezolvat (opțional)',
    );

    await press('Repune pe hartă');

    expect(restore).toHaveBeenCalledWith({ body: {}, id: 'garage-1' });
  });
});

describe.each(['admin', 'report_confirmed'] as const)(
  'restoring a garage suspended for %s',
  (cause) => {
    const data = { activities: [], cause, rarVerdict: null };

    it('asks for the note and sends nothing without it', async () => {
      await open(data);
      type(note(), '   ');
      await settle();

      await press('Repune pe hartă');

      expect(restore).not.toHaveBeenCalled();
      expect(text(alert())).toBe('Scrie ce s‑a rezolvat');
      expect(note().getAttribute('aria-invalid')).toBe('true');
    });

    it('asks in English', async () => {
      await open(data, 'en');

      await press('Put back on the map');

      expect(text(alert())).toBe('Say what was fixed');
    });

    it('counts the note in code points and sends it trimmed, line breaks kept', async () => {
      await open(data);
      type(note(), '  Am vorbit cu 🚗\nproprietarul ');
      await settle();

      expect(text(part('count'))).toBe('27/1000');
      await press('Repune pe hartă');

      expect(restore).toHaveBeenCalledWith({
        body: { note: 'Am vorbit cu 🚗\nproprietarul' },
        id: 'garage-1',
      });
    });
  },
);

describe('sending', () => {
  const data = { activities: [], cause: 'admin' as const, rarVerdict: null };

  it('sends one restore on a double press', async () => {
    await open(data);
    let finish: (value: unknown) => void = () => undefined;
    restore.mockImplementationOnce(
      () => new Promise((resolve) => (finish = resolve)),
    );
    type(note(), 'Rezolvat');
    await settle();

    button('Repune pe hartă')?.click();
    button('Repune pe hartă')?.click();
    await settle();

    expect(restore).toHaveBeenCalledTimes(1);
    expect(button('Repune pe hartă')?.disabled).toBe(true);
    expect(button('Repune pe hartă')?.getAttribute('aria-busy')).toBe('true');
    finish(RESTORED);
    await settle();
  });

  it.each([
    ['a network failure', new HttpErrorResponse({ status: 0 })],
    ['a 503', refused(503, { code: 'unavailable' })],
  ])(
    'tells %s, keeps the note and lets the admin try again',
    async (_, error) => {
      await open(data);
      restore.mockRejectedValueOnce(error);
      type(note(), 'Rezolvat');
      await settle();

      await press('Repune pe hartă');

      expect(text(alert())).toBe(
        'Nu am putut repune service‑ul pe hartă. Încearcă din nou.',
      );
      expect(note().value).toBe('Rezolvat');
      expect(button('Repune pe hartă')?.disabled).toBe(false);
    },
  );

  it('tells a failure in English', async () => {
    await open(data, 'en');
    restore.mockRejectedValueOnce(new HttpErrorResponse({ status: 0 }));
    type(note(), 'Fixed');
    await settle();

    await press('Put back on the map');

    expect(text(alert())).toBe(
      'Could not put the garage back on the map. Try again.',
    );
  });

  it('keeps a 409 in the dialog with what was entered', async () => {
    await open({
      activities: [],
      cause: 'documents_overdue',
      documentsDue: true,
    });
    restore.mockRejectedValueOnce(
      refused(409, {
        code: 'documents_not_valid',
        detail: 'Documentele anuale nu sunt toate valabile',
      }),
    );
    type(note(), 'Am verificat');
    await settle();

    await press('Repune pe hartă');

    expect(text(alert())).toBe('Documentele anuale nu sunt toate valabile');
    expect(note().value).toBe('Am verificat');
    expect(panel()).not.toBeNull();
  });

  it.each(['garage_already_restored', 'garage_not_suspended'])(
    'shows %s, then closes as stale once the admin closes it',
    async (code) => {
      await open(data);
      restore.mockRejectedValueOnce(
        refused(409, { code, detail: 'Deja repus pe hartă de Ana P.' }),
      );
      type(note(), 'Rezolvat');
      await settle();

      await press('Repune pe hartă');

      expect(text(alert())).toBe('Deja repus pe hartă de Ana P.');
      expect(button('Repune pe hartă')).toBeUndefined();
      await press('Închide');
      expect(await result).toBe('stale');
    },
  );

  it('closes as cancelled and sends nothing on Renunță', async () => {
    await open(data);

    await press('Renunță');

    expect(restore).not.toHaveBeenCalled();
    expect(await result).toBe('cancelled');
  });
});
