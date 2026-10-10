import { HttpErrorResponse } from '@angular/common/http';
import { PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { AuthService, type MeDto } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';

import { ConfirmEmail } from './confirm-email';
import { Session } from '../../dashboard/session';

const TOKEN = 'A'.repeat(43);

const problem = (status: number, code: string) =>
  new HttpErrorResponse({ error: { code, status }, status });

let confirm: jest.Mock;
let resend: jest.Mock;
let reload: jest.Mock;

async function open(
  options: {
    language?: 'ro' | 'en';
    platform?: 'browser' | 'server';
    signedIn?: boolean;
  } = {},
) {
  confirm ??= jest.fn(async () => ({ status: 'confirmed' }));
  resend ??= jest.fn(async () => undefined);
  reload = jest.fn(async () => undefined);
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        { component: ConfirmEmail, path: ':lang/confirm-email/:token' },
      ]),
      {
        provide: AuthService,
        useValue: {
          emailConfirmationControllerConfirm: confirm,
          emailConfirmationControllerResend: resend,
        },
      },
      {
        provide: Session,
        useValue: {
          current: signal(
            options.signedIn ? ({ id: 'account-1' } as MeDto) : null,
          ),
          reload,
        },
      },
      { provide: PLATFORM_ID, useValue: options.platform ?? 'browser' },
    ],
  });
  const i18n = TestBed.inject(I18n);
  await i18n.enter('public');
  if (options.language === 'en') await i18n.use('en');
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(
    `/${options.language ?? 'ro'}/confirm-email/${TOKEN}`,
  );
  await settle(harness);
  return harness;
}

async function settle(harness: RouterTestingHarness) {
  for (let i = 0; i < 4; i++) {
    harness.detectChanges();
    await harness.fixture.whenStable();
  }
}

const text = (harness: RouterTestingHarness) =>
  (harness.routeNativeElement?.textContent ?? '').replace(/\s+/g, ' ').trim();

const button = (harness: RouterTestingHarness, name: string) =>
  [...(harness.routeNativeElement?.querySelectorAll('button') ?? [])].find(
    (b) => b.textContent?.trim() === name,
  );

beforeEach(() => {
  confirm = undefined as unknown as jest.Mock;
  resend = undefined as unknown as jest.Mock;
});

describe('ConfirmEmail', () => {
  it('confirms the address the link was made for and says so', async () => {
    const harness = await open();

    expect(confirm).toHaveBeenCalledWith({ body: { token: TOKEN } });
    expect(text(harness)).toContain('Adresa ta de e‑mail este confirmată.');
    expect(
      harness.routeNativeElement?.querySelector('a')?.getAttribute('href'),
    ).toBe('/ro');
  });

  it('says it in English on the English address', async () => {
    const harness = await open({ language: 'en' });

    expect(text(harness)).toContain('Your e-mail address is confirmed.');
  });

  it('reads the signed-in account again, so its banner goes', async () => {
    await open({ signedIn: true });

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('shows the busy state until the answer arrives', async () => {
    confirm = jest.fn(() => new Promise(() => undefined));
    const harness = await open();

    expect(text(harness)).toContain('Confirmăm adresa…');
    expect(
      harness.routeNativeElement?.querySelector('[aria-busy="true"]'),
    ).not.toBeNull();
  });

  it('does not confirm while rendered on the server', async () => {
    const harness = await open({ platform: 'server' });

    expect(confirm).not.toHaveBeenCalled();
    expect(text(harness)).toContain('Confirmăm adresa…');
  });

  it.each([
    [410, 'link_expired'],
    [400, 'validation_failed'],
  ])('offers a new link when the link is spent (%s)', async (status, code) => {
    confirm = jest.fn(async () => {
      throw problem(status, code);
    });
    const harness = await open();

    expect(text(harness)).toContain('Linkul a expirat');
    expect(button(harness, 'Trimite un link nou')).toBeDefined();
  });

  it('sends a new link from the expired page', async () => {
    confirm = jest.fn(async () => {
      throw problem(410, 'link_expired');
    });
    const harness = await open();

    button(harness, 'Trimite un link nou')?.click();
    await settle(harness);

    expect(resend).toHaveBeenCalledWith({ body: { token: TOKEN } });
    expect(text(harness)).toContain('Am trimis un link nou pe e‑mail.');
  });

  it('says the address is confirmed when a new link is no longer needed', async () => {
    confirm = jest.fn(async () => {
      throw problem(410, 'link_expired');
    });
    resend = jest.fn(async () => {
      throw problem(409, 'email_already_confirmed');
    });
    const harness = await open();

    button(harness, 'Trimite un link nou')?.click();
    await settle(harness);

    expect(text(harness)).toContain('Adresa ta de e‑mail este confirmată.');
  });

  it('asks to wait when links were asked too often', async () => {
    confirm = jest.fn(async () => {
      throw problem(410, 'link_expired');
    });
    resend = jest.fn(async () => {
      throw problem(429, 'too_many_attempts');
    });
    const harness = await open();

    button(harness, 'Trimite un link nou')?.click();
    await settle(harness);

    expect(text(harness)).toContain(
      'Prea multe încercări. Încearcă din nou mai târziu.',
    );
    expect(button(harness, 'Trimite un link nou')).toBeDefined();
  });

  it('points to the account when this link cannot ask for a new one', async () => {
    confirm = jest.fn(async () => {
      throw problem(410, 'link_expired');
    });
    resend = jest.fn(async () => {
      throw problem(410, 'link_expired');
    });
    const harness = await open();

    button(harness, 'Trimite un link nou')?.click();
    await settle(harness);

    expect(text(harness)).toContain(
      'Din acest link nu mai putem trimite altul. Intră în cont și cere un link nou de acolo.',
    );
    expect(button(harness, 'Trimite un link nou')).toBeUndefined();
  });

  it('offers to try again when the confirmation could not be done', async () => {
    confirm = jest
      .fn()
      .mockRejectedValueOnce(new HttpErrorResponse({ status: 0 }))
      .mockResolvedValueOnce({ status: 'confirmed' });
    const harness = await open();

    expect(text(harness)).toContain('Nu am putut confirma adresa acum.');
    button(harness, 'Încearcă din nou')?.click();
    await settle(harness);

    expect(confirm).toHaveBeenCalledTimes(2);
    expect(text(harness)).toContain('Adresa ta de e‑mail este confirmată.');
  });

  it('says when the new link could not be sent', async () => {
    confirm = jest.fn(async () => {
      throw problem(410, 'link_expired');
    });
    resend = jest.fn(async () => {
      throw new HttpErrorResponse({ status: 503 });
    });
    const harness = await open();

    button(harness, 'Trimite un link nou')?.click();
    await settle(harness);

    expect(text(harness)).toContain(
      'Nu am putut trimite linkul. Încearcă din nou.',
    );
    expect(button(harness, 'Trimite un link nou')).toBeDefined();
  });
});

// @traces 139-FR-008
describe('the link of an e-mail change whose address was taken', () => {
  it('says another account uses the address and offers no new link', async () => {
    confirm = jest.fn(async () => {
      throw problem(409, 'email_taken');
    });

    const harness = await open();

    expect(text(harness)).toContain('Adresa e folosită de alt cont.');
    expect(text(harness)).toContain(
      'Alt cont MotorFix folosește acum această adresă',
    );
    expect(button(harness, 'Trimite un link nou')).toBeUndefined();
    expect(resend).not.toHaveBeenCalled();
  });

  // @traces 139-FR-009
  it('says the address is taken when a new link finds it taken meanwhile', async () => {
    confirm = jest.fn(async () => {
      throw problem(410, 'link_expired');
    });
    resend = jest.fn(async () => {
      throw problem(409, 'email_taken');
    });
    const harness = await open();

    button(harness, 'Trimite un link nou')?.click();
    await settle(harness);

    expect(text(harness)).toContain('Adresa e folosită de alt cont.');
    expect(text(harness)).not.toContain('Adresa ta de e‑mail este confirmată.');
  });

  it('says it in English on the English address', async () => {
    confirm = jest.fn(async () => {
      throw problem(409, 'email_taken');
    });

    const harness = await open({ language: 'en' });

    expect(
      harness.routeNativeElement?.querySelector('h1')?.textContent?.trim(),
    ).toBe('The address is used by another account.');
  });
});

// @traces 139-FR-009
describe('the expired page of either kind of link', () => {
  // The answer does not say which kind the link was, so the line names both
  // lifetimes: 72 hours from sign-up, 24 hours for a change of address.
  it.each([
    [
      'ro',
      'Un link de confirmare merge o singură dată: 72 de ore după înregistrare, 24 de ore când îți schimbi adresa.',
    ],
    [
      'en',
      'A confirmation link works once: for 72 hours after sign-up, or 24 hours when you change your address.',
    ],
  ] as const)('states both lifetimes (%s)', async (language, line) => {
    confirm = jest.fn(async () => {
      throw problem(410, 'link_expired');
    });

    const harness = await open({ language });

    expect(text(harness)).toContain(line);
  });
});
