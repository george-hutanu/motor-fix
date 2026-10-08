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

import { httpStatus } from '../../http-status';
import { Session } from '../session';

// Shown on every dashboard while the account's e-mail is not confirmed.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmButton, TranslatePipe],
  selector: 'mf-email-banner',
  styleUrl: './email-banner.css',
  templateUrl: './email-banner.html',
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
