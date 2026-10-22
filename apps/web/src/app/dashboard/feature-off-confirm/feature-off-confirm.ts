import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TranslatePipe } from '@motor-fix/i18n';
import { injectOverlayTask, type OverlayResult } from '@motor-fix/overlays';
import { HlmButton } from '@motor-fix/ui-cockpit';

export interface FeatureOffConfirmData {
  key: string;
}

// "Oprești „<feature>”?": closes with true on the main button; every other way
// out is a cancel.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmButton, TranslatePipe],
  selector: 'mf-feature-off-confirm',
  styleUrl: './feature-off-confirm.css',
  templateUrl: './feature-off-confirm.html',
})
export class FeatureOffConfirm {
  protected readonly task = injectOverlayTask<
    FeatureOffConfirmData,
    OverlayResult<true>
  >();
  protected readonly line =
    `garage.features.confirm.line.${this.task.data.key}`;
}
