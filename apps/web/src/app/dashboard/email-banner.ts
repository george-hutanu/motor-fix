import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { MeService } from '@motor-fix/data-access';
import { I18n, TranslatePipe } from '@motor-fix/i18n';
import { HlmButton, toast } from '@motor-fix/ui-cockpit';

import { Session } from './session';
import { httpStatus } from '../http-status';

// Shown on every dashboard while the account's e-mail is not confirmed.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmButton, TranslatePipe],
  selector: 'mf-email-banner',
  styles: `
    :host { display: block; }
    [role='status'] { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--mf-space-2) var(--mf-space-3); margin: 0 var(--mf-space-4) var(--mf-space-3); padding: var(--mf-space-3) var(--mf-space-4); border: 1px solid var(--mf-amber-ink); border-radius: var(--mf-radius-md, 12px); }
    p { margin: 0; min-width: 0; overflow-wrap: anywhere; }
    button { white-space: normal; }
  `,
  template: `
    @if (shown()) {
      <div role="status">
        <p>{{ 'shell.emailBanner.text' | t }}</p>
        <button hlmBtn variant="secondary" type="button" [disabled]="busy()" (click)="askAgain()">
          {{ 'shell.emailBanner.resend' | t }}
        </button>
      </div>
    }
  `,
})
export class EmailBanner {
  private readonly session = inject(Session);
  private readonly me = inject(MeService);
  private readonly i18n = inject(I18n);
  protected readonly busy = signal(false);
  protected readonly shown = computed(() => {
    const account = this.session.current();
    return Boolean(account?.email && !account.emailConfirmed);
  });

  protected async askAgain() {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      await this.me.meEmailConfirmationControllerAskAgain();
      toast(this.i18n.t('shell.emailBanner.sent'));
    } catch (error) {
      const code = httpStatus(error);
      // Confirmed meanwhile, in another tab or on another device.
      if (code === 409) await this.session.reload();
      else if (code === 429) toast(this.i18n.t('shell.emailBanner.tooMany'));
      else toast(this.i18n.t('shell.emailBanner.failed'));
    } finally {
      this.busy.set(false);
    }
  }
}
