import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  type ElementRef,
  inject,
  input,
  viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import { GARAGE_CLOSE_REASON_LABELS } from '@motor-fix/contracts/request-status';
import type { GarageRequestSummaryDto } from '@motor-fix/data-access';
import { I18n, requestAge, TranslatePipe } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';
import { HlmButton } from '@motor-fix/ui-cockpit';

import { garageOf, Session } from '../../session';
import { GarageRequestsFeed } from '../garage-requests-feed';
import { declineRequest, sendQuote } from '../request-actions';

// One request as the garage sees it: who, the car, the jobs, the mechanic and
// the age; a closed one says why it closed in place of the mechanic and age.
// An open, unanswered row offers Trimite oferta and Refuză to whoever may
// answer quotes, and opens the whole request anywhere else it is clicked.
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
  private readonly router = inject(Router);
  private readonly opener = viewChild<ElementRef<HTMLButtonElement>>('opener');

  constructor() {
    // The drawer this row opened closed back to its page, drawn anew.
    afterNextRender(() => {
      if (this.feed?.takeFocus(this.row().id))
        this.opener()?.nativeElement.focus();
    });
  }

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

  protected readonly name = computed(() => {
    const { car, driver } = this.row();
    return `${driver.shortName} · ${car.brand} ${car.model} · ${car.year}`;
  });

  protected open() {
    void this.router.navigate(['/app/garage/requests', this.row().id], {
      state: { origin: this.router.url },
    });
  }

  protected send() {
    void sendQuote(this.overlays, this.feed, this.row().id);
  }

  protected decline() {
    void declineRequest(this.overlays, this.feed, this.row());
  }
}
