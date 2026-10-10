import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { I18n, TranslatePipe } from '@motor-fix/i18n';
import { HlmButton } from '@motor-fix/ui-cockpit';

import { Consent } from '../consent';

// The analytics question at the bottom of every page while no valid choice
// holds: two answers of equal weight, never in the way of the page.
@Component({
  imports: [HlmButton, RouterLink, TranslatePipe],
  selector: 'mf-consent-bar',
  styleUrl: './consent-bar.css',
  templateUrl: './consent-bar.html',
})
export class ConsentBar {
  protected readonly consent = inject(Consent);
  protected readonly i18n = inject(I18n);
}
