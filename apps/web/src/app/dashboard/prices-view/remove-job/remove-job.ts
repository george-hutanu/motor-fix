import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormGroup } from '@angular/forms';
import { GaragesService } from '@motor-fix/data-access';
import { I18n, TranslatePipe } from '@motor-fix/i18n';
import {
  injectOverlayTask,
  type OverlayResult,
  TaskError,
  TaskSubmit,
  taskSave,
} from '@motor-fix/overlays';
import { HlmButton } from '@motor-fix/ui-cockpit';

export interface RemoveJobData {
  garageId: string;
  priceId: string;
}

export type RemoveJobResult = 'removed';

// Asks before a job leaves the price list, then removes it. A job another
// session removed first counts as removed: the opener re-reads either way.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmButton, TaskError, TaskSubmit, TranslatePipe],
  selector: 'mf-remove-job',
  styleUrl: './remove-job.css',
  templateUrl: './remove-job.html',
})
export class RemoveJob {
  private readonly api = inject(GaragesService);
  protected readonly task = injectOverlayTask<
    RemoveJobData,
    OverlayResult<RemoveJobResult>
  >();
  protected readonly form = new FormGroup({});

  protected readonly save = taskSave({
    done: () => this.task.close('removed'),
    form: this.form,
    send: () =>
      this.api.priceListControllerRemove(this.task.data).catch((failure) => {
        if (failure instanceof HttpErrorResponse && failure.status === 404)
          return;
        throw failure;
      }),
  });

  constructor() {
    void inject(I18n).enter('garage');
  }
}
