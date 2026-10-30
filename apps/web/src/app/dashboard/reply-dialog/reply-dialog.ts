import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import {
  DELETED_AUTHOR,
  REVIEW_REPLY_TEXT_MAX,
} from '@motor-fix/contracts/lei-text';
import { type ReviewReplyDto, ReviewsService } from '@motor-fix/data-access';
import { formatDay, formatNum, I18n, TranslatePipe } from '@motor-fix/i18n';
import {
  FieldError,
  injectOverlayTask,
  type OverlayResult,
  TaskDone,
  TaskError,
  TaskSubmit,
  taskSave,
} from '@motor-fix/overlays';
import { HlmButton, HlmInput } from '@motor-fix/ui-cockpit';

import type { ReplyData } from './open-reply';

// "Răspunde la recenzie" or "Editează răspunsul": one text, public under the
// review once published. Its length is counted as the API counts it, in code
// points of the trimmed text.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FieldError,
    HlmButton,
    HlmInput,
    ReactiveFormsModule,
    TaskDone,
    TaskError,
    TaskSubmit,
    TranslatePipe,
  ],
  selector: 'mf-reply-dialog',
  styleUrl: './reply-dialog.css',
  templateUrl: './reply-dialog.html',
})
export class ReplyDialog {
  private readonly api = inject(ReviewsService);
  private readonly i18n = inject(I18n);
  protected readonly task = injectOverlayTask<
    ReplyData,
    OverlayResult<ReviewReplyDto>
  >();
  private readonly data = this.task.data;

  protected readonly form = new FormGroup({
    text: new FormControl(this.data.review.reply?.text ?? '', {
      nonNullable: true,
    }),
  });
  private readonly text = toSignal(this.form.controls.text.valueChanges, {
    initialValue: this.form.controls.text.value,
  });
  private readonly length = computed(() => [...this.text().trim()].length);
  protected readonly over = computed(
    () => this.length() > REVIEW_REPLY_TEXT_MAX,
  );

  protected readonly save = taskSave({
    done: (reply: ReviewReplyDto) => this.data.saved(reply),
    form: this.form,
    messages: 'garage.reviews.reply',
    send: ({ text = '' }) => {
      const params = {
        body: { text: text.trim() },
        reviewId: this.data.review.id,
      };
      return this.data.review.reply
        ? this.api.reviewRepliesControllerEdit(params)
        : this.api.reviewRepliesControllerPost(params);
    },
  });

  protected readonly sub = computed(() => {
    const { review } = this.data;
    const language = this.i18n.language();
    const author =
      review.author.shortName === DELETED_AUTHOR
        ? this.i18n.t('garage.reviews.deletedAuthor')
        : review.author.shortName;
    return [
      author,
      formatDay(review.postedAt, language),
      review.mechanic?.shortName,
    ]
      .filter(Boolean)
      .join(' · ');
  });
  protected readonly count = computed(() => {
    const language = this.i18n.language();
    return this.i18n.t('garage.reviews.reply.count', {
      max: formatNum(REVIEW_REPLY_TEXT_MAX, language),
      n: formatNum(this.length(), language),
    });
  });
  // Empty, over the cap or on its way: pressing does nothing.
  protected readonly blocked = computed(
    () => this.length() === 0 || this.over() || this.save.state() === 'sending',
  );

  protected publish(): void {
    if (!this.blocked()) this.save.submit();
  }
}
