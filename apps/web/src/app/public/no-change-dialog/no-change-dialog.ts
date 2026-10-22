import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TranslatePipe } from '@motor-fix/i18n';
import {
  injectOverlayTask,
  type OverlayResult,
  type Overlays,
} from '@motor-fix/overlays';
import { HlmButton } from '@motor-fix/ui-cockpit';

// Asked before a copy goes back unchanged: "Trimite" closes with true.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmButton, TranslatePipe],
  selector: 'mf-no-change-dialog',
  styleUrl: './no-change-dialog.css',
  templateUrl: './no-change-dialog.html',
})
export class NoChangeDialog {
  protected readonly task = injectOverlayTask<undefined, OverlayResult<true>>();
}

// Whether to send a copy that holds no change; leaving the dialog any other
// way than "Trimite" answers no.
export async function confirmNoChange(overlays: Overlays): Promise<boolean> {
  const result = await overlays.open<true>(NoChangeDialog, {
    shape: 'dialog',
    title: 'public.listing.noChange.title',
  });
  return result === true;
}
