import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AdminService, type RecheckDueRowDto } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { type OverlayResult, Overlays } from '@motor-fix/overlays';
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
let result: Promise<OverlayResult<'recorded' | 'cancelled'>>;

async function settle() {
  for (let i = 0; i < 6; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

async function open(row: RecheckDueRowDto = ROW, language: 'ro' | 'en' = 'ro') {
  record = jest.fn(async () => RECORDED);
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
  result = host.componentInstance.overlays.open(AdminRecheckForm, {
    data: { row, today: TODAY },
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

// The first open loads the translations and the overlay's panel, which on a
// busy machine can outlast a test's 5 s: it is paid once here instead.
beforeAll(async () => {
  await open();
  TestBed.resetTestingModule();
  document.querySelectorAll('.cdk-overlay-container').forEach((n) => {
    n.innerHTML = '';
  });
}, 30_000);

describe('the record dialog', () => {
  it.each([
    ['ro', ['Valabilă', 'Expirată', 'Suspendată', 'Retrasă']],
    ['en', ['Valid', 'Expired', 'Suspended', 'Withdrawn']],
  ] as const)('offers the four results in %s', async (language, names) => {
    await open(ROW, language);

    for (const name of names) expect(button(name)).toBeDefined();
  });

  it('dates the check today, the list’s day, and allows no later day', async () => {
    await open();

    expect(date().value).toBe(TODAY);
    expect(date().max).toBe(TODAY);
  });

  it('pre-ticks the garage’s current activities', async () => {
    await open();

    expect(box('mechanics')?.checked).toBe(true);
    expect(box('brakes')?.checked).toBe(true);
  });

  it('links the RAR register in a new tab and copies the number as it opens', async () => {
    const writeText = jest.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    await open();

    const link = panel().querySelector<HTMLAnchorElement>(
      'a[href="https://portal.rarom.ro/"]',
    ) as HTMLAnchorElement;
    expect(link.target).toBe('_blank');
    expect(link.rel).toBe('noopener noreferrer');
    const stay = (event: Event) => event.preventDefault();
    document.addEventListener('click', stay);
    link.click();
    document.removeEventListener('click', stay);
    await settle();

    expect(writeText).toHaveBeenCalledWith('B 1234/2019');
    expect(toast).toHaveBeenCalledWith('Număr RAR copiat');
  });

  it('records a valid re-check with the date, the ticks and the date the row showed, then closes', async () => {
    await open();
    await press('Valabilă');
    box('brakes')?.click();
    await settle();

    await press('Salvează');

    expect(record).toHaveBeenCalledWith({
      body: {
        activities: ['mechanics'],
        checkedOn: TODAY,
        lastCheckedOn: '2026-09-03',
        result: 'ok',
      },
      id: 'garage-1',
    });
    await expect(result).resolves.toBe('recorded');
  });

  it('carries an empty date of last check as null', async () => {
    await open({ ...ROW, daysSince: null, lastCheckedOn: null, overdue: true });
    await press('Valabilă');

    await press('Salvează');

    expect(record.mock.calls[0][0].body.lastCheckedOn).toBeNull();
  });

  it('shows a 409 inline, keeps what was entered and stays open', async () => {
    await open();
    record.mockRejectedValueOnce(
      conflict(409, {
        code: 'recheck_conflict',
        detail: 'Deja reverificat de Ana P. la 10:42',
      }),
    );
    await press('Valabilă');
    type(date(), '2026-09-30');
    await settle();

    await press('Salvează');

    expect(text(alert())).toBe('Deja reverificat de Ana P. la 10:42');
    expect(date().value).toBe('2026-09-30');
    expect(button('Valabilă')?.getAttribute('aria-pressed')).toBe('true');
    expect(panel()).not.toBeNull();
  });

  it('marks the control a 422 names, with its message', async () => {
    await open();
    record.mockRejectedValueOnce(
      conflict(422, {
        code: 'recheck_date_invalid',
        detail: 'Data verificării trebuie să fie după ultima verificare',
        field: 'checkedOn',
      }),
    );
    await press('Valabilă');

    await press('Salvează');

    expect(date().getAttribute('aria-invalid')).toBe('true');
    expect(text(panel())).toContain(
      'Data verificării trebuie să fie după ultima verificare',
    );
  });

  it('closes as cancelled on "Renunță", sending nothing', async () => {
    await open();

    await press('Renunță');

    expect(record).not.toHaveBeenCalled();
    await expect(result).resolves.toBe('cancelled');
  });
});

describe('a failed re-check', () => {
  it.each([
    ['Expirată', 'expired'],
    ['Suspendată', 'suspended'],
    ['Retrasă', 'withdrawn'],
  ])(
    'for %s asks for the detail and offers to suspend the garage',
    async (name) => {
      await open();

      await press(name);

      expect(detail()?.getAttribute('maxlength')).toBe('200');
      expect(detail()?.required).toBe(true);
      expect(text()).toContain('0/200');
      expect(button('Suspendă service‑ul')).toBeDefined();
      expect(button('Salvează')).toBeUndefined();
      expect(box('mechanics')).toBeNull();
    },
  );

  it('reads the suspend button in English', async () => {
    await open(ROW, 'en');

    await press('Expired');

    expect(button('Suspend the garage')).toBeDefined();
  });

  it('counts the detail as it is typed', async () => {
    await open();
    await press('Expirată');

    type(detail() as HTMLTextAreaElement, 'expirată');
    await settle();

    expect(text()).toContain('8/200');
  });

  it('asks to confirm before it sends anything', async () => {
    await open();
    await press('Expirată');
    type(detail() as HTMLTextAreaElement, 'expirată pe 12 sept. 2026');
    await settle();

    await press('Suspendă service‑ul');

    expect(record).not.toHaveBeenCalled();
    expect(text()).toContain(CONFIRMATION);
  });

  it('records the failure with its kind and the trimmed detail once confirmed', async () => {
    await open();
    await press('Retrasă');
    type(detail() as HTMLTextAreaElement, '  retrasă de RAR  ');
    await settle();
    await press('Suspendă service‑ul');

    await press('Confirmă suspendarea');

    expect(record).toHaveBeenCalledWith({
      body: {
        checkedOn: TODAY,
        detail: 'retrasă de RAR',
        failure: 'withdrawn',
        lastCheckedOn: '2026-09-03',
        result: 'failed',
      },
      id: 'garage-1',
    });
    await expect(result).resolves.toBe('recorded');
  });

  it('does not offer to suspend while the detail is blank', async () => {
    await open();
    await press('Expirată');
    type(detail() as HTMLTextAreaElement, '   ');
    await settle();

    expect(button('Suspendă service‑ul')?.disabled).toBe(true);
  });

  it('goes back to the form from the confirmation, sending nothing', async () => {
    await open();
    await press('Expirată');
    type(detail() as HTMLTextAreaElement, 'expirată');
    await settle();
    await press('Suspendă service‑ul');

    await press('Înapoi');

    expect(text()).not.toContain(CONFIRMATION);
    expect(detail()?.value).toBe('expirată');
    expect(record).not.toHaveBeenCalled();
  });
});
