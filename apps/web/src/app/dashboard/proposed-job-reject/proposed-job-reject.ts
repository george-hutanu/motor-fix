import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import {
  REJECTION_REASON_MAX,
  REJECTION_REASON_MIN,
} from '@motor-fix/contracts/price-range';
import {
  type AdminCatalogueJobDto,
  AdminService,
  type CatalogueJobDecisionDto,
} from '@motor-fix/data-access';
import { TranslatePipe } from '@motor-fix/i18n';
import {
  FieldError,
  injectOverlayTask,
  type OverlayResult,
  TaskError,
  TaskSubmit,
  taskSave,
} from '@motor-fix/overlays';
import { HlmButton, HlmInput } from '@motor-fix/ui-cockpit';

import { characters } from '../../characters';

export interface ProposedJobRejectData {
  job: AdminCatalogueJobDto;
}

// What a decision dialog closes with: the decision, 'decided' when another
// admin decided the job first, or 'cancelled'.
export type ProposedJobDecided = OverlayResult<
  CatalogueJobDecisionDto | 'decided'
>;

// Rejects a job a garage proposed, with the reason the garage reads.
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
  selector: 'mf-proposed-job-reject',
  styleUrl: './proposed-job-reject.css',
  templateUrl: './proposed-job-reject.html',
})
export class ProposedJobReject {
  private readonly api = inject(AdminService);
  protected readonly task = injectOverlayTask<
    ProposedJobRejectData,
    ProposedJobDecided
  >();

  protected readonly form = new FormGroup({
    reason: new FormControl('', {
      nonNullable: true,
      validators: [
        characters(REJECTION_REASON_MIN, REJECTION_REASON_MAX, true),
      ],
    }),
  });
  private readonly reason = toSignal(this.form.controls.reason.valueChanges, {
    initialValue: '',
  });
  protected readonly max = REJECTION_REASON_MAX;
  protected readonly count = computed(() => [...this.reason().trim()].length);
  protected readonly valid = toSignal(this.form.statusChanges, {
    initialValue: this.form.status,
  });

  protected readonly save = taskSave({
    done: (decided: CatalogueJobDecisionDto) => this.task.close(decided),
    form: this.form,
    messages: 'admin.proposedJobs.reject',
    send: ({ reason = '' }) =>
      this.api.jobDecisionsControllerReject({
        body: { reason: reason.trim() },
        id: this.task.data.job.id,
      }),
  });

  protected readonly decided = computed(() => {
    const problem = this.save.problem();
    return problem?.code === 'already_decided'
      ? { by: problem.decidedBy ?? null }
      : null;
  });
}
