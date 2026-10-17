import { Component, inject, RESPONSE_INIT } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LanguageSwitch, TranslatePipe } from '@motor-fix/i18n';

import { supportAddress } from '../../public/contact/contact';

// In place of every page while the site is in maintenance, for everyone but an
// admin; the quiet link is the admin's way in.
@Component({
  imports: [LanguageSwitch, RouterLink, TranslatePipe],
  selector: 'mf-maintenance-page',
  styleUrl: './maintenance-page.css',
  templateUrl: './maintenance-page.html',
})
export class MaintenancePage {
  // Read from the one route that stays open in maintenance; null hides it.
  protected readonly address = supportAddress();

  constructor() {
    // Only the server render provides it: search engines are told to come back.
    const response = inject(RESPONSE_INIT, { optional: true });
    if (response) {
      response.status = 503;
      // Added to the render's own headers, which carry its content type.
      const headers = new Headers(response.headers);
      headers.set('Retry-After', '300');
      response.headers = headers;
    }
  }
}
