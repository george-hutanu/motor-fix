import { isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  type OnInit,
  PLATFORM_ID,
  signal,
} from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { AuthService } from '@motor-fix/data-access';
import { I18n, TranslatePipe } from '@motor-fix/i18n';
import { HlmButton } from '@motor-fix/ui-cockpit';

import { Session } from '../../dashboard/session';
import { httpStatus } from '../../http-status';

type State = 'confirming' | 'confirmed' | 'expired' | 'taken' | 'error';
type Asked = 'sending' | 'sent' | 'tooMany' | 'failed' | 'refused';

// Opened from the confirmation e-mail; no sign-in needed. On the server it
// only renders the busy state: the link is spent in the browser.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmButton, RouterLink, TranslatePipe],
  selector: 'mf-confirm-email',
  styleUrl: './confirm-email.css',
  templateUrl: './confirm-email.html',
})
export class ConfirmEmail implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly session = inject(Session);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  protected readonly i18n = inject(I18n);
  private readonly token: string =
    inject(ActivatedRoute).snapshot.paramMap.get('token') ?? '';
  protected readonly state = signal<State>('confirming');
  protected readonly asked = signal<Asked | null>(null);

  ngOnInit() {
    if (this.browser) void this.confirm();
  }

  protected async confirm() {
    this.state.set('confirming');
    try {
      await this.auth.emailConfirmationControllerConfirm({
        body: { token: this.token },
      });
      this.confirmed();
    } catch (error) {
      const code = httpStatus(error);
      // 400: a link cut short or mistyped is as spent as an expired one.
      // 409: the address a change asked for was taken meanwhile.
      this.state.set(
        code === 410 || code === 400
          ? 'expired'
          : code === 409
            ? 'taken'
            : 'error',
      );
    }
  }

  protected async askAgain() {
    if (this.asked() === 'sending') return;
    this.asked.set('sending');
    try {
      await this.auth.emailConfirmationControllerResend({
        body: { token: this.token },
      });
      this.asked.set('sent');
    } catch (error) {
      const code = httpStatus(error);
      if (code === 409) this.confirmed();
      else if (code === 429) this.asked.set('tooMany');
      else if (code === 410 || code === 400) this.asked.set('refused');
      else this.asked.set('failed');
    }
  }

  private confirmed() {
    this.state.set('confirmed');
    // This tab's own dashboard, if it is signed in, drops its banner.
    if (this.session.current()) void this.session.reload();
  }
}
