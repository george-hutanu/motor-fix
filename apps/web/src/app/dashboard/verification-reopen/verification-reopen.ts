import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TranslatePipe } from '@motor-fix/i18n';
import { injectOverlayTask, type OverlayResult } from '@motor-fix/overlays';
import { HlmButton } from '@motor-fix/ui-cockpit';

// "Redeschizi dosarul?": closes with true on the main button; the drawer that
// opened it sends the reopening.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmButton, TranslatePipe],
  selector: 'mf-verification-reopen',
  styleUrl: './verification-reopen.css',
  templateUrl: './verification-reopen.html',
})
export class VerificationReopen {
  protected readonly task = injectOverlayTask<undefined, OverlayResult<true>>();
}
