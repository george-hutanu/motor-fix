import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import { GARAGE_CLOSE_REASON_LABELS } from '@motor-fix/contracts/request-status';
import type { GarageRequestSummaryDto } from '@motor-fix/data-access';
import { I18n, requestAge, TranslatePipe } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';
import { HlmButton } from '@motor-fix/ui-cockpit';

import { garageOf, Session } from '../../session';
import { GarageRequestsFeed } from '../garage-requests-feed';
import {
  type SendQuoteData,
  SendQuoteDialog,
  type SendQuoteResult,
} from '../send-quote-dialog/send-quote-dialog';

// One request as the garage sees it: who, the car, the jobs, the mechanic and
// the age; a closed one says why it closed in place of the mechanic and age.
// An open, unanswered row offers Trimite oferta to whoever may answer quotes.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmButton, TranslatePipe],
  selector: 'li[mfGarageRequestRow]',
  styleUrl: './garage-request-row.css',
  templateUrl: './garage-request-row.html',
})
export class GarageRequestRow {
  readonly row = input.required<GarageRequestSummaryDto>({
    alias: 'mfGarageRequestRow',
  });
  // Closed rows show their reason, not an age, so they need no clock.
  readonly now = input<Date>();
  private readonly language = inject(I18n).language;
  private readonly session = inject(Session);
  private readonly overlays = inject(Overlays);
  private readonly feed = inject(GarageRequestsFeed, { optional: true });

  protected readonly canSend = computed(() => {
    const row = this.row();
    const me = this.session.shown();
    const garage = me?.garageAccess ? garageOf(me) : null;
    if (!garage || row.closedReason || row.recipient.status !== 'waiting')
      return false;
    return garage.role !== 'mechanic' || garage.permissions.canAnswerQuotes;
  });

  protected readonly jobs = computed(() => {
    const english = this.language() === 'en';
    return this.row().jobs.map((job) => ({
      id: job.id,
      name: english ? job.nameEn : job.nameRo,
      offered: job.offered,
    }));
  });
  protected readonly age = computed(() =>
    requestAge(this.row().createdAt, this.language(), this.now() ?? new Date()),
  );
  protected readonly reason = computed(() => {
    const reason = this.row().closedReason;
    return reason ? GARAGE_CLOSE_REASON_LABELS[this.language()][reason] : null;
  });

  protected async send() {
    const result = await this.overlays.open<SendQuoteResult, SendQuoteData>(
      SendQuoteDialog,
      {
        data: { requestId: this.row().id },
        shape: 'dialog',
        title: 'garage.quotes.send.title',
      },
    );
    if (result === 'refused') this.feed?.reload();
  }
}
