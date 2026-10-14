import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormGroup } from '@angular/forms';
import { type CarDto, CarsService } from '@motor-fix/data-access';
import { TranslatePipe } from '@motor-fix/i18n';
import {
  injectOverlayTask,
  type OverlayResult,
  TaskError,
  TaskSubmit,
  taskSave,
} from '@motor-fix/overlays';
import { HlmButton } from '@motor-fix/ui-cockpit';

export interface RemoveCarData {
  car: CarDto;
}

// "Ștergi <brand model>?": removes the car on the main button and closes with
// true; a refusal stays in the dialog with its reason.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmButton, TaskError, TaskSubmit, TranslatePipe],
  selector: 'mf-remove-car',
  styleUrl: './remove-car.css',
  templateUrl: './remove-car.html',
})
export class RemoveCar {
  private readonly cars = inject(CarsService);
  protected readonly task = injectOverlayTask<
    RemoveCarData,
    OverlayResult<true>
  >();
  protected readonly name =
    `${this.task.data.car.brandName} ${this.task.data.car.model}`;

  protected readonly save = taskSave({
    done: () => this.task.close(true),
    form: new FormGroup({}),
    messages: 'driver.cars.remove',
    send: () => this.cars.carsControllerRemove({ id: this.task.data.car.id }),
  });
}
