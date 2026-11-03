import { HttpErrorResponse } from '@angular/common/http';
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
import { REVIEW_REPORT_REASONS } from '@motor-fix/contracts/lei-text';
import { AdminService, type ReportQueueItemDto } from '@motor-fix/data-access';
import { I18n, TranslatePipe } from '@motor-fix/i18n';
import {
  injectOverlayTask,
  type OverlayResult,
  TaskSubmit,
  taskSave,
  toProblem,
} from '@motor-fix/overlays';
import { HlmButton, toast } from '@motor-fix/ui-cockpit';

export interface RemoveReviewData {
  item: ReportQueueItemDto;
}

// What the item shows once the task ends: removed, decided first by another
// admin (named when the server names them), or no longer pending.
export type RemoveReviewResult =
  | { outcome: 'removed' }
  | { outcome: 'already_decided'; by?: string }
  | { outcome: 'gone' };

type Rule = Exclude<(typeof REVIEW_REPORT_REASONS)[number], 'other'>;

const MESSAGES = 'admin.reviews.remove';
// The rules a removal can name: the report reasons but "Altceva".
const RULES = REVIEW_REPORT_REASONS.filter(
  (code): code is Rule => code !== 'other',
);

// "Șterge recenzia" / "Șterge răspunsul": the rule broken, then the removal.
// A network failure or a server error keeps the task open to try again.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmButton, ReactiveFormsModule, TaskSubmit, TranslatePipe],
  selector: 'mf-remove-review-dialog',
  styleUrl: './remove-review-dialog.css',
  templateUrl: './remove-review-dialog.html',
})
export class RemoveReviewDialog {
  private readonly admin = inject(AdminService);
  private readonly i18n = inject(I18n);
  protected readonly task = injectOverlayTask<
    RemoveReviewData,
    OverlayResult<RemoveReviewResult>
  >();

  private readonly item = this.task.data.item;
  protected readonly submitLabel = this.item.reply
    ? `${MESSAGES}.submitReply`
    : `${MESSAGES}.submitReview`;
  protected readonly rules = RULES.map((code) => ({
    code,
    label: `admin.reviews.reasons.${code}`,
  }));
  protected readonly form = new FormGroup({
    rule: new FormControl<Rule | null>(
      (RULES as readonly string[]).includes(this.item.report.reason)
        ? (this.item.report.reason as Rule)
        : null,
      { validators: Validators.required },
    ),
  });
  private readonly changed = toSignal(this.form.events);

  protected readonly save = taskSave({
    done: () => this.task.close({ outcome: 'removed' }),
    form: this.form,
    messages: MESSAGES,
    send: () =>
      this.admin
        .reportQueueControllerDecide({
          body: {
            decision: 'remove',
            reason: this.form.getRawValue().rule as Rule,
          },
          reviewId: this.item.review.id,
        })
        .catch((failure: unknown) => {
          this.failed(failure);
          throw failure;
        }),
  });
  protected readonly sending = computed(() => this.save.state() === 'sending');

  protected blocked() {
    this.changed();
    return this.form.invalid;
  }

  protected submit() {
    if (!this.blocked()) this.save.submit();
  }

  // A decision already taken or a report no longer pending ends the task with
  // what the item says; a network failure or a server error stays to retry;
  // any other refusal ends it with the shared line.
  private failed(failure: unknown) {
    const ended = outcomeOf(failure);
    if (ended) {
      this.task.close(ended);
      return;
    }
    const key = `shell.form.problem.${toProblem(failure).code}`;
    const said = this.i18n.t(key);
    toast(said !== key ? said : this.i18n.t('shell.form.problem.error'));
    const status = failure instanceof HttpErrorResponse ? failure.status : 0;
    if (status !== 0 && status < 500) this.task.close('cancelled');
  }
}

// The outcome a refusal ends the task with, if it ends it so.
function outcomeOf(failure: unknown): RemoveReviewResult | undefined {
  if (!(failure instanceof HttpErrorResponse)) return undefined;
  const { code, decidedBy } = toProblem(failure);
  if (failure.status === 404 || code === 'no_pending_report')
    return { outcome: 'gone' };
  if (code !== 'already_decided') return undefined;
  return decidedBy
    ? { by: decidedBy, outcome: 'already_decided' }
    : { outcome: 'already_decided' };
}
