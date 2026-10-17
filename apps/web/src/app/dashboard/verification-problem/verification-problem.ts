import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { CHECK_DETAIL_MAX } from '@motor-fix/contracts/verification-target';
import {
  AdminService,
  type VerificationCheckRecordedDto,
} from '@motor-fix/data-access';
import { TranslatePipe } from '@motor-fix/i18n';
import {
  FieldError,
  injectOverlayTask,
  TaskError,
  TaskSubmit,
  taskSave,
} from '@motor-fix/overlays';
import { HlmButton, HlmInput } from '@motor-fix/ui-cockpit';
import { map } from 'rxjs';

import { characters } from '../../characters';

export interface VerificationProblemData {
  fileId: string;
  kind: string;
}

type Problem = 'warning' | 'failed';

// "Marchează o problemă": a warning or a failure and what was found, recorded
// on one check. Closes with the record's answer, or "cancelled".
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
  selector: 'mf-verification-problem',
  styleUrl: './verification-problem.css',
  templateUrl: './verification-problem.html',
})
export class VerificationProblem {
  private readonly api = inject(AdminService);
  protected readonly task = injectOverlayTask<
    VerificationProblemData,
    VerificationCheckRecordedDto | 'cancelled'
  >();
  protected readonly detailMax = CHECK_DETAIL_MAX;

  protected readonly form = new FormGroup({
    detail: new FormControl('', {
      nonNullable: true,
      validators: [characters(1, CHECK_DETAIL_MAX, true)],
    }),
    result: new FormControl<Problem | ''>('', { nonNullable: true }),
  });

  // Saving waits for both a choice and a detail.
  protected readonly ready = toSignal(
    this.form.valueChanges.pipe(
      map(() => this.form.valid && this.form.controls.result.value !== ''),
    ),
    { initialValue: false },
  );

  protected readonly save = taskSave({
    done: (recorded: VerificationCheckRecordedDto) => this.task.close(recorded),
    form: this.form,
    messages: 'admin.file.problem',
    send: ({ detail = '', result }) =>
      this.api.verificationChecksControllerRecord({
        body: { detail: detail.trim(), result: result as Problem },
        id: this.task.data.fileId,
        kind: this.task.data.kind,
      }),
  });
}
