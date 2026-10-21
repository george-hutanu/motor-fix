import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { QuotesService } from '@motor-fix/data-access';
import { I18n, TranslatePipe } from '@motor-fix/i18n';
import { injectOverlayTask, type OverlayResult } from '@motor-fix/overlays';
import { HlmButton } from '@motor-fix/ui-cockpit';

import { Live } from '../../live';
import { quoteRefusal } from '../quote-refusal/quote-refusal';

export interface DeclineQuoteData {
  quoteId: string;
  garage: string;
  // The panel reads its quotes again after a refusal.
  reread(): void;
}

export type DeclineQuoteResult = 'declined';

// "Refuzi oferta …?": no reason asked, and no way back once confirmed.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmButton, TranslatePipe],
  selector: 'mf-decline-quote-dialog',
  styleUrl: './decline-quote-dialog.css',
  templateUrl: './decline-quote-dialog.html',
})
export class DeclineQuoteDialog {
  private readonly quotes = inject(QuotesService);
  private readonly i18n = inject(I18n);
  private readonly offline = inject(Live).offline;
  protected readonly task = injectOverlayTask<
    DeclineQuoteData,
    OverlayResult<DeclineQuoteResult>
  >();

  protected readonly sending = signal(false);
  protected readonly problem = signal<string | null>(null);
  private readonly refused = signal(false);
  protected readonly blocked = computed(
    () => this.sending() || this.refused() || this.offline(),
  );

  protected async confirm() {
    if (this.blocked()) return;
    this.sending.set(true);
    this.problem.set(null);
    try {
      await this.quotes.declineQuoteControllerDecline({
        id: this.task.data.quoteId,
      });
      this.task.close('declined');
    } catch (error) {
      const { network, text } = quoteRefusal(this.i18n, error);
      this.problem.set(text);
      if (!network) {
        this.refused.set(true);
        this.task.data.reread();
      }
    } finally {
      this.sending.set(false);
    }
  }
}
