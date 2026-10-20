import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { I18n, TranslatePipe } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';

import { openCookieSettings } from '../../consent/cookie-settings/open-cookie-settings';
import { Session } from '../../dashboard/session';
import { SignInDialog } from '../../sign-in/sign-in-dialog';

// Under every public page: the wordmark and the three ways in (find a
// mechanic, list a garage, sign in, or the account once the visit knows the
// session), then one line of the legal texts, the
// cookie settings and the contact page.
@Component({
  imports: [RouterLink, TranslatePipe],
  selector: 'mf-public-footer',
  styleUrl: './footer.css',
  templateUrl: './footer.html',
})
export class PublicFooter {
  private readonly overlays = inject(Overlays);
  protected readonly i18n = inject(I18n);
  protected readonly signIn = inject(SignInDialog);
  private readonly session = inject(Session).current;
  protected readonly signedIn = computed(() => this.session() !== null);

  protected settings() {
    void openCookieSettings(this.overlays);
  }
}
