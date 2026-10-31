import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  output,
} from '@angular/core';
import { formatNum, I18n } from '@motor-fix/i18n';
import { Lamp, type LampState } from '@motor-fix/ui-cockpit';

import { oilStatus } from '../car-lines/car-lines';

interface OilLineStatus {
  kmLeft: number | null;
  state: LampState;
}

// A lamp and a sentence for the next oil service: the lamp judged by the
// days to its estimated date, the sentence by the kilometres left. It reads
// the clock on every check, as the due-date line does, hence Eager. Without
// a value the line is grey, and a button that asks for it when addable.
@Component({
  changeDetection: ChangeDetectionStrategy.Eager,
  imports: [Lamp],
  selector: 'mf-oil-line',
  styleUrl: './oil-line.css',
  templateUrl: './oil-line.html',
})
export class OilLine {
  private readonly i18n = inject(I18n);
  readonly nextServiceKm = input.required<number | null>();
  readonly odometerKm = input.required<number>();
  readonly serviceDueOn = input<string | null | undefined>(null);
  readonly addable = input(false);
  readonly add = output<void>();

  protected status(): OilLineStatus {
    const next = this.nextServiceKm();
    if (next === null) return { kmLeft: null, state: 'grey' };
    return oilStatus(next, this.odometerKm(), this.serviceDueOn(), new Date());
  }

  protected sentence({ kmLeft }: OilLineStatus): string {
    if (kmLeft === null) return this.i18n.t('driver.cars.oil.missing');
    if (kmLeft === 0) return this.i18n.t('driver.cars.oil.now');
    const km = formatNum(Math.abs(kmLeft), this.i18n.language());
    return this.i18n.t(
      kmLeft > 0 ? 'driver.cars.oil.due' : 'driver.cars.oil.overdue',
      { km },
    );
  }
}
