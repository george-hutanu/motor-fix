import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  linkedSignal,
  output,
} from '@angular/core';
import {
  type CarRepairDto,
  CarsService,
  type SoldCarDto,
} from '@motor-fix/data-access';
import { formatLongDay, I18n, TranslatePipe } from '@motor-fix/i18n';
import { toProblem } from '@motor-fix/overlays';
import { HlmButton } from '@motor-fix/ui-cockpit';

import { RepairRows } from '../../repair-rows/repair-rows';

type History = 'closed' | 'loading' | 'shown' | 'failed';

// A car the reader sold: its name and the day of the sale, and its repairs
// up to the sale behind a button, read on the first press only.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmButton, RepairRows, TranslatePipe],
  selector: 'mf-sold-car',
  styleUrl: './sold-car.css',
  templateUrl: './sold-car.html',
})
export class SoldCar {
  private readonly api = inject(CarsService);
  private readonly i18n = inject(I18n);
  readonly car = input.required<SoldCarDto>();
  // The sold car is no longer the reader's to see: the list reads again.
  readonly gone = output<void>();
  // Another car in the same card starts closed and unread.
  private readonly id = computed(() => this.car().id);
  protected readonly open = linkedSignal({
    computation: () => false,
    source: this.id,
  });
  protected readonly history = linkedSignal<string, History>({
    computation: () => 'closed',
    source: this.id,
  });
  protected readonly rows = linkedSignal<string, CarRepairDto[] | undefined>({
    computation: () => undefined,
    source: this.id,
  });
  protected readonly name = computed(
    () => `${this.car().brandName} ${this.car().model}`,
  );
  protected readonly line = computed(() =>
    this.i18n.t('driver.cars.sold.line', {
      car: `${this.name()} ${this.car().year}`,
      day: formatLongDay(this.car().saleDate, this.i18n.language()),
    }),
  );

  protected toggle() {
    this.open.update((open) => !open);
    if (
      this.open() &&
      this.rows() === undefined &&
      this.history() !== 'loading'
    )
      void this.read();
  }

  protected async read() {
    const id = this.id();
    this.history.set('loading');
    try {
      const { items } = await this.api.carHistoryControllerSoldRepairs({ id });
      if (id !== this.id()) return;
      this.rows.set(items);
      this.history.set('shown');
    } catch (error) {
      if (id !== this.id()) return;
      this.history.set('failed');
      if (toProblem(error).status === 404) this.gone.emit();
    }
  }
}
