import {
  ChangeDetectionStrategy,
  Component,
  inject,
  type OnInit,
  signal,
} from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import type { OAuthPendingDto } from '@motor-fix/data-access';
import { I18n, TranslatePipe } from '@motor-fix/i18n';
import {
  FieldError,
  injectOverlayTask,
  TaskError,
  TaskSubmit,
  taskSave,
} from '@motor-fix/overlays';
import { HlmButton, HlmInput } from '@motor-fix/ui-cockpit';

import { Consent, consentControl } from './consent';
import { PROVIDER_NAME } from './providers';
import type { AuthSwitch } from './sign-in';
import { characters } from './sign-up';
import { Session } from '../dashboard/session';

// A person the provider vouched for, with no account yet: the name, and the
// tick on the terms, before the account exists. Nothing waiting (the step
// expired, or another tab finished it) sends them back to sign-in.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    Consent,
    FieldError,
    HlmButton,
    HlmInput,
    ReactiveFormsModule,
    TaskError,
    TaskSubmit,
    TranslatePipe,
  ],
  selector: 'mf-provider-sign-up',
  styles: `
    form, .expired { display: grid; gap: var(--mf-space-4); }
    p { margin: 0; overflow-wrap: anywhere; }
    .intro { color: var(--mf-text-secondary); }
    .field { display: grid; gap: var(--mf-space-2); }
    label { font-weight: 700; }
    button { width: 100%; min-height: 54px; white-space: normal; }
  `,
  template: `
    @switch (pending()) {
      @case (undefined) {
        <p aria-busy="true"></p>
      }
      @case (null) {
        <div class="expired">
          <p>{{ 'public.providerSignUp.expired' | t }}</p>
          <button hlmBtn type="button" (click)="signIn()">{{ 'public.providerSignUp.signIn' | t }}</button>
        </div>
      }
      @default {
        <form [formGroup]="form" (ngSubmit)="save.submit()" novalidate>
          <p class="intro">{{ 'public.providerSignUp.intro' | t: { provider: providerName() } }}</p>
          @if (pending()?.email; as email) {
            <p>{{ 'public.providerSignUp.email' | t: { email } }}</p>
          }
          <div class="field">
            <label for="mf-provider-sign-up-name">{{ 'public.providerSignUp.name' | t }}</label>
            <input
              hlmInput
              id="mf-provider-sign-up-name"
              type="text"
              autocomplete="name"
              formControlName="name"
              aria-describedby="mf-provider-sign-up-name-error"
            />
            <mf-field-error id="mf-provider-sign-up-name-error" [save]="save" [control]="form.controls.name" />
          </div>
          <mf-consent [control]="form.controls.consent" [save]="save" />
          <mf-task-error [save]="save" />
          <button hlmBtn type="submit" [mfTaskSubmit]="save">{{ 'public.providerSignUp.submit' | t }}</button>
          <button hlmBtn variant="ghost" type="button" [disabled]="save.state() === 'sending'" (click)="cancel()">
            {{ 'public.providerSignUp.cancel' | t }}
          </button>
        </form>
      }
    }
  `,
})
export class ProviderSignUp implements OnInit {
  private readonly session = inject(Session);
  private readonly i18n = inject(I18n);
  private readonly task = injectOverlayTask<
    undefined,
    'signed-in' | AuthSwitch | 'cancelled'
  >();

  // undefined while it is asked for, null when nothing waits.
  protected readonly pending = signal<OAuthPendingDto | null | undefined>(
    undefined,
  );

  protected readonly form = new FormGroup({
    consent: consentControl(),
    name: new FormControl('', {
      nonNullable: true,
      validators: [characters(2, 80, true)],
    }),
  });

  protected readonly save = taskSave({
    done: () => this.task.close('signed-in'),
    form: this.form,
    messages: 'public.providerSignUp',
    send: async ({ name = '' }) => {
      const me = await this.session.completeProviderSignUp(
        name.trim(),
        this.i18n.language(),
      );
      if (!me) throw new Error('signed up without an account');
      return me;
    },
  });

  constructor() {
    void this.i18n.enter('public');
  }

  async ngOnInit() {
    const pending = await this.session.providerPending();
    if (pending) this.form.controls.name.setValue(pending.name);
    this.pending.set(pending);
  }

  protected providerName() {
    const provider = this.pending()?.provider;
    return provider ? PROVIDER_NAME[provider] : '';
  }

  protected signIn() {
    this.task.close({ email: '', switchTo: 'sign-in' });
  }

  protected cancel() {
    this.task.close('cancelled');
  }
}
