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

export interface CancelTransferData {
  car: CarDto;
}

// "Anulezi transferul?": cancels the card's sent transfer on the main button
// and closes with true; a refusal stays in the dialog with its reason.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmButton, TaskError, TaskSubmit, TranslatePipe],
  selector: 'mf-cancel-transfer',
  styleUrl: './cancel-transfer.css',
  templateUrl: './cancel-transfer.html',
})
export class CancelTransfer {
  private readonly cars = inject(CarsService);
  protected readonly task = injectOverlayTask<
    CancelTransferData,
    OverlayResult<true>
  >();

  protected readonly save = taskSave({
    done: () => this.task.close(true),
    form: new FormGroup({}),
    messages: 'driver.cars.transfer.confirm',
    send: () => {
      const { id, transfer } = this.task.data.car;
      return this.cars.carSaleControllerCancel({
        id,
        transferId: transfer?.id ?? '',
      });
    },
  });
}
