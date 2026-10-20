import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AdminService, type RecheckDueRowDto } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';
import { toast } from '@motor-fix/ui-cockpit';

import { AdminRecheckForm } from './admin-recheck-form';

// @traces 1351-FR-011

jest.mock('@motor-fix/ui-cockpit', () => ({
  ...jest.requireActual('@motor-fix/ui-cockpit'),
  toast: jest.fn(),
}));

@Component({ template: '' })
class Host {
  readonly overlays = inject(Overlays);
}

const TODAY = '2026-10-01';
const ROW: RecheckDueRowDto = {
  activities: ['mechanics', 'brakes'],
  activityNames: [
    { code: 'mechanics', nameEn: 'Mechanics', nameRo: 'Mecanică' },
    { code: 'brakes', nameEn: 'Brakes', nameRo: 'Frâne' },
  ],
  daysSince: 28,
  garageId: 'garage-1',
  lastCheckedOn: '2026-09-03',
  name: 'Atelier Dinamo',
  overdue: false,
  rarNumber: 'B 1234/2019',
};
const RECORDED = {
  checkedOn: TODAY,
  garageId: 'garage-1',
  id: 'recheck-1',
  lastCheckedOn: TODAY,
  result: 'ok',
  status: 'approved',
};
const CONFIRMATION =
  'Service‑ul va fi suspendat și scos de pe hartă. Programările viitoare se anulează și șoferii sunt anunțați.';

let record: jest.Mock;
let stale: jest.Mock;

async function settle() {
  for (let i = 0; i < 6; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

async function open(row: RecheckDueRowDto = ROW, language: 'ro' | 'en' = 'ro') {
  record = jest.fn(async () => RECORDED);
  stale = jest.fn();
  jest.mocked(toast).mockClear();
  TestBed.configureTestingModule({
    providers: [
      { provide: AdminService, useValue: { recheckControllerRecord: record } },
    ],
  });
  const i18n = TestBed.inject(I18n);
  if (language === 'en') await i18n.use('en');
  await i18n.enter('admin');
  const host = TestBed.createComponent(Host);
  host.componentInstance.overlays.open(AdminRecheckForm, {
    data: { row, stale, today: TODAY },
    shape: 'dialog',
    title: 'admin.rechecks.record',
  });
  await settle();
}

const panel = () =>
  document.querySelector<HTMLElement>('mf-overlay-panel') as HTMLElement;
const text = (el: Element | null = panel()) =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const button = (name: string) =>
  [...panel().querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => text(b) === name,
  );
const press = async (name: string) => {
  button(name)?.click();
  await settle();
};
const date = () =>
  panel().querySelector<HTMLInputElement>(
    'input[type="date"]',
  ) as HTMLInputElement;
const detail = () => panel().querySelector<HTMLTextAreaElement>('textarea');
const box = (code: string) =>
  panel().querySelector<HTMLInputElement>(
    `input[type="checkbox"][value="${code}"]`,
  );
const alert = () => panel().querySelector('[role="alert"]');

function type(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

const conflict = (status: number, body: Record<string, string>) =>
  new HttpErrorResponse({ error: { status, ...body }, status });

afterEach(() => {
  TestBed.resetTestingModule();
  document.querySelectorAll('.cdk-overlay-container').forEach((n) => {
    n.innerHTML = '';
  });
});

beforeAll(async () => {
  await open();
  TestBed.resetTestingModule();
  document.querySelectorAll('.cdk-overlay-container').forEach((n) => {
    n.innerHTML = '';
  });
}, 30_000);

const failWith = async (detailText: string) => {
  await press('Expirată');
  type(detail() as HTMLTextAreaElement, detailText);
  await settle();
};
const suspend = () => button('Suspendă service‑ul') as HTMLButtonElement;
const stay = (event: Event) => event.preventDefault();
const clickRegister = async () => {
  const link = panel().querySelector<HTMLAnchorElement>(
    'a[href="https://portal.rarom.ro/"]',
  ) as HTMLAnchorElement;
  document.addEventListener('click', stay);
  link.click();
  document.removeEventListener('click', stay);
  await settle();
};

describe('the record dialog under hostile input', () => {
  it('keeps the suspend button off for a detail of only spaces', async () => {
    await open();
    await failWith('     ');

    expect(suspend().disabled).toBe(true);
  });

  it('allows 200 characters of two code units each and refuses 201', async () => {
    await open();
    await failWith('🚗'.repeat(200));
    expect(suspend().disabled).toBe(false);

    type(detail() as HTMLTextAreaElement, '🚗'.repeat(201));
    await settle();

    expect(suspend().disabled).toBe(true);
  });

  it('sends the detail trimmed', async () => {
    await open();
    await failWith('   gone   ');

    await press('Suspendă service‑ul');
    await press('Confirmă suspendarea');

    expect(record.mock.calls[0][0].body).toEqual({
      checkedOn: TODAY,
      detail: 'gone',
      failure: 'expired',
      lastCheckedOn: '2026-09-03',
      result: 'failed',
    });
  });

  it('sends neither the failure nor the detail after the admin changes to valid', async () => {
    await open();
    await failWith('gone');
    await press('Valabilă');

    await press('Salvează');

    expect(record.mock.calls[0][0].body).toEqual({
      activities: ['mechanics', 'brakes'],
      checkedOn: TODAY,
      lastCheckedOn: '2026-09-03',
      result: 'ok',
    });
  });

  it('records a failure only after the confirmation', async () => {
    await open();
    await failWith('gone');

    await press('Suspendă service‑ul');

    expect(record).not.toHaveBeenCalled();
    expect(text(panel())).toContain(CONFIRMATION);
  });

  it('sends one request when save is pressed twice before the answer', async () => {
    await open();
    let release: (value: unknown) => void = () => undefined;
    record.mockReturnValueOnce(new Promise((resolve) => (release = resolve)));
    await press('Valabilă');

    button('Salvează')?.click();
    button('Salvează')?.click();
    await settle();
    release(RECORDED);
    await settle();

    expect(record).toHaveBeenCalledTimes(1);
  });

  it('keeps the detail and returns from the confirmation when the suspension is refused', async () => {
    await open();
    record.mockRejectedValueOnce(
      conflict(409, {
        code: 'recheck_conflict',
        detail: 'Deja reverificat de Ana P. la 10:42',
      }),
    );
    await failWith('gone');
    await press('Suspendă service‑ul');

    await press('Confirmă suspendarea');

    expect(text(alert())).toBe('Deja reverificat de Ana P. la 10:42');
    expect(detail()?.value).toBe('gone');
    expect(stale).toHaveBeenCalledTimes(1);
  });

  it('shows a message when the network fails and stays open', async () => {
    await open();
    record.mockRejectedValueOnce(
      new HttpErrorResponse({ error: new ProgressEvent('error'), status: 0 }),
    );
    await press('Valabilă');

    await press('Salvează');

    expect(text(alert())).toBe(
      'Reverificarea nu a putut fi salvată. Încearcă din nou.',
    );
    expect(stale).not.toHaveBeenCalled();
  });

  it('marks the activities when the server names them, keeping the ticks', async () => {
    await open();
    record.mockRejectedValueOnce(
      conflict(422, {
        code: 'recheck_activities_wider',
        detail: 'Activități în afara autorizației',
        field: 'activities',
      }),
    );
    await press('Valabilă');
    box('brakes')?.click();
    await settle();

    await press('Salvează');

    expect(box('mechanics')?.getAttribute('aria-invalid')).toBe('true');
    expect(box('brakes')?.checked).toBe(false);
  });

  it('ignores a field the form does not have', async () => {
    await open();
    record.mockRejectedValueOnce(
      conflict(422, { code: 'x', detail: 'No', field: '__proto__' }),
    );
    await press('Valabilă');

    await press('Salvează');

    expect(date().getAttribute('aria-invalid')).toBeNull();
    expect(text(alert())).toBe('No');
  });

  it('names a missing RAR number and copies nothing', async () => {
    const writeText = jest.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    await open({ ...ROW, rarNumber: null });

    await clickRegister();

    expect(text(panel().querySelector('.number'))).toContain('număr lipsă');
    expect(writeText).not.toHaveBeenCalled();
  });

  it('stays quiet when the clipboard refuses', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: jest.fn(async () => {
          throw new Error('denied');
        }),
      },
    });
    await open();

    await clickRegister();

    expect(toast).not.toHaveBeenCalled();
  });

  it('shows a markup name as text', async () => {
    await open({ ...ROW, name: '<img src=x onerror=alert(1)>' });

    expect(panel().querySelector('img')).toBeNull();
    expect(text(panel().querySelector('.name'))).toBe(
      '<img src=x onerror=alert(1)>',
    );
  });

  it('sends a valid re-check with every activity cleared and marks the server refusal on the activities', async () => {
    await open();
    record.mockRejectedValueOnce(
      conflict(422, {
        code: 'recheck_activities_empty',
        detail: 'Bifează cel puțin o activitate',
        field: 'activities',
      }),
    );
    await press('Valabilă');
    box('mechanics')?.click();
    box('brakes')?.click();
    await settle();

    await press('Salvează');

    expect(record.mock.calls[0][0].body.activities).toEqual([]);
    expect(text(alert())).toBe('Bifează cel puțin o activitate');
    expect(box('mechanics')?.getAttribute('aria-invalid')).toBe('true');
    expect(box('mechanics')?.checked).toBe(false);
  });
});
