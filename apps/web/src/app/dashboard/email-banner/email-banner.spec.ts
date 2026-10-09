import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { type MeDto, MeService } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { toast } from '@motor-fix/ui-cockpit';

import { EmailBanner } from './email-banner';
import { Session } from '../session';

jest.mock('@motor-fix/ui-cockpit', () => ({
  ...jest.requireActual('@motor-fix/ui-cockpit'),
  toast: jest.fn(),
}));

const account = (overrides: Partial<MeDto> = {}) =>
  ({
    capabilities: [],
    email: 'andrei@example.test',
    emailConfirmed: false,
    garageAccess: [],
    garageId: null,
    id: 'account-1',
    landing: '/app/driver',
    language: 'ro',
    name: 'Andrei Marin',
    role: 'driver',
    roles: ['driver'],
    ...overrides,
  }) as MeDto;

const problem = (status: number, code: string) =>
  new HttpErrorResponse({ error: { code, status }, status });

let askAgain: jest.Mock;
let reload: jest.Mock;

async function render(me: MeDto | null, language: 'ro' | 'en' = 'ro') {
  askAgain = jest.fn(async () => undefined);
  reload = jest.fn(async () => undefined);
  const current = signal<MeDto | null>(me);
  TestBed.configureTestingModule({
    providers: [
      { provide: Session, useValue: { current, reload } },
      {
        provide: MeService,
        useValue: { meEmailConfirmationControllerAskAgain: askAgain },
      },
    ],
  });
  if (language === 'en') await TestBed.inject(I18n).use('en');
  const fixture = TestBed.createComponent(EmailBanner);
  fixture.detectChanges();
  await fixture.whenStable();
  const element = fixture.nativeElement as HTMLElement;
  return { current, element, fixture };
}

const resend = (element: HTMLElement) =>
  [...element.querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === 'Retrimite',
  );

async function press(
  fixture: Awaited<ReturnType<typeof render>>['fixture'],
  button: HTMLButtonElement | undefined,
) {
  button?.click();
  for (let i = 0; i < 4; i++) {
    fixture.detectChanges();
    await fixture.whenStable();
  }
}

beforeEach(() => jest.mocked(toast).mockClear());

describe('EmailBanner', () => {
  it('asks an account with an unconfirmed e-mail to confirm it', async () => {
    const { element } = await render(account());

    const banner = element.querySelector('[role="status"]');
    expect(banner?.textContent).toContain('Confirmă‑ți adresa de e‑mail');
    expect(resend(element)).toBeDefined();
  });

  it('speaks English to an English account', async () => {
    const { element } = await render(account({ language: 'en' }), 'en');

    expect(element.textContent).toContain('Confirm your e-mail address');
    expect(
      [...element.querySelectorAll('button')].map((b) => b.textContent?.trim()),
    ).toEqual(['Send again']);
  });

  it('shows nothing once the e-mail is confirmed', async () => {
    const { element } = await render(account({ emailConfirmed: true }));

    expect(element.textContent?.trim()).toBe('');
  });

  it('shows nothing to an account with no e-mail', async () => {
    const { element } = await render(account({ email: null }));

    expect(element.textContent?.trim()).toBe('');
  });

  it('shows nothing signed out', async () => {
    const { element } = await render(null);

    expect(element.textContent?.trim()).toBe('');
  });

  it('disappears when the account becomes confirmed', async () => {
    const { current, element, fixture } = await render(account());

    current.set(account({ emailConfirmed: true }));
    fixture.detectChanges();

    expect(element.querySelector('[role="status"]')).toBeNull();
  });

  it('sends a new link and says so', async () => {
    const { element, fixture } = await render(account());

    await press(fixture, resend(element));

    expect(askAgain).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith('Am trimis un link nou pe e‑mail.');
  });

  it('asks to wait when links were asked too often', async () => {
    const { element, fixture } = await render(account());
    askAgain.mockRejectedValueOnce(problem(429, 'too_many_attempts'));

    await press(fixture, resend(element));

    expect(toast).toHaveBeenCalledWith(
      'Ai cerut deja un link. Încearcă din nou puțin mai târziu.',
    );
  });

  it('says when the link could not be sent', async () => {
    const { element, fixture } = await render(account());
    askAgain.mockRejectedValueOnce(new HttpErrorResponse({ status: 0 }));

    await press(fixture, resend(element));

    expect(toast).toHaveBeenCalledWith(
      'Nu am putut trimite linkul. Încearcă din nou.',
    );
  });

  it('reads the account again when it was confirmed meanwhile', async () => {
    const { element, fixture } = await render(account());
    askAgain.mockRejectedValueOnce(problem(409, 'email_already_confirmed'));

    await press(fixture, resend(element));

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('sends one ask at a time', async () => {
    const { element, fixture } = await render(account());
    let finish: () => void = () => undefined;
    askAgain.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );

    resend(element)?.click();
    fixture.detectChanges();
    resend(element)?.click();
    finish();
    await press(fixture, undefined);

    expect(askAgain).toHaveBeenCalledTimes(1);
  });
});
