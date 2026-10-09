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

// One request as the garage sees it: who, the car, the jobs, the mechanic and
// the age; a closed one says why it closed in place of the mechanic and age.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
  selector: 'li[mfGarageRequestRow]',
  styleUrl: './garage-request-row.css',
  templateUrl: './garage-request-row.html',
})
export class GarageRequestRow {
  readonly row = input.required<GarageRequestSummaryDto>({
    alias: 'mfGarageRequestRow',
  });
  readonly now = input.required<Date>();
  private readonly language = inject(I18n).language;

  protected readonly jobs = computed(() => {
    const english = this.language() === 'en';
    return this.row().jobs.map((job) => ({
      id: job.id,
      name: english ? job.nameEn : job.nameRo,
      offered: job.offered,
    }));
  });
  protected readonly age = computed(() =>
    requestAge(this.row().createdAt, this.language(), this.now()),
  );
  protected readonly reason = computed(() => {
    const reason = this.row().closedReason;
    return reason ? GARAGE_CLOSE_REASON_LABELS[this.language()][reason] : null;
  });
}
