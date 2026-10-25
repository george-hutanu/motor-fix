import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import { DELETED_AUTHOR } from '@motor-fix/contracts/lei-text';
import type { GarageStaffReviewDto } from '@motor-fix/data-access';
import {
  formatDayMonth,
  formatRating,
  I18n,
  relativeTime,
  TranslatePipe,
} from '@motor-fix/i18n';

const NEW_FOR_MS = 7 * 24 * 3_600_000;

// One review as the garage reads it: the car and its jobs (or that it did not
// come through MotorFix), the score, the text, and who wrote it, when, and
// which mechanic did the job; marked new for a week, edited, or reported.
// It offers nothing to press: replying and reporting come with their stories.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
  selector: 'article[mf-garage-review-row]',
  styleUrl: './garage-review-row.css',
  templateUrl: './garage-review-row.html',
})
export class GarageReviewRow {
  readonly review = input.required<GarageStaffReviewDto>();
  readonly now = input.required<Date>();
  private readonly i18n = inject(I18n);

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
}
