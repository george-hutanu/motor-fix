import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { I18n, TranslatePipe } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';

import { openCookieSettings } from '../../consent/cookie-settings/open-cookie-settings';
import { SignInDialog } from '../../sign-in/sign-in-dialog';

// Under every public page: the wordmark and the three ways in (find a
// mechanic, list a garage, sign in), then one line of the legal texts, the
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

  protected settings() {
    void openCookieSettings(this.overlays);
  }
}
