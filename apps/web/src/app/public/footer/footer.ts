import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { I18n, TranslatePipe } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';

import { openCookieSettings } from '../../consent/cookie-settings/open-cookie-settings';

// One line under every public page: the legal texts and the cookie settings.
@Component({
  imports: [RouterLink, TranslatePipe],
  selector: 'mf-public-footer',
  styleUrl: './footer.css',
  templateUrl: './footer.html',
})
export class PublicFooter {
  private readonly overlays = inject(Overlays);
  protected readonly i18n = inject(I18n);

  protected settings() {
    void openCookieSettings(this.overlays);
  }
}
