import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
} from '@angular/core';
import { DELETED_AUTHOR } from '@motor-fix/contracts/lei-text';
import type { GarageStaffReviewDto } from '@motor-fix/data-access';
import {
  formatDay,
  formatDayMonth,
  formatRating,
  I18n,
  relativeTime,
  TranslatePipe,
} from '@motor-fix/i18n';
import { HlmButton } from '@motor-fix/ui-cockpit';

const NEW_FOR_MS = 7 * 24 * 3_600_000;
let rows = 0;

// One review as the garage reads it: the car and its jobs (or that it did not
// come through MotorFix), the score, the text, and who wrote it, when, and
// which mechanic did the job; marked new for a week, edited, or reported.
// Under it the garage's reply, with its own marks. The owner may reply to a
// published review, or edit the reply: `canReply` is false once a reply
// exists, so the edit keys on the owner's role, as the API's edit does.
// The owner may report a published review: a review an admin kept since its
// last edit keeps the button, refused, with the hint saying why.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmButton, TranslatePipe],
  selector: 'article[mf-garage-review-row]',
  styleUrl: './garage-review-row.css',
  templateUrl: './garage-review-row.html',
})
export class GarageReviewRow {
  readonly review = input.required<GarageStaffReviewDto>();
  readonly now = input.required<Date>();
  readonly owner = input.required<boolean>();
  // The owner pressed Răspunde or Editează răspunsul.
  readonly reply = output<void>();
  // The owner pressed Raportează.
  readonly report = output<void>();
  private readonly i18n = inject(I18n);
  protected readonly id = `mf-review-row-${++rows}`;

  protected readonly about = computed(() => {
    const review = this.review();
    if (review.source === 'profile' || !review.car) return null;
    const english = this.i18n.language() === 'en';
    const jobs = review.jobs
      .map((job) => (english && job.nameEn.trim() ? job.nameEn : job.nameRo))
      .join(', ');
    const car = `${review.car.brand} ${review.car.model}`;
    return jobs ? `${car} · ${jobs}` : car;
  });
  protected readonly score = computed(() =>
    this.i18n.t('garage.reviews.score', {
      rating: formatRating(this.review().rating, this.i18n.language()),
    }),
  );
  protected readonly author = computed(() => {
    const name = this.review().author.shortName;
    return name === DELETED_AUTHOR
      ? this.i18n.t('garage.reviews.deletedAuthor')
      : name;
  });
  protected readonly time = computed(() =>
    relativeTime(this.review().postedAt, this.i18n.language(), this.now()),
  );
  protected readonly fresh = computed(
    () =>
      this.now().getTime() - new Date(this.review().postedAt).getTime() <
      NEW_FOR_MS,
  );
  protected readonly edited = computed(() => {
    const at = this.review().editedAt;
    return at
      ? this.i18n.t('garage.reviews.edited', {
          day: formatDayMonth(at, this.i18n.language()),
        })
      : null;
  });

  // The API's canReport keys on the owner's role; the row keys on it too, as
  // the reply button does.
  protected readonly reportable = computed(
    () =>
      this.owner() &&
      this.review().canReport &&
      this.review().status === 'published' &&
      this.review().reportRefusal !== 'already_reported',
  );
  protected readonly kept = computed(
    () => this.review().reportRefusal === 'already_kept',
  );

  protected pressReport(): void {
    if (!this.kept()) this.report.emit();
  }

  // A removed reply never reaches the staff read; it is left out all the same.
  protected readonly answer = computed(() => {
    const reply = this.review().reply;
    return reply && reply.status !== 'removed' ? reply : null;
  });
  protected readonly replyDay = computed(() => {
    const reply = this.answer();
    return reply ? formatDay(reply.postedAt, this.i18n.language()) : '';
  });
  protected readonly replyEdited = computed(() => {
    const at = this.answer()?.editedAt;
    return at
      ? this.i18n.t('garage.reviews.reply.edited', {
          day: formatDay(at, this.i18n.language()),
        })
      : null;
  });
  protected readonly reviewEditedAfter = computed(() => {
    const reply = this.answer();
    const edited = this.review().editedAt;
    if (!reply || !edited || !this.owner()) return false;
    const last = reply.editedAt ?? reply.postedAt;
    return new Date(edited).getTime() > new Date(last).getTime();
  });
  protected readonly action = computed(() => {
    const review = this.review();
    if (!this.owner() || review.status !== 'published') return null;
    if (this.answer()) return 'garage.reviews.reply.editButton';
    return review.canReply ? 'garage.reviews.reply.button' : null;
  });
  // A reported reply cannot be edited until an admin decides; the mark says so.
  protected readonly editOff = computed(
    () => this.answer()?.status === 'reported',
  );

  protected press(): void {
    if (!this.editOff()) this.reply.emit();
  }
}
