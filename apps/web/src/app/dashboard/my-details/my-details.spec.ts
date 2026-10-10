import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { type MeDto, MeService } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';
import { toast } from '@motor-fix/ui-cockpit';

import { EmailChangeDialog } from './email-change-dialog/email-change-dialog';
import { MyDetails } from './my-details';
import { PasswordChangeDialog } from './password-change-dialog/password-change-dialog';
import { PhoneChangeDialog } from './phone-change-dialog/phone-change-dialog';
import { SignInDialog } from '../../sign-in/sign-in-dialog';
import { Session } from '../session';

jest.mock('@motor-fix/ui-cockpit', () => ({
  ...jest.requireActual('@motor-fix/ui-cockpit'),
  toast: jest.fn(),
}));

const ANDREI: MeDto = {
  capabilities: [],
  city: null,
  email: 'andrei@example.ro',
  emailConfirmed: true,
  garageAccess: null,
  garageId: null,
  hasPassword: true,
  id: 'a1',
  landing: '/app/driver',
  language: 'ro',
  name: 'Andrei Marin',
  pendingEmail: null,
  phone: null,
  phoneConfirmed: false,
  role: 'driver',
  roles: ['driver'],
} as unknown as MeDto;

let current: ReturnType<typeof signal<MeDto | null>>;
let update: jest.Mock;
let askAgain: jest.Mock;
let open: jest.Mock;
let gate: jest.Mock;

async function settle() {
  for (let i = 0; i < 6; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

async function render(
  me: Partial<MeDto> = {},
  language: 'ro' | 'en' = 'ro',
  answer: (body: unknown) => Promise<MeDto> = async (body) => ({
    ...(current() as MeDto),
    ...(body as Partial<MeDto>),
  }),
) {
  current = signal<MeDto | null>({ ...ANDREI, ...me } as MeDto);
  update = jest.fn(({ body }: { body: unknown }) => answer(body));
  askAgain = jest.fn(async () => undefined);
  open = jest.fn(async () => 'cancelled');
  gate = jest.fn(async () => true);
  TestBed.configureTestingModule({
    providers: [
      { provide: Session, useValue: { current } },
      {
        provide: MeService,
        useValue: {
          meControllerUpdate: update,
          meEmailConfirmationControllerAskAgain: askAgain,
        },
      },
      { provide: Overlays, useValue: { open } },
      { provide: SignInDialog, useValue: { gate } },
    ],
  });
  if (language === 'en') await TestBed.inject(I18n).use('en');
  const fixture = TestBed.createComponent(MyDetails);
  fixture.autoDetectChanges();
  await settle();
  const element = fixture.nativeElement as HTMLElement;
  return { element, fixture };
}

// Each row as "label: value".
const rows = (element: HTMLElement) =>
  [...element.querySelectorAll('dt')].map(
    (dt) =>
      `${dt.textContent?.trim()}: ${dt.nextElementSibling?.textContent?.trim()}`,
  );

const button = (element: HTMLElement, name: string) =>
  [...element.querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === name,
  ) as HTMLButtonElement | undefined;

function field(element: HTMLElement, label: string): HTMLInputElement {
  const found = [...element.querySelectorAll('label')].find(
    (l) => l.textContent?.trim() === label,
  );
  const input = found?.htmlFor
    ? element.querySelector(`#${found.htmlFor}`)
    : null;
  if (!(input instanceof HTMLInputElement)) throw new Error(`no ${label}`);
  return input;
}

function type(input: HTMLInputElement, value: string) {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

beforeEach(() => jest.mocked(toast).mockClear());

// @traces 139-FR-001
describe('the details panel', () => {
  it('shows each detail, a dash for what is missing, and who sees the phone', async () => {
    const { element } = await render();

    expect(element.querySelector('h2')?.textContent?.trim()).toBe(
      'Datele tale',
    );
    expect(rows(element)).toEqual([
      'Nume: Andrei Marin',
      'Telefon: —',
      'E‑mail: andrei@example.ro',
      'Oraș: —',
      'Parolă: Setată',
    ]);
    expect(element.textContent).toContain(
      'Service‑ul îți vede numărul doar după ce accepți oferta lui.',
    );
    expect(button(element, 'Modifică')).toBeDefined();
  });

  it('puts who sees the phone under the phone row', async () => {
    const { element } = await render();

    const phoneRow = [...element.querySelectorAll('dt')].find(
      (dt) => dt.textContent?.trim() === 'Telefon',
    )?.parentElement;
    expect(phoneRow?.textContent).toContain(
      'Service‑ul îți vede numărul doar după ce accepți oferta lui.',
    );
  });

  it('shows the phone and the city once saved', async () => {
    const { element } = await render({ city: 'Iași', phone: '+40722123456' });

    expect(rows(element)).toContain('Telefon: +40722123456');
    expect(rows(element)).toContain('Oraș: Iași');
  });

  it('speaks English', async () => {
    const { element } = await render({}, 'en');

    expect(element.querySelector('h2')?.textContent?.trim()).toBe(
      'Your details',
    );
    expect(rows(element).map((r) => r.split(':')[0])).toEqual([
      'Name',
      'Phone',
      'E-mail',
      'City',
      'Password',
    ]);
    expect(element.textContent).toContain(
      'A garage sees your number only after you accept its quote.',
    );
    expect(button(element, 'Edit')).toBeDefined();
  });

  it.each([
    ['at rest', {}, false],
    [
      'with an unconfirmed address and a pending change',
      { emailConfirmed: false, pendingEmail: 'nou@example.ro' },
      false,
    ],
    ['while editing', {}, true],
  ])(
    'keeps each row a term and its descriptions only, %s',
    async (_, me, editing) => {
      const { element } = await render(me as Partial<MeDto>);
      if (editing) {
        button(element, 'Modifică')?.click();
        await settle();
      }

      const children = [...element.querySelectorAll('dl > .row > *')].map(
        (child) => child.tagName,
      );
      expect(children.length).toBeGreaterThan(0);
      expect(children.filter((tag) => tag !== 'DT' && tag !== 'DD')).toEqual(
        [],
      );
    },
  );

  it('sets the row actions flush with the row and makes Modifică the primary button', async () => {
    const { element } = await render({ email: 'andrei@example.ro' });

    for (const name of [
      'Schimbă numărul',
      'Schimbă e‑mailul',
      'Schimbă parola',
    ])
      expect(button(element, name)?.classList).toContain('flush');
    expect(button(element, 'Modifică')?.classList).toContain(
      'spartan-button-variant-default',
    );
  });

  it('shows nothing before the session is known', async () => {
    const { element, fixture } = await render();
    current.set(null);
    await fixture.whenStable();

    expect(element.querySelector('section')).toBeNull();
  });
});

// @traces 139-FR-002
// @traces 139-FR-004
describe('editing the name and the city', () => {
  it('turns the two rows into labelled fields with Save and Cancel, the name focused', async () => {
    const { element } = await render({ city: 'Iași' });

    button(element, 'Modifică')?.click();
    await settle();

    const name = field(element, 'Nume');
    const city = field(element, 'Oraș');
    expect(name.value).toBe('Andrei Marin');
    expect(name.autocomplete).toBe('name');
    expect(city.value).toBe('Iași');
    expect(city.autocomplete).toBe('address-level2');
    expect(button(element, 'Salvează')).toBeDefined();
    expect(button(element, 'Renunță')).toBeDefined();
    expect(button(element, 'Modifică')).toBeUndefined();
    expect(document.activeElement).toBe(name);
  });

  it('saves both in one call, shows them at once and says so', async () => {
    const { element } = await render();
    button(element, 'Modifică')?.click();
    await settle();

    type(field(element, 'Nume'), '  Andrei M. ');
    type(field(element, 'Oraș'), ' Cluj-Napoca ');
    button(element, 'Salvează')?.click();
    await settle();

    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({
      body: { city: 'Cluj-Napoca', name: 'Andrei M.' },
    });
    expect(current()?.city).toBe('Cluj-Napoca');
    expect(rows(element)).toContain('Oraș: Cluj-Napoca');
    expect(rows(element)).toContain('Nume: Andrei M.');
    expect(toast).toHaveBeenCalledWith('Am salvat.');
    expect(document.activeElement).toBe(button(element, 'Modifică'));
  });

  it('sends no city when the field is left blank', async () => {
    const { element } = await render({ city: 'Iași' });
    button(element, 'Modifică')?.click();
    await settle();

    type(field(element, 'Oraș'), '   ');
    button(element, 'Salvează')?.click();
    await settle();

    expect(update).toHaveBeenCalledWith({
      body: { city: null, name: 'Andrei Marin' },
    });
    expect(rows(element)).toContain('Oraș: —');
  });

  it.each([
    ['a name of one letter', 'Nume', 'A', 'Scrie cel puțin 2 caractere.'],
    [
      'a name of 81 letters',
      'Nume',
      'A'.repeat(81),
      'Scrie cel mult 80 caractere.',
    ],
    ['a city of one letter', 'Oraș', 'C', 'Scrie cel puțin 2 caractere.'],
    [
      'a city of 61 letters',
      'Oraș',
      'C'.repeat(61),
      'Scrie cel mult 60 caractere.',
    ],
    [
      'a name with a hidden character',
      'Nume',
      'Andrei\u0007',
      'Folosește doar litere, cifre și semne obișnuite.',
    ],
  ])(
    'says what is wrong under the field for %s, and sends nothing',
    async (_, label, value, message) => {
      const { element } = await render();
      button(element, 'Modifică')?.click();
      await settle();

      const input = field(element, label);
      type(input, value);
      button(element, 'Salvează')?.click();
      await settle();

      expect(update).not.toHaveBeenCalled();
      const described = input.getAttribute('aria-describedby') ?? '';
      const shown = described
        .split(' ')
        .map((id) => element.querySelector(`#${id}`)?.textContent?.trim())
        .join(' ');
      expect(shown).toContain(message);
      expect(input.getAttribute('aria-invalid')).toBe('true');
    },
  );

  it('puts back what was saved on Cancel, sending nothing', async () => {
    const { element } = await render({ city: 'Iași' });
    button(element, 'Modifică')?.click();
    await settle();

    type(field(element, 'Nume'), 'Altcineva');
    type(field(element, 'Oraș'), 'Brașov');
    button(element, 'Renunță')?.click();
    await settle();

    expect(update).not.toHaveBeenCalled();
    expect(rows(element)).toContain('Nume: Andrei Marin');
    expect(rows(element)).toContain('Oraș: Iași');
    expect(document.activeElement).toBe(button(element, 'Modifică'));

    button(element, 'Modifică')?.click();
    await settle();
    expect(field(element, 'Nume').value).toBe('Andrei Marin');
  });

  it('keeps the fields and says why when the save fails', async () => {
    const { element } = await render({}, 'ro', async () => {
      throw new HttpErrorResponse({
        error: { code: 'account_suspended', status: 403 },
        status: 403,
      });
    });
    button(element, 'Modifică')?.click();
    await settle();

    type(field(element, 'Oraș'), 'Sibiu');
    button(element, 'Salvează')?.click();
    await settle();

    expect(field(element, 'Oraș').value).toBe('Sibiu');
    expect(element.querySelector('[role="alert"]')?.textContent).toContain(
      'Contul tău este suspendat.',
    );
    expect(toast).not.toHaveBeenCalled();
    expect(current()?.city).toBeNull();
  });
});

// @traces 139-FR-002
// @traces 139-FR-010
describe('the e-mail row', () => {
  it('opens the e-mail dialog and shows the pending address it answers', async () => {
    const { element } = await render();
    open.mockResolvedValueOnce({ pendingEmail: 'andrei.nou@exemplu.ro' });

    button(element, 'Schimbă e‑mailul')?.click();
    await settle();

    expect(open).toHaveBeenCalledWith(
      EmailChangeDialog,
      expect.objectContaining({ shape: 'dialog' }),
    );
    expect(current()?.pendingEmail).toBe('andrei.nou@exemplu.ro');
    expect(element.textContent).toContain(
      'În așteptarea confirmării: andrei.nou@exemplu.ro',
    );
  });

  it('keeps everything as it was when the dialog is cancelled', async () => {
    const { element } = await render();

    button(element, 'Schimbă e‑mailul')?.click();
    await settle();

    expect(current()?.pendingEmail).toBeNull();
    expect(element.textContent).not.toContain('În așteptarea confirmării');
  });

  it('shows no tag and no resend for a confirmed address with nothing pending', async () => {
    const { element } = await render();

    expect(element.textContent).not.toContain('Neconfirmat');
    expect(button(element, 'Trimite linkul din nou')).toBeUndefined();
  });

  it('tags an unconfirmed address and sends its link again', async () => {
    const { element } = await render({ emailConfirmed: false });

    expect(element.textContent).toContain('Neconfirmat');
    button(element, 'Trimite linkul din nou')?.click();
    await settle();

    expect(askAgain).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith('Am trimis linkul.');
  });

  // @traces 139-FR-010
  it('still tags an unconfirmed address while a change is pending', async () => {
    const { element } = await render({
      emailConfirmed: false,
      pendingEmail: 'andrei.nou@exemplu.ro',
    });

    expect(element.textContent).toContain('Neconfirmat');
    expect(element.textContent).toContain(
      'În așteptarea confirmării: andrei.nou@exemplu.ro',
    );
  });

  it('shows the pending address with its resend, and sends it again', async () => {
    const { element } = await render({ pendingEmail: 'andrei.nou@exemplu.ro' });

    expect(element.textContent).toContain(
      'În așteptarea confirmării: andrei.nou@exemplu.ro',
    );
    expect(element.textContent).not.toContain('Neconfirmat');
    button(element, 'Trimite linkul din nou')?.click();
    await settle();

    expect(askAgain).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith('Am trimis linkul.');
  });

  it('says why when the link cannot be sent again', async () => {
    const { element } = await render({ emailConfirmed: false });
    askAgain.mockRejectedValueOnce(
      new HttpErrorResponse({
        error: { code: 'too_many_attempts', status: 429 },
        status: 429,
      }),
    );

    button(element, 'Trimite linkul din nou')?.click();
    await settle();

    expect(toast).toHaveBeenCalledWith(
      'Prea multe încercări. Încearcă din nou mai târziu.',
    );
  });

  it('speaks English', async () => {
    const { element } = await render(
      { emailConfirmed: false, pendingEmail: 'andrei.nou@exemplu.ro' },
      'en',
    );

    expect(element.textContent).toContain(
      'Waiting for confirmation: andrei.nou@exemplu.ro',
    );
    expect(button(element, 'Send the link again')).toBeDefined();
    expect(button(element, 'Change e-mail')).toBeDefined();
  });

  it('tags an unconfirmed address in English', async () => {
    const { element } = await render({ emailConfirmed: false }, 'en');

    expect(element.textContent).toContain('Not confirmed');
  });
});

// @traces 139-FR-011
// @traces 139-FR-013
describe('the phone row', () => {
  it('opens the phone dialog and shows the confirmed number it answers, saying so', async () => {
    const { element } = await render({ phone: '+40711111111' });
    open.mockResolvedValueOnce({
      ...ANDREI,
      phone: '+40722123456',
      phoneConfirmed: true,
    });

    button(element, 'Schimbă numărul')?.click();
    await settle();

    expect(open).toHaveBeenCalledWith(
      PhoneChangeDialog,
      expect.objectContaining({ shape: 'dialog' }),
    );
    expect(current()?.phone).toBe('+40722123456');
    expect(rows(element)).toContain('Telefon: +40722123456');
    expect(toast).toHaveBeenCalledWith('Am schimbat numărul.');
  });

  it('keeps the number when the dialog is cancelled', async () => {
    const { element } = await render({ phone: '+40711111111' });

    button(element, 'Schimbă numărul')?.click();
    await settle();

    expect(current()?.phone).toBe('+40711111111');
    expect(toast).not.toHaveBeenCalled();
  });

  it('offers a number to an account with none, in English too', async () => {
    const { element } = await render({ phone: null }, 'en');

    expect(button(element, 'Change number')).toBeDefined();
  });
});

// @traces 139-FR-014
// @traces 139-FR-016
describe('the password row', () => {
  it('opens the change dialog for an account with a password and says the others were signed out', async () => {
    const { element } = await render();
    open.mockResolvedValueOnce('changed');

    button(element, 'Schimbă parola')?.click();
    await settle();

    expect(open).toHaveBeenCalledWith(PasswordChangeDialog, {
      data: { hasPassword: true },
      shape: 'dialog',
      title: 'driver.passwordChange.title',
    });
    expect(toast).toHaveBeenCalledWith(
      'Parola a fost schimbată. Celelalte dispozitive au fost deconectate.',
    );
  });

  it('says nothing when the dialog is cancelled', async () => {
    const { element } = await render();

    button(element, 'Schimbă parola')?.click();
    await settle();

    expect(toast).not.toHaveBeenCalled();
  });

  it('offers "Setează o parolă" to an account with an e-mail and no password, and marks the account as having one after', async () => {
    const { element } = await render({ hasPassword: false });
    expect(rows(element)).toContain('Parolă: Nesetată');
    open.mockResolvedValueOnce('changed');

    button(element, 'Setează o parolă')?.click();
    await settle();

    expect(open).toHaveBeenCalledWith(PasswordChangeDialog, {
      data: { hasPassword: false },
      shape: 'dialog',
      title: 'driver.passwordChange.setTitle',
    });
    expect(current()?.hasPassword).toBe(true);
    expect(toast).toHaveBeenCalledWith(
      'Parola a fost setată. Celelalte dispozitive au fost deconectate.',
    );
    expect(button(element, 'Schimbă parola')).toBeDefined();
  });

  it('opens the sign-in when asked to sign in again, then the dialog once more', async () => {
    const { element } = await render({ hasPassword: false });
    open.mockResolvedValueOnce('sign-in').mockResolvedValueOnce('changed');

    button(element, 'Setează o parolă')?.click();
    await settle();

    expect(gate).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledTimes(2);
    expect(current()?.hasPassword).toBe(true);
  });

  it('does not open the dialog again when the sign-in is closed', async () => {
    const { element } = await render({ hasPassword: false });
    open.mockResolvedValueOnce('sign-in');
    gate.mockResolvedValueOnce(false);

    button(element, 'Setează o parolă')?.click();
    await settle();

    expect(open).toHaveBeenCalledTimes(1);
    expect(current()?.hasPassword).toBe(false);
  });

  it('does not offer a password to an account with no e-mail and none', async () => {
    const { element } = await render({ email: null, hasPassword: false });

    expect(button(element, 'Setează o parolă')).toBeUndefined();
    expect(button(element, 'Schimbă parola')).toBeUndefined();
  });

  it('speaks English', async () => {
    const { element } = await render({ hasPassword: false }, 'en');

    expect(rows(element)).toContain('Password: Not set');
    expect(button(element, 'Set a password')).toBeDefined();
  });
});
