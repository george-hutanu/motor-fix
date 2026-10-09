import { isPlatformBrowser } from '@angular/common';
import { Component, inject, PLATFORM_ID } from '@angular/core';

import { Home } from '../home/home';
import { SignInDialog } from '../sign-in/sign-in-dialog';

// The address admins keep: the home page with the sign-in dialog over it,
// which also opens over the maintenance page while the site is down.
@Component({
  imports: [Home],
  selector: 'mf-admin-sign-in',
  templateUrl: './admin-sign-in.html',
})
export class AdminSignIn {
  constructor() {
    if (isPlatformBrowser(inject(PLATFORM_ID))) {
      // A dialog that fails to open leaves the home page as it is.
      inject(SignInDialog)
        .start({ overMaintenance: true })
        .catch(() => undefined);
    }
  }
}
