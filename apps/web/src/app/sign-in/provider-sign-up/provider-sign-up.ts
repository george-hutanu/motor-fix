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

import { Session } from '../../dashboard/session';
import { Consent, consentControl } from '../consent/consent';
import { PROVIDER_NAME } from '../providers/providers';
import type { AuthSwitch } from '../sign-in';
import { characters } from '../sign-up/sign-up';

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
  styleUrl: './provider-sign-up.css',
  templateUrl: './provider-sign-up.html',
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
