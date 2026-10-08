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

import { type Provider, Session } from '../../dashboard/session';

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
  styleUrl: './providers.css',
  templateUrl: './providers.html',
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
