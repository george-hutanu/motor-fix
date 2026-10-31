import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import {
  type AbstractControl,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import {
  DELETED_AUTHOR,
  REVIEW_REPORT_REASONS,
  REVIEW_REPORT_TEXT_MAX,
} from '@motor-fix/contracts/lei-text';
import {
  type GarageStaffReviewDto,
  type ReviewReportDto,
  ReviewsService,
} from '@motor-fix/data-access';
import { formatShortMonthYear, I18n, TranslatePipe } from '@motor-fix/i18n';
import {
  injectOverlayTask,
  type OverlayResult,
  TaskError,
  TaskSubmit,
  taskSave,
  toProblem,
} from '@motor-fix/overlays';
import { HlmButton, HlmInput, HlmLabel, toast } from '@motor-fix/ui-cockpit';

export interface ReportReviewData {
  review: GarageStaffReviewDto;
}

// The answer, or refused because the review was reported or kept, the right
// lost or the review gone meanwhile: the opener re-reads its list.
export type ReportReviewResult = ReviewReportDto | 'refused';

type Reason = (typeof REVIEW_REPORT_REASONS)[number];

const MESSAGES = 'garage.reviews.report';
// The answers that end the task with their message as the toast.
const ENDING = new Set([403, 404, 409]);

const length = (value: string | null) => [...(value ?? '').trim()].length;

// 1 to the cap in characters after the trim, as the server counts.
const told = (control: AbstractControl<string | null>) => {
  const n = length(control.value);
  return n >= 1 && n <= REVIEW_REPORT_TEXT_MAX ? null : { told: true };
};

// "Raportează": one of the nine reasons, a text for "Altceva", then the report.
// The review leaves the profile until an admin decides.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    HlmButton,
    HlmInput,
    HlmLabel,
    ReactiveFormsModule,
    TaskError,
    TaskSubmit,
    TranslatePipe,
  ],
  selector: 'mf-report-review-dialog',
  styleUrl: './report-review-dialog.css',
  templateUrl: './report-review-dialog.html',
})
export class ReportReviewDialog {
  private readonly reviews = inject(ReviewsService);
  private readonly i18n = inject(I18n);
  protected readonly task = injectOverlayTask<
    ReportReviewData,
    OverlayResult<ReportReviewResult>
  >();

  protected readonly max = REVIEW_REPORT_TEXT_MAX;
  protected readonly reasons = REVIEW_REPORT_REASONS;
  protected readonly form = new FormGroup({
    reason: new FormControl<Reason | null>(null, {
      validators: Validators.required,
    }),
    // Enabled only while "Altceva" is picked; its value stays when it is not.
    text: new FormControl<string>(
      { disabled: true, value: '' },
      { nonNullable: true, validators: told },
    ),
  });
  private readonly changed = toSignal(this.form.events);
  protected readonly other = toSignal(this.form.controls.reason.valueChanges, {
    initialValue: null,
  });
  protected readonly count = computed(() => {
    this.changed();
    return length(this.form.controls.text.value);
  });

  protected readonly subject = computed(() => {
    const { author, postedAt } = this.task.data.review;
    const name =
      author.shortName === DELETED_AUTHOR
        ? this.i18n.t('garage.reviews.deletedAuthor')
        : author.shortName;
    return `${name} · ${formatShortMonthYear(postedAt, this.i18n.language())}`;
  });

  protected readonly save = taskSave({
    done: (answer: ReviewReportDto) => {
      toast(this.i18n.t(`${MESSAGES}.done`));
      this.task.close(answer);
    },
    form: this.form,
    messages: MESSAGES,
    send: () => {
      const { reason, text } = this.form.getRawValue();
      return this.reviews
        .reviewReportsControllerReport({
          body:
            reason === 'other'
              ? { reason, text: text.trim() }
              : { reason: reason as Reason },
          reviewId: this.task.data.review.id,
        })
        .catch((failure: unknown) => {
          this.refused(failure);
          throw failure;
        });
    },
  });
  protected readonly sending = computed(() => this.save.state() === 'sending');

  constructor() {
    this.form.controls.reason.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe((reason) => {
        const text = this.form.controls.text;
        if (reason === 'other') text.enable();
        else text.disable();
      });
  }

  protected blocked() {
    this.changed();
    return this.form.invalid;
  }

  protected submit() {
    if (!this.blocked()) this.save.submit();
  }

  // A review already reported or kept, a lost right or a review gone ends the
  // task; its message is the toast.
  private refused(failure: unknown) {
    if (!(failure instanceof HttpErrorResponse) || !ENDING.has(failure.status))
      return;
    const { code, detail } = toProblem(failure);
    const key = `${MESSAGES}.problem.${code}`;
    const said = this.i18n.t(key);
    toast(said !== key ? said : (detail ?? said));
    this.task.close('refused');
  }
}
