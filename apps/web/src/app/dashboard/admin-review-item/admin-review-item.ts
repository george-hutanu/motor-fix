import { Component, computed, inject, input } from '@angular/core';
import type { ReportQueueItemDto } from '@motor-fix/data-access';
import {
  formatDay,
  formatRating,
  I18n,
  type Language,
  TranslatePipe,
} from '@motor-fix/i18n';
import { Lamp } from '@motor-fix/ui-cockpit';

let next = 0;

// One reported review or reply as the admin judges it: what was written, why
// it was reported, and the facts beside it. The actions are slots until the
// keep and remove stories wire them.
@Component({
  imports: [Lamp, TranslatePipe],
  selector: 'mf-admin-review-item',
  styleUrl: './admin-review-item.css',
  templateUrl: './admin-review-item.html',
})
export class AdminReviewItem {
  private readonly i18n = inject(I18n);
  readonly item = input.required<ReportQueueItemDto>();
  // The time on screen, from the list's clock, so the 48-hour mark appears
  // with no new read.
  readonly now = input.required<Date>();

  protected readonly tipId = `mf-admin-review-soon-${next++}`;

  protected readonly view = computed(() => {
    const { garage, report, reply, review } = this.item();
    const language = this.i18n.language();
    const score = formatRating(review.score, language);
    return {
      answered: reply ? { author: review.author, score } : undefined,
      edited: reply?.editedAt ? this.t('edited') : undefined,
      facts: this.facts(language),
      keep: this.t(reply ? 'actions.keepReply' : 'actions.keep'),
      lamp: this.t(`lamp.${report.source}`, {
        reason: this.reason(report),
      }),
      posted: reply
        ? `${reply.postedBy} · ${formatDay(reply.postedAt, language)}`
        : undefined,
      remove: this.t(reply ? 'actions.removeReply' : 'actions.removeReview'),
      reply: reply?.text,
      text: review.text,
      title: reply
        ? this.t('title.reply', { author: review.author, garage: garage.name })
        : this.t('title.review', { garage: garage.name, score }),
    };
  });

  private facts(language: Language): string[] {
    const { account, garageReports, identicalReviews, job } = this.item().facts;
    const day = (value: unknown) => formatDay(value, language);
    const handover = job.handedOverAt
      ? ` · ${this.t('facts.job.handedOver', { date: day(job.handedOverAt) })}`
      : '';
    return [
      job.kind === 'confirmed'
        ? this.t('facts.job.confirmed', {
            car: job.car ?? '',
            work: job.work ?? '',
          }) + handover
        : this.t('facts.job.none'),
      account.deleted
        ? this.t('facts.account.deleted')
        : this.t('facts.account.created', { date: day(account.createdAt) }),
      this.t('facts.identical', { n: identicalReviews }),
      this.t('facts.garageReports', {
        k: garageReports.kept,
        n: garageReports.earlier,
      }),
    ];
  }

  // The reason in the admin's language, the reporter's own words after
  // "Altceva" as plain text; a reason this build does not know shows as sent.
  private reason(report: ReportQueueItemDto['report']) {
    const key = `reasons.${report.reason}`;
    const text = this.t(key);
    const reason = text === `admin.reviews.${key}` ? report.reason : text;
    return report.reason === 'other' && report.text
      ? `${reason}: ${report.text}`
      : reason;
  }

  private t(key: string, params?: Record<string, string | number>) {
    return this.i18n.t(`admin.reviews.${key}`, params);
  }

  protected readonly overdue = computed(
    () => this.now().getTime() >= new Date(this.item().report.dueAt).getTime(),
  );
}
