import {
  ChangeDetectionStrategy,
  Component,
  type ElementRef,
  inject,
  viewChild,
} from '@angular/core';
import { TranslatePipe } from '@motor-fix/i18n';

import { GarageRequestRow } from '../garage-request-row/garage-request-row';
import { GarageRequestsFeed } from '../garage-requests-feed';
import { GarageRequestsPanel } from '../garage-requests-panel/garage-requests-panel';
import { moreRows } from '../more-rows/more-rows';
import { QuotesSentPanel } from '../quotes-sent-panel/quotes-sent-panel';

// "Cereri de ofertă": every waiting request, 20 more each time the list's end
// comes into view, then those the driver closed in the last day, greyed; under
// them the quotes sent that still wait for the driver.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    GarageRequestRow,
    GarageRequestsPanel,
    QuotesSentPanel,
    TranslatePipe,
  ],
  selector: 'mf-garage-requests-view',
  styleUrl: './garage-requests-view.css',
  templateUrl: './garage-requests-view.html',
})
export class GarageRequestsView {
  protected readonly feed = inject(GarageRequestsFeed);
  private readonly end = viewChild<ElementRef<HTMLElement>>('end');
  protected readonly more = moreRows(
    this.feed.rows,
    this.feed.nextCursor,
    (cursor) => this.feed.page(cursor),
    this.end,
  );
}
