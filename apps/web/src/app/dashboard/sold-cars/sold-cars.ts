import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import type { SoldCarDto } from '@motor-fix/data-access';
import { TranslatePipe } from '@motor-fix/i18n';

import { SoldCar } from './sold-car/sold-car';

// "Mașini vândute": the cars the reader sold, in the order the API answers.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SoldCar, TranslatePipe],
  selector: 'mf-sold-cars',
  styleUrl: './sold-cars.css',
  templateUrl: './sold-cars.html',
})
export class SoldCars {
  readonly cars = input.required<SoldCarDto[]>();
  readonly gone = output<void>();
}
