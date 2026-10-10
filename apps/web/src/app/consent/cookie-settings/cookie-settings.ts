import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { I18n, TranslatePipe } from '@motor-fix/i18n';
import { injectOverlayTask } from '@motor-fix/overlays';
import { HlmButton, HlmSwitch } from '@motor-fix/ui-cockpit';

import { Consent } from '../consent';

// "Setări cookie": one switch for usage statistics, saved only when changed.
@Component({
  imports: [HlmButton, HlmSwitch, RouterLink, TranslatePipe],
  selector: 'mf-cookie-settings',
  styleUrl: './cookie-settings.css',
  templateUrl: './cookie-settings.html',
})
export class CookieSettings {
  private readonly consent = inject(Consent);
  protected readonly i18n = inject(I18n);
  protected readonly task = injectOverlayTask<undefined, undefined>();
  protected readonly on = signal(this.consent.granted());

  // Consent.save stores nothing for a switch left as it was.
  protected async save() {
    await this.consent.save(this.on());
    this.task.close(undefined);
  }
}
