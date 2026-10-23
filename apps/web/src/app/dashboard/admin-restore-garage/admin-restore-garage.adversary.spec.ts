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

const form = () => panel().querySelector('form') as HTMLFormElement;
const submit = async () => {
  form().dispatchEvent(
    new Event('submit', { bubbles: true, cancelable: true }),
  );
  await settle();
};
const ADMIN = { activities: [], cause: 'admin' as const, rarVerdict: null };

describe('the restore dialog under a hostile admin or server', () => {
  it('sends the same restore again after a lost call and then closes as restored', async () => {
    await open(ADMIN);
    restore.mockRejectedValueOnce(new HttpErrorResponse({ status: 0 }));
    type(note(), 'Rezolvat');
    await settle();

    await press('Repune pe hartă');
    await press('Repune pe hartă');

    expect(restore).toHaveBeenCalledTimes(2);
    expect(restore.mock.calls[1]).toEqual(restore.mock.calls[0]);
    expect(await result).toBe('restored');
  });

  it('sends a note of exactly 1,000 emoji and holds one of 1,001', async () => {
    await open(ADMIN);
    type(note(), '🚗'.repeat(1001));
    await settle();

    expect(text(part('count'))).toBe('1001/1000');
    expect(button('Repune pe hartă')?.disabled).toBe(true);

    type(note(), `  ${'🚗'.repeat(1000)}  `);
    await settle();
    await press('Repune pe hartă');

    expect(restore).toHaveBeenCalledWith({
      body: { note: '🚗'.repeat(1000) },
      id: 'garage-1',
    });
  });

  it('sends only the ticked activities, in the order the garage holds them, with the note', async () => {
    await open();
    box('mechanics')?.click();
    await settle();
    type(note(), 'Verificat în registru');
    await settle();

    await press('Repune pe hartă');

    expect(restore).toHaveBeenCalledWith({
      body: {
        note: 'Verificat în registru',
        recheck: { activities: ['brakes'], checkedOn: TODAY },
      },
      id: 'garage-1',
    });
  });

  it('holds the button and sends nothing when the date is cleared', async () => {
    await open();
    type(date() as HTMLInputElement, '');
    await settle();

    await press('Repune pe hartă');

    expect(button('Repune pe hartă')?.disabled).toBe(true);
    expect(restore).not.toHaveBeenCalled();
  });

  it('holds the button for a garage that holds no activity to tick', async () => {
    await open({ activities: [] });

    await submit();

    expect(button('Repune pe hartă')?.disabled).toBe(true);
    expect(restore).not.toHaveBeenCalled();
  });

  it('sends no re-check for a garage suspended by an admin', async () => {
    await open({ ...ADMIN, activities: DATA.activities });
    type(note(), 'Rezolvat');
    await settle();

    await press('Repune pe hartă');

    expect(restore).toHaveBeenCalledWith({
      body: { note: 'Rezolvat' },
      id: 'garage-1',
    });
  });

  it('leaves the judgement to the server when the documents state is unknown', async () => {
    await open({
      activities: [],
      cause: 'documents_overdue',
      documentsDue: null,
    });

    await press('Repune pe hartă');

    expect(restore).toHaveBeenCalledWith({ body: {}, id: 'garage-1' });
  });

  it('sends one restore when the form is submitted twice while one is on its way', async () => {
    await open(ADMIN);
    let finish: (value: unknown) => void = () => undefined;
    restore.mockImplementationOnce(
      () => new Promise((resolve) => (finish = resolve)),
    );
    type(note(), 'Rezolvat');
    await settle();

    await submit();
    await submit();

    expect(restore).toHaveBeenCalledTimes(1);
    finish(RESTORED);
    await settle();
  });

  it('sends nothing more by the Enter key once the garage was found already restored', async () => {
    await open(ADMIN);
    restore.mockRejectedValueOnce(
      refused(409, {
        code: 'garage_already_restored',
        detail: 'Deja repus pe hartă de Ana P.',
      }),
    );
    type(note(), 'Rezolvat');
    await settle();
    await press('Repune pe hartă');

    await submit();

    expect(restore).toHaveBeenCalledTimes(1);
  });

  it('shows a server message holding markup as text', async () => {
    await open(ADMIN);
    restore.mockRejectedValueOnce(
      refused(409, {
        code: 'recheck_missing',
        detail: '<img src=x onerror=alert(1)>',
      }),
    );
    type(note(), 'Rezolvat');
    await settle();

    await press('Repune pe hartă');

    expect(text(alert())).toBe('<img src=x onerror=alert(1)>');
    expect(panel().querySelector('img')).toBeNull();
  });

  it('shows the plain failure, not the server text, for a 500 that carries one', async () => {
    await open(ADMIN);
    restore.mockRejectedValueOnce(
      refused(500, {
        code: 'internal',
        detail: 'PrismaClientKnownRequestError at line 42',
      }),
    );
    type(note(), 'Rezolvat');
    await settle();

    await press('Repune pe hartă');

    expect(text(alert())).toBe(
      'Nu am putut repune service‑ul pe hartă. Încearcă din nou.',
    );
  });

  it('shows the plain failure for a 409 that answers with no message', async () => {
    await open(ADMIN);
    restore.mockRejectedValueOnce(new HttpErrorResponse({ status: 409 }));
    type(note(), 'Rezolvat');
    await settle();

    await press('Repune pe hartă');

    expect(text(alert())).toBe(
      'Nu am putut repune service‑ul pe hartă. Încearcă din nou.',
    );
  });

  it('marks no control for a refusal that names a field the dialog does not have', async () => {
    await open(ADMIN);
    restore.mockRejectedValueOnce(
      refused(422, {
        code: 'recheck_not_expected',
        detail: 'Nu se așteaptă o reverificare',
        field: 'recheck',
      }),
    );
    type(note(), 'Rezolvat');
    await settle();

    await press('Repune pe hartă');

    expect(text(alert())).toBe('Nu se așteaptă o reverificare');
    expect(note().getAttribute('aria-invalid')).not.toBe('true');
  });
});
