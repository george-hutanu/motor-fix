import { Component, inject, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AuthService } from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';

import { ProviderButtons, Providers } from './providers';
import { Session } from '../dashboard/session';

@Component({
  imports: [ProviderButtons],
  template:
    '<mf-provider-buttons [remember]="remember()" [returnTo]="returnTo()" />',
})
class Host {
  readonly remember = signal(true);
  readonly returnTo = signal<string | null>(null);
  readonly providers = inject(Providers);
}

async function setup(
  enabled: { apple: boolean; google: boolean } | Error,
  language: 'ro' | 'en' = 'ro',
) {
  const oauthControllerProviders = jest.fn(async () => {
    if (enabled instanceof Error) throw enabled;
    return enabled;
  });
  const leaveFor = jest.fn(() => new Promise<void>(() => undefined));
  TestBed.configureTestingModule({
    providers: [
      { provide: AuthService, useValue: { oauthControllerProviders } },
      { provide: Session, useValue: { leaveFor } },
    ],
  });
  if (language === 'en') await TestBed.inject(I18n).use('en');
  await TestBed.inject(I18n).enter('public');
  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  for (let i = 0; i < 4; i++) {
    await new Promise((r) => setTimeout(r));
    fixture.detectChanges();
  }
  const el = fixture.nativeElement as HTMLElement;
  return { el, fixture, leaveFor, oauthControllerProviders };
}

const buttons = (el: HTMLElement) =>
  [...el.querySelectorAll('mf-provider-buttons button')].map((b) =>
    b.textContent?.trim(),
  );

describe('the provider buttons', () => {
  it('shows Apple then Google, under an "or" divider, when both are configured', async () => {
    const { el } = await setup({ apple: true, google: true });

    expect(buttons(el)).toEqual(['Continuă cu Apple', 'Continuă cu Google']);
    expect(el.querySelector('mf-provider-buttons')?.textContent).toContain(
      'sau',
    );
  });

  it('speaks English in English', async () => {
    const { el } = await setup({ apple: true, google: true }, 'en');

    expect(buttons(el)).toEqual([
      'Continue with Apple',
      'Continue with Google',
    ]);
  });

  it('hides the button of a provider that is not configured', async () => {
    const { el } = await setup({ apple: false, google: true });

    expect(buttons(el)).toEqual(['Continuă cu Google']);
  });

  it('shows nothing, not even the divider, when neither is configured or the answer fails', async () => {
    for (const answer of [{ apple: false, google: false }, new Error('down')]) {
      const { el } = await setup(answer);
      expect(el.querySelector('mf-provider-buttons')?.textContent?.trim()).toBe(
        '',
      );
      TestBed.resetTestingModule();
    }
  });

  it('asks the server once, however many times the buttons are shown', async () => {
    const { fixture, oauthControllerProviders } = await setup({
      apple: true,
      google: true,
    });

    await fixture.componentInstance.providers.load();
    await fixture.componentInstance.providers.load();

    expect(oauthControllerProviders).toHaveBeenCalledTimes(1);
  });

  it('leaves for the provider with the remember choice and the language, and holds both buttons while it goes', async () => {
    const { el, fixture, leaveFor } = await setup(
      { apple: true, google: true },
      'en',
    );
    fixture.componentInstance.remember.set(false);
    fixture.componentInstance.returnTo.set('/en/garages');
    fixture.detectChanges();

    el.querySelectorAll<HTMLButtonElement>(
      'mf-provider-buttons button',
    )[1].click();
    fixture.detectChanges();

    expect(leaveFor).toHaveBeenCalledWith('google', {
      language: 'en',
      remember: false,
      returnTo: '/en/garages',
    });
    const all = [
      ...el.querySelectorAll<HTMLButtonElement>('mf-provider-buttons button'),
    ];
    expect(all.every((b) => b.disabled)).toBe(true);
  });

  it('makes each mark a picture screen readers skip, inside a plain button', async () => {
    const { el } = await setup({ apple: true, google: true });

    for (const button of el.querySelectorAll('mf-provider-buttons button')) {
      expect(button.getAttribute('type')).toBe('button');
      expect(button.querySelector('svg')?.getAttribute('aria-hidden')).toBe(
        'true',
      );
    }
  });
});
