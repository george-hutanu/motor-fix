import { isPlatformBrowser } from '@angular/common';
import { Component, inject, type OnInit, PLATFORM_ID } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { I18n } from '@motor-fix/i18n';

import { Home } from '../home/home';
import { SignInDialog } from '../sign-in/sign-in-dialog';

// The reset e-mail's link: Home, with the new-password dialog over it. The
// server renders Home only; the link is checked in the browser.
@Component({
  imports: [Home],
  selector: 'mf-reset-password',
  template: '<mf-home />',
})
export class ResetPassword implements OnInit {
  private readonly dialog = inject(SignInDialog);
  private readonly router = inject(Router);
  private readonly i18n = inject(I18n);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly token: string =
    inject(ActivatedRoute).snapshot.paramMap.get('token') ?? '';

  ngOnInit() {
    if (this.browser) void this.open();
  }

  private async open() {
    const signedIn = await this.dialog.newPassword(this.token);
    // Closed without a new password: the link's address is left for Home's.
    if (!signedIn) {
      await this.router.navigateByUrl(`/${this.i18n.language()}`, {
        replaceUrl: true,
      });
    }
  }
}
