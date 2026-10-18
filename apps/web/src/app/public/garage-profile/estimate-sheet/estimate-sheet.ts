import {
  ChangeDetectionStrategy,
  Component,
  inject,
  type Signal,
} from '@angular/core';
import type { PublicGarageDto } from '@motor-fix/data-access';
import { injectOverlayTask, OVERLAY_TASK } from '@motor-fix/overlays';

import { EstimateSection } from '../estimate-section/estimate-section';
import { PriceSelection } from '../price-selection/price-selection';

export interface EstimateSheetData {
  readonly garage: Signal<PublicGarageDto>;
  readonly selection: PriceSelection;
}

// The phone's whole estimate, opened from the bar: the page's own box over
// the page's own selection, which the overlay's injector would not reach.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [EstimateSection],
  providers: [
    {
      provide: PriceSelection,
      useFactory: () =>
        (inject(OVERLAY_TASK).data as EstimateSheetData).selection,
    },
  ],
  selector: 'mf-estimate-sheet',
  templateUrl: './estimate-sheet.html',
})
export class EstimateSheet {
  protected readonly data = injectOverlayTask<EstimateSheetData>().data;
}
