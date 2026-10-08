import { Component } from '@angular/core';
import { TranslatePipe } from '@motor-fix/i18n';
import { injectOverlayTask } from '@motor-fix/overlays';
import { HlmButton } from '@motor-fix/ui-cockpit';

// "Ieși de pe toate dispozitivele?": closes with true only on "Ieși".
@Component({
  imports: [HlmButton, TranslatePipe],
  selector: 'mf-sign-out-everywhere',
  styleUrl: './sign-out-everywhere.css',
  templateUrl: './sign-out-everywhere.html',
})
export class SignOutEverywhere {
  protected readonly task = injectOverlayTask<undefined, boolean>();
}
