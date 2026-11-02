import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { CarRepairDto } from '@motor-fix/data-access';
import { DayPipe, TranslatePipe } from '@motor-fix/i18n';

// A car's repairs, read only: what was done, the day and the garage, and a
// last column saying a repair came from the previous owner or was added by
// the reader. Never a review link, an invoice or an action.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DayPipe, TranslatePipe],
  selector: 'mf-repair-rows',
  styleUrl: './repair-rows.css',
  templateUrl: './repair-rows.html',
})
export class RepairRows {
  readonly rows = input.required<CarRepairDto[]>();

  protected label(row: CarRepairDto): string | null {
    if (row.fromPreviousOwner) return 'driver.cars.history.previousOwner';
    return row.source === 'logged' ? 'driver.cars.sale.added' : null;
  }
}
