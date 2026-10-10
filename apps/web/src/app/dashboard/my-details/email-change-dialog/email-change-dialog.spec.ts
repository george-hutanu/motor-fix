import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MeService } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { type OverlayResult, Overlays } from '@motor-fix/overlays';

import { EmailChangeDialog } from './email-change-dialog';

@Component({ template: '' })
class Host {
  readonly overlays = inject(Overlays);
}

const problem = (status: number, code: string) =>
  new HttpErrorResponse({ error: { code, status }, status });

let request: jest.Mock;
let result: Promise<OverlayResult<{ pendingEmail: string }>>;

async function settle() {
  for (let i = 0; i < 6; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

async function open(language: 'ro' | 'en' = 'ro') {
  request = jest.fn(async ({ body }: { body: { email: string } }) => ({
    pendingEmail: body.email,
  }));
  TestBed.configureTestingModule({
    providers: [
      {
        provide: MeService,
        useValue: { emailChangeControllerRequest: request },
      },
    ],
  });
  if (language === 'en') await TestBed.inject(I18n).use('en');
  const host = TestBed.createComponent(Host);
  result = host.componentInstance.overlays.open<{ pendingEmail: string }>(
    EmailChangeDialog,
    { shape: 'dialog', title: 'driver.emailChange.title' },
  );
  await settle();
}

const panel = () =>
  document.querySelector<HTMLElement>('mf-overlay-panel') as HTMLElement;

function field(label: string): HTMLInputElement {
  const found = [...panel().querySelectorAll('label')].find(
    (l) => l.textContent?.trim() === label,
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
    (b) => b.textContent?.trim() === name,
  ) as HTMLButtonElement | undefined;

const text = () => panel().textContent ?? '';

afterEach(() => {
  document.querySelectorAll('.cdk-overlay-container').forEach((n) => {
    n.innerHTML = '';
  });
});

// @traces 139-edit-my-details-FR-006
// @traces 139-edit-my-details-FR-007
describe('the e-mail dialog', () => {
  it('asks for the new address with one e-mail field and a send button', async () => {
    await open();

    expect(panel().querySelector('h2')?.textContent?.trim()).toBe(
      'Schimbă adresa de e‑mail',
    );
    const input = field('Adresă de e‑mail nouă');
    expect(input.type).toBe('email');
    expect(input.autocomplete).toBe('email');
    expect(button('Trimite linkul')?.type).toBe('submit');
  });

  it('sends the trimmed address and closes with the pending address', async () => {
    await open();
    type(field('Adresă de e‑mail nouă'), '  andrei.nou@exemplu.ro ');

    button('Trimite linkul')?.click();
    await settle();

    expect(request).toHaveBeenCalledWith({
      body: { email: 'andrei.nou@exemplu.ro' },
    });
    await expect(result).resolves.toEqual({
      pendingEmail: 'andrei.nou@exemplu.ro',
    });
  });

  it.each([
    ['nothing', ''],
    ['an address with no domain', 'andrei@'],
    ['an address with a space', 'andrei nou@exemplu.ro'],
  ])('refuses %s before sending', async (_, value) => {
    await open();
    const input = field('Adresă de e‑mail nouă');
    type(input, value);

    button('Trimite linkul')?.click();
    await settle();

    expect(request).not.toHaveBeenCalled();
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(text()).toMatch(
      /Scrie o adresă de e‑mail validă\.|Câmpul este obligatoriu\./,
    );
  });

  it.each([
    [409, 'email_taken', 'Adresa e folosită de alt cont.'],
    [409, 'email_unchanged', 'Aceasta e adresa ta actuală.'],
    [503, 'send_failed', 'Nu am putut trimite. Încearcă din nou.'],
    [
      429,
      'too_many_attempts',
      'Prea multe încercări. Încearcă din nou mai târziu.',
    ],
  ])(
    'keeps the dialog open and says why on %s %s',
    async (status, code, message) => {
      await open();
      request.mockRejectedValueOnce(problem(status, code));
      type(field('Adresă de e‑mail nouă'), 'andrei.nou@exemplu.ro');

      button('Trimite linkul')?.click();
      await settle();

      expect(text()).toContain(message);
      expect(field('Adresă de e‑mail nouă').value).toBe(
        'andrei.nou@exemplu.ro',
      );
      expect(button('Trimite linkul')).toBeDefined();
    },
  );

  it('reads English', async () => {
    await open('en');

    expect(panel().querySelector('h2')?.textContent?.trim()).toBe(
      'Change the e-mail address',
    );
    expect(field('New e-mail address')).toBeDefined();
    expect(button('Send the link')).toBeDefined();
  });

  it('says why in English', async () => {
    await open('en');
    request.mockRejectedValueOnce(problem(409, 'email_taken'));
    type(field('New e-mail address'), 'andrei.nou@exemplu.ro');

    button('Send the link')?.click();
    await settle();

    expect(text()).toContain('Another account uses this address.');
  });
});
