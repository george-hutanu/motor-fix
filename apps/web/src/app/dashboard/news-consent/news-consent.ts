import { Component } from '@angular/core';
import { TranslatePipe } from '@motor-fix/i18n';
import { injectOverlayTask } from '@motor-fix/overlays';
import { HlmButton } from '@motor-fix/ui-cockpit';

// The news consent text: closes with true only when the driver agrees.
@Component({
  imports: [HlmButton, TranslatePipe],
  selector: 'mf-news-consent',
  styleUrl: './news-consent.css',
  templateUrl: './news-consent.html',
})
export class NewsConsent {
  protected readonly task = injectOverlayTask<undefined, boolean>();
}
