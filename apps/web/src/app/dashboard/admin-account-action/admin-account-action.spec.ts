import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AdminService } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { type OverlayResult, Overlays } from '@motor-fix/overlays';

import {
  type AccountAction,
  type AccountActionResult,
  AdminAccountAction,
} from './admin-account-action';

// @traces 003-FR-018 003-FR-019

@Component({ template: '' })
class Host {
  readonly overlays = inject(Overlays);
}

const TODAY = '2026-10-24';
const NAME = 'Andrei <b>Pop</b>';

let api: Record<string, jest.Mock>;
let result: Promise<OverlayResult<AccountActionResult>>;

async function settle() {
  for (let i = 0; i < 6; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

async function open(action: AccountAction, language: 'ro' | 'en' = 'ro') {
  api = {
    accountControllerDeleteOnRequest: jest.fn(async () => undefined),
    accountControllerResetAccess: jest.fn(async () => ({ email: 'sent' })),
    accountControllerRestore: jest.fn(async () => ({})),
    accountControllerSuspend: jest.fn(async () => ({})),
  };
  TestBed.configureTestingModule({
    providers: [{ provide: AdminService, useValue: api }],
  });
  const i18n = TestBed.inject(I18n);
  if (language === 'en') await i18n.use('en');
  await i18n.enter('admin');
  const host = TestBed.createComponent(Host);
  result = host.componentInstance.overlays.open(AdminAccountAction, {
    data: { action, id: 'acc-1', name: NAME, today: TODAY },
    shape: 'dialog',
    title: `admin.users.dialogs.${action}.title`,
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
  ) as HTMLButtonElement;
const press = async (name: string) => {
  button(name).click();
  await settle();
};
const field = (label: string) => {
  const for_ = [...panel().querySelectorAll('label')].find(
    (l) => text(l) === label,
  );
  return panel().querySelector<HTMLInputElement>(
    `#${for_?.getAttribute('for')}`,
  ) as HTMLInputElement;
};
const alert = () => panel().querySelector('[role="alert"]');

function type(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function tick(input: HTMLInputElement) {
  input.checked = true;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

const refused = (status: number, code: string, detail = 'Refuzat.') =>
  new HttpErrorResponse({ error: { code, detail, status }, status });

afterEach(() => {
  TestBed.resetTestingModule();
  document.querySelectorAll('.cdk-overlay-container').forEach((n) => {
    n.innerHTML = '';
  });
});

describe('the reset confirmation', () => {
  it('names the person, as plain text, and resets on Resetează', async () => {
    await open('reset');

    expect(text()).toContain('Resetează accesul pentru Andrei <b>Pop</b>?');
    expect(panel().querySelector('b')).toBeNull();

    await press('Resetează');

    expect(api['accountControllerResetAccess']).toHaveBeenCalledWith({
      id: 'acc-1',
    });
    await expect(result).resolves.toBe('done');
  });

  it('answers email_failed when the reset e-mail could not be sent', async () => {
    await open('reset');
    api['accountControllerResetAccess'].mockResolvedValueOnce({
      email: 'failed',
    });

    await press('Resetează');

    await expect(result).resolves.toBe('email_failed');
  });

  it('reads in English', async () => {
    await open('reset', 'en');

    expect(text()).toContain('Reset access for Andrei <b>Pop</b>?');
    expect(button('Reset')).toBeDefined();
    expect(button('Cancel')).toBeDefined();
  });

  it('closes with nothing sent on Renunță', async () => {
    await open('reset');

    await press('Renunță');

    expect(api['accountControllerResetAccess']).not.toHaveBeenCalled();
    await expect(result).resolves.toBe('cancelled');
  });
});

describe('the suspend dialog', () => {
  it('counts the reason as it is typed', async () => {
    await open('suspend');

    type(field('Motivul'), '  Cereri false  ');
    await settle();

    expect(text(panel().querySelector('[data-part="count"]'))).toBe('12/500');
  });

  it('shows the field error under 10 characters and sends nothing', async () => {
    await open('suspend');
    type(field('Motivul'), 'Prea scurt'.slice(0, 9));

    await press('Suspendă');

    expect(text(panel())).toContain('Scrie motivul, cel puțin 10 caractere');
    expect(field('Motivul').getAttribute('aria-invalid')).toBe('true');
    expect(api['accountControllerSuspend']).not.toHaveBeenCalled();
  });

  it('sends the trimmed reason and closes done', async () => {
    await open('suspend');
    type(field('Motivul'), '  Cereri false repetate  ');

    await press('Suspendă');

    expect(api['accountControllerSuspend']).toHaveBeenCalledWith({
      body: { reason: 'Cereri false repetate' },
      id: 'acc-1',
    });
    await expect(result).resolves.toBe('done');
  });

  it('closes stale on a 409, so the drawer reads the account again', async () => {
    await open('suspend');
    api['accountControllerSuspend'].mockRejectedValueOnce(
      refused(409, 'account_already_suspended'),
    );
    type(field('Motivul'), 'Cereri false repetate');

    await press('Suspendă');

    await expect(result).resolves.toBe('stale');
  });

  it('closes gone on a 404', async () => {
    await open('suspend');
    api['accountControllerSuspend'].mockRejectedValueOnce(
      refused(404, 'not_found'),
    );
    type(field('Motivul'), 'Cereri false repetate');

    await press('Suspendă');

    await expect(result).resolves.toBe('gone');
  });

  it('keeps the text and shows the shared failed text on a server error', async () => {
    await open('suspend');
    api['accountControllerSuspend'].mockRejectedValueOnce(
      new HttpErrorResponse({ status: 500 }),
    );
    type(field('Motivul'), 'Cereri false repetate');

    await press('Suspendă');

    expect(text(alert())).toBe('Ceva nu a mers. Încearcă din nou.');
    expect(field('Motivul').value).toBe('Cereri false repetate');
  });
});

describe('the restore dialog', () => {
  it('restores with no note', async () => {
    await open('restore');

    await press('Reactivează');

    expect(api['accountControllerRestore']).toHaveBeenCalledWith({
      body: {},
      id: 'acc-1',
    });
    await expect(result).resolves.toBe('done');
  });

  it('sends the note when one is written', async () => {
    await open('restore');
    type(field('Notă (opțional)'), ' Contestație acceptată ');

    await press('Reactivează');

    expect(api['accountControllerRestore']).toHaveBeenCalledWith({
      body: { note: 'Contestație acceptată' },
      id: 'acc-1',
    });
  });
});

describe('the delete on request dialog', () => {
  async function filled() {
    await open('delete');
    type(field('Referința cererii'), 'DR-2026-0042');
    type(field('Data primirii'), '2026-10-20');
    tick(field('Identitatea a fost verificată'));
    await settle();
  }

  it("shows what is removed and what stays, the placeholder and today's limit", async () => {
    await open('delete');

    expect(text()).toContain('Ștergem datele contului');
    expect(text()).toContain('Rămân recenziile publicate');
    expect(field('Referința cererii').placeholder).toBe('DR-2026-0001');
    expect(field('Data primirii').max).toBe(TODAY);
  });

  it('enables Șterge only once the three are valid', async () => {
    await open('delete');
    expect(button('Șterge').disabled).toBe(true);

    type(field('Referința cererii'), 'DR-26-1');
    type(field('Data primirii'), '2026-10-20');
    tick(field('Identitatea a fost verificată'));
    await settle();
    expect(button('Șterge').disabled).toBe(true);

    type(field('Referința cererii'), 'DR-2026-0042');
    await settle();
    expect(button('Șterge').disabled).toBe(false);

    type(field('Data primirii'), '2026-10-25');
    await settle();
    expect(button('Șterge').disabled).toBe(true);
  });

  it('sends the request and closes done', async () => {
    await filled();

    await press('Șterge');

    expect(api['accountControllerDeleteOnRequest']).toHaveBeenCalledWith({
      body: {
        identityChecked: true,
        receivedOn: '2026-10-20',
        reference: 'DR-2026-0042',
      },
      id: 'acc-1',
    });
    await expect(result).resolves.toBe('done');
  });

  it("shows a 409 deletion_not_allowed's text in the dialog", async () => {
    await filled();
    api['accountControllerDeleteOnRequest'].mockRejectedValueOnce(
      refused(409, 'deletion_not_allowed', 'Contul deține un service.'),
    );

    await press('Șterge');

    expect(text(alert())).toBe('Contul deține un service.');
  });
});
