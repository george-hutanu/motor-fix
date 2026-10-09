import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import {
  GARAGE_REPORT_TEXT_MAX,
  GARAGE_REPORT_TEXT_MIN,
} from '@motor-fix/contracts/garage-report-text';
import { GaragesService, type PublicGarageDto } from '@motor-fix/data-access';
import { TranslatePipe } from '@motor-fix/i18n';
import {
  FieldError,
  injectOverlayTask,
  TaskError,
  TaskSubmit,
  taskSave,
} from '@motor-fix/overlays';
import { HlmButton, HlmInput } from '@motor-fix/ui-cockpit';

import { characters } from '../../../characters';

// What the task closes with: sent, the garage cannot be reported (404, said
// nothing about), or cancelled.
export type ReportGarageResult = 'sent' | 'gone' | 'cancelled';

// Answers the person can do nothing about by sending the same text again.
const FINAL = new Set(['garage_already_reported', 'too_many_reports']);

// "Ce s-a întâmplat?": what went wrong with the garage, sent to the admins.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FieldError,
    HlmButton,
    HlmInput,
    ReactiveFormsModule,
    TaskError,
    TaskSubmit,
    TranslatePipe,
  ],
  selector: 'mf-report-garage',
  styleUrl: './report-garage.css',
  templateUrl: './report-garage.html',
})
export class ReportGarage {
  private readonly api = inject(GaragesService);
  protected readonly task = injectOverlayTask<
    { garage: PublicGarageDto },
    ReportGarageResult
  >();
  protected readonly max = GARAGE_REPORT_TEXT_MAX;

  protected readonly form = new FormGroup({
    text: new FormControl('', {
      nonNullable: true,
      validators: [characters(GARAGE_REPORT_TEXT_MIN, GARAGE_REPORT_TEXT_MAX)],
    }),
  });

  private readonly typed = toSignal(this.form.controls.text.valueChanges, {
    initialValue: '',
  });
  protected readonly count = computed(() => [...this.typed()].length);

  protected readonly save = taskSave({
    done: () => this.task.close('sent'),
    form: this.form,
    messages: 'public.reportGarage',
    send: ({ text = '' }) =>
      this.api
        .garageReportsControllerReport({
          body: { text },
          id: this.task.data.garage.id,
        })
        .catch((failure: unknown) => {
          if (failure instanceof HttpErrorResponse && failure.status === 404) {
            this.task.close('gone');
          }
          throw failure;
        }),
  });

  protected readonly retry = computed(() => {
    const problem = this.save.problem();
    return (
      this.save.state() === 'failed' &&
      !!problem &&
      problem.status !== 400 &&
      !FINAL.has(problem.code)
    );
  });
}
