import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import {
  CAR_SYSTEM_LABELS,
  CAR_SYSTEMS,
  type CarSystem,
} from '@motor-fix/contracts/car-systems';
import { CATALOGUE_JOB_NAME } from '@motor-fix/contracts/visible-text';
import {
  type AdminCatalogueJobDto,
  AdminService,
  type CatalogueJobDecisionDto,
  type RarActivityNameDto,
} from '@motor-fix/data-access';
import { I18n, TranslatePipe } from '@motor-fix/i18n';
import {
  FieldError,
  injectOverlayTask,
  TaskError,
  TaskSubmit,
  taskSave,
} from '@motor-fix/overlays';
import { HlmButton, HlmInput } from '@motor-fix/ui-cockpit';
import { map } from 'rxjs';

import { visibleText } from '../../characters';
import type { ProposedJobDecided } from '../proposed-job-reject/proposed-job-reject';

export interface ProposedJobApproveData {
  job: AdminCatalogueJobDto;
  rarActivities: readonly RarActivityNameDto[];
}

type NameField = 'nameRo' | 'nameEn';

// Approves a job a garage proposed: its two names (the Romanian one as the
// garage typed it), the car system and, when it needs one, the RAR activity.
// Closes with the decision, 'decided' when another admin decided first, or
// 'cancelled'.
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
  selector: 'mf-proposed-job-approve',
  styleUrl: './proposed-job-approve.css',
  templateUrl: './proposed-job-approve.html',
})
export class ProposedJobApprove {
  private readonly api = inject(AdminService);
  private readonly i18n = inject(I18n);
  protected readonly task = injectOverlayTask<
    ProposedJobApproveData,
    ProposedJobDecided
  >();

  protected readonly form = new FormGroup({
    carSystem: new FormControl<CarSystem | ''>('', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    nameEn: new FormControl('', {
      nonNullable: true,
      validators: [visibleText(CATALOGUE_JOB_NAME)],
    }),
    nameRo: new FormControl(this.task.data.job.name, {
      nonNullable: true,
      validators: [visibleText(CATALOGUE_JOB_NAME)],
    }),
    rarActivity: new FormControl('', { nonNullable: true }),
  });
  protected readonly valid = toSignal(
    this.form.statusChanges.pipe(map((status) => status === 'VALID')),
    { initialValue: this.form.valid },
  );

  protected readonly systems = computed(() => {
    const language = this.i18n.language();
    return CAR_SYSTEMS.map((value) => ({
      label: CAR_SYSTEM_LABELS[value][language],
      value,
    }));
  });
  protected readonly activities = computed(() => {
    const english = this.i18n.language() === 'en';
    return this.task.data.rarActivities.map(({ code, nameEn, nameRo }) => ({
      label: english ? nameEn : nameRo,
      value: code,
    }));
  });

  protected readonly save = taskSave({
    done: (decided: CatalogueJobDecisionDto) => this.task.close(decided),
    form: this.form,
    messages: 'admin.proposedJobs.approve',
    send: ({ carSystem, nameEn = '', nameRo = '', rarActivity }) =>
      this.api.jobDecisionsControllerApprove({
        body: {
          carSystem: carSystem as CarSystem,
          nameEn: nameEn.trim(),
          nameRo: nameRo.trim(),
          ...(rarActivity ? { rarActivity } : {}),
        },
        id: this.task.data.job.id,
      }),
  });

  protected readonly decided = computed(() => {
    const problem = this.save.problem();
    return problem?.code === 'already_decided'
      ? { by: problem.decidedBy ?? null }
      : null;
  });

  // The name of the job a field collided with, while its message shows.
  protected collided(field: NameField): string | null {
    const control = this.form.controls[field];
    const problem = this.save.problem();
    if (!this.save.fieldError(control) || problem?.code !== 'exists')
      return null;
    const named = problem.errors?.some((error) => error.field === field);
    return named ? (problem.nameRo ?? null) : null;
  }
}
