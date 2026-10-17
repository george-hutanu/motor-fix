import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import { formatNum, I18n } from '@motor-fix/i18n';
import { Lamp } from '@motor-fix/ui-cockpit';

import { oilStatus } from '../car-lines/car-lines';

// A lamp and a sentence for the next oil service, judged by the kilometres
// left and the days they are expected to take.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Lamp],
  selector: 'mf-oil-line',
  styleUrl: './oil-line.css',
  templateUrl: './oil-line.html',
})
export class OilLine {
  private readonly i18n = inject(I18n);
  readonly nextServiceKm = input.required<number>();
  readonly odometerKm = input.required<number>();

  protected readonly status = computed(() =>
    oilStatus(this.nextServiceKm(), this.odometerKm()),
  );

  protected readonly sentence = computed(() => {
    const { kmLeft } = this.status();
    if (kmLeft === 0) return this.i18n.t('driver.cars.oil.now');
    const km = formatNum(Math.abs(kmLeft), this.i18n.language());
    return this.i18n.t(
      kmLeft > 0 ? 'driver.cars.oil.due' : 'driver.cars.oil.overdue',
      { km },
    );
  });
}
