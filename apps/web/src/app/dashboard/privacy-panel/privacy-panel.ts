import { Component, inject } from '@angular/core';
import { TranslatePipe } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';
import { HlmButton } from '@motor-fix/ui-cockpit';

import { openCookieSettings } from '../../consent/cookie-settings/cookie-settings';

// "Confidențialitate" in a dashboard's Setări: the way to the cookie settings.
@Component({
  imports: [HlmButton, TranslatePipe],
  selector: 'mf-privacy-panel',
  styleUrl: './privacy-panel.css',
  templateUrl: './privacy-panel.html',
})
export class PrivacyPanel {
  private readonly overlays = inject(Overlays);

  protected settings() {
    void openCookieSettings(this.overlays);
  }
}
