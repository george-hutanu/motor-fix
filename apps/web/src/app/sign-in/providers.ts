import {
  ChangeDetectionStrategy,
  Component,
  Injectable,
  Injector,
  inject,
  input,
  type OnInit,
  signal,
} from '@angular/core';
import { AuthService } from '@motor-fix/data-access';
import { I18n, TranslatePipe } from '@motor-fix/i18n';
import { HlmButton } from '@motor-fix/ui-cockpit';

import { type Provider, Session } from '../dashboard/session';

type Enabled = Record<Provider, boolean>;

export const PROVIDER_NAME = { apple: 'Apple', google: 'Google' } as const;

const NONE: Enabled = { apple: false, google: false };

// Which providers the server has keys for, asked once per page. Any failure
// reads as none: e-mail sign-in is always there.
@Injectable({ providedIn: 'root' })
export class Providers {
  private readonly injector = inject(Injector);
  private asked: Promise<Enabled> | null = null;

  load(): Promise<Enabled> {
    this.asked ??= this.ask();
    return this.asked;
  }

  private async ask(): Promise<Enabled> {
    try {
      const { apple, google } = await this.injector
        .get(AuthService)
        .oauthControllerProviders();
      return { apple: apple === true, google: google === true };
    } catch {
      return NONE;
    }
  }
}

// "or", then a button per configured provider, Apple first. A tap leaves the
// page for the provider; the buttons stay held until it has gone.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmButton, TranslatePipe],
  selector: 'mf-provider-buttons',
  styles: `
    :host { display: grid; gap: var(--mf-space-3); }
    :host:empty { display: none; }
    .or { display: flex; align-items: center; gap: var(--mf-space-3); margin: 0; color: var(--mf-text-secondary); }
    .or::before, .or::after { content: ''; flex: 1; border-top: 1px solid var(--mf-line); }
    button { display: flex; align-items: center; justify-content: center; gap: var(--mf-space-3); width: 100%; min-height: 50px; border: 1px solid var(--mf-line-strong); white-space: normal; }
    svg { flex: none; width: 20px; height: 20px; }
  `,
  template: `
    @if (enabled().apple || enabled().google) {
      <p class="or">{{ 'public.providers.or' | t }}</p>
      @if (enabled().apple) {
        <button hlmBtn variant="ghost" type="button" [disabled]="leaving()" (click)="go('apple')">
          <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
            <path d="M16.37 12.6c-.02-2.2 1.8-3.26 1.88-3.31-1.03-1.5-2.62-1.7-3.18-1.73-1.35-.14-2.64.8-3.33.8-.69 0-1.74-.78-2.86-.76-1.47.02-2.83.86-3.59 2.17-1.53 2.66-.39 6.6 1.1 8.76.73 1.06 1.6 2.24 2.73 2.2 1.1-.05 1.51-.71 2.84-.71 1.32 0 1.7.71 2.86.69 1.18-.02 1.93-1.08 2.65-2.14.84-1.22 1.18-2.41 1.2-2.47-.03-.01-2.28-.88-2.3-3.5zM14.2 6.13c.6-.73 1.01-1.75.9-2.76-.87.04-1.92.58-2.55 1.31-.56.65-1.05 1.68-.92 2.67.97.08 1.96-.49 2.57-1.22z" />
          </svg>
          <span>{{ 'public.providers.apple' | t }}</span>
        </button>
      }
      @if (enabled().google) {
        <button hlmBtn variant="ghost" type="button" [disabled]="leaving()" (click)="go('google')">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <use href="/marks/google.svg#g" />
          </svg>
          <span>{{ 'public.providers.google' | t }}</span>
        </button>
      }
    }
  `,
})
export class ProviderButtons implements OnInit {
  // Sign-in's "keep me signed in"; sign-up always keeps.
  readonly remember = input(true);
  // The screen to come back to, when an action asked for the sign-in.
  readonly returnTo = input<string | null>(null);

  private readonly providers = inject(Providers);
  private readonly session = inject(Session);
  private readonly i18n = inject(I18n);
  protected readonly enabled = signal<Enabled>(NONE);
  protected readonly leaving = signal(false);

  constructor() {
    void this.i18n.enter('public');
  }

  ngOnInit() {
    void this.providers.load().then((enabled) => this.enabled.set(enabled));
  }

  protected go(provider: Provider) {
    this.leaving.set(true);
    this.session
      .leaveFor(provider, {
        language: this.i18n.language(),
        remember: this.remember(),
        returnTo: this.returnTo(),
      })
      .catch(() => this.leaving.set(false));
  }
}
