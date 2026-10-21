import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { parseLeiText } from '@motor-fix/contracts/lei-text';
import type { Problem } from '@motor-fix/contracts/problem';
import {
  type JobReviewContextDto,
  MeService,
  type PublishReviewDto,
  type ReviewDto,
  ReviewsService,
} from '@motor-fix/data-access';
import { I18n, LeiPipe, NumPipe, TranslatePipe } from '@motor-fix/i18n';
import { injectOverlayTask, toProblem } from '@motor-fix/overlays';
import { HlmButton, HlmInput, toast } from '@motor-fix/ui-cockpit';

const KEY = 'driver.review';
const TEXT_MAX = 2000;
const STEPS = [1, 2, 3, 4, 5] as const;

// A refused publish that replaces the form with its own message.
const SHOWN: Record<string, View> = {
  job_not_done: 'notDone',
  not_found: 'notFound',
};

type View =
  | 'loading'
  | 'loadFailed'
  | 'notFound'
  | 'notDone'
  | 'form'
  | 'existing'
  | 'done';

// "Cum a mers reparația?": the driver rates a finished job, with what they
// paid and a comment, both optional. The car and the works come from the job
// and cannot be changed. A job the driver already reviewed shows that review
// instead; closes with the review just published.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmButton, HlmInput, LeiPipe, NumPipe, TranslatePipe],
  selector: 'mf-review-task',
  styleUrl: './review-task.css',
  templateUrl: './review-task.html',
})
export class ReviewTask {
  private readonly reviews = inject(ReviewsService);
  private readonly me = inject(MeService);
  private readonly i18n = inject(I18n);
  protected readonly task = injectOverlayTask<{ jobId?: string }, ReviewDto>();

  protected readonly steps = STEPS;
  protected readonly max = TEXT_MAX;
  protected readonly view = signal<View>('loading');
  protected readonly context = signal<JobReviewContextDto | null>(null);
  protected readonly emailConfirmed = signal(true);
  protected readonly rating = signal(4);
  protected readonly paid = signal('');
  protected readonly comment = signal('');
  protected readonly paidError = signal<string | null>(null);
  protected readonly commentError = signal<string | null>(null);
  // A refusal this task has no state for, shown by its code.
  protected readonly problem = signal<string | null>(null);
  protected readonly sending = signal(false);
  protected readonly published = signal<ReviewDto | null>(null);

  protected readonly car = computed(() => {
    const car = this.context()?.car;
    return car
      ? [car.brand, car.model, car.engine].filter(Boolean).join(' ')
      : '';
  });
  protected readonly works = computed(() =>
    (this.context()?.jobs ?? []).map((job) =>
      this.i18n.language() === 'en' && job.nameEn ? job.nameEn : job.nameRo,
    ),
  );
  // Code points after trimming, as the server counts them.
  protected readonly count = computed(() => [...this.comment().trim()].length);
  protected readonly existing = computed(
    () => this.context()?.existing ?? null,
  );
  protected readonly postedOn = computed(() => {
    const review = this.existing();
    if (!review) return '';
    return new Intl.DateTimeFormat(
      this.i18n.language() === 'en' ? 'en-GB' : 'ro-RO',
      { dateStyle: 'long', timeZone: 'Europe/Bucharest' },
    ).format(new Date(review.postedAt));
  });

  constructor() {
    void this.load();
  }

  protected async load() {
    const jobId = this.task.data?.jobId;
    if (!jobId) {
      this.view.set('notFound');
      return;
    }
    this.view.set('loading');
    try {
      const context = await this.reviews.reviewsControllerForJob({ jobId });
      this.context.set(context);
      this.emailConfirmed.set(context.emailConfirmed);
      this.view.set(
        context.existing
          ? 'existing'
          : context.job.status === 'done'
            ? 'form'
            : 'notDone',
      );
    } catch (error) {
      this.view.set(
        toProblem(error).status === 404 ? 'notFound' : 'loadFailed',
      );
    }
  }

  protected typePaid(event: Event) {
    this.paid.set((event.target as HTMLInputElement).value);
    this.paidError.set(null);
  }

  protected typeComment(event: Event) {
    this.comment.set((event.target as HTMLTextAreaElement).value);
    this.commentError.set(null);
  }

  protected async publish(event: Event) {
    event.preventDefault();
    if (this.sending() || this.count() > TEXT_MAX) return;
    const body = this.body();
    if (!body) return;
    this.problem.set(null);
    this.sending.set(true);
    try {
      this.published.set(await this.reviews.reviewsControllerPublish({ body }));
      this.view.set('done');
    } catch (error) {
      await this.refused(error);
    } finally {
      this.sending.set(false);
    }
  }

  private body(): PublishReviewDto | null {
    const jobId = this.task.data?.jobId as string;
    const body: PublishReviewDto = { jobId, rating: this.rating() };
    if (this.paid().trim()) {
      const amount = parseLeiText(this.paid());
      if ('error' in amount) {
        this.paidError.set(amount.error);
        return null;
      }
      body.paidBani = amount.bani;
    }
    const text = this.comment().trim();
    if (text) body.text = text;
    return body;
  }

  private async refused(error: unknown) {
    const problem = toProblem(error);
    const { code, status } = problem;
    if (status === 0 || status >= 500) toast(this.i18n.t(`${KEY}.failed`));
    else if (code in SHOWN) this.view.set(SHOWN[code]);
    else if (code === 'email_not_confirmed') this.emailConfirmed.set(false);
    else if (code === 'review_exists') await this.load();
    else this.atFields(problem);
  }

  // A refused amount or comment shows under its field; anything else by code.
  private atFields({ code, errors = [] }: Problem) {
    const paid = errors.find((e) => e.field === 'paidBani');
    const text = errors.find((e) => e.field === 'text');
    if (paid) this.paidError.set(paid.code);
    if (text) this.commentError.set(text.code);
    if (!paid && !text) this.problem.set(code);
  }

  protected finish() {
    const review = this.published();
    if (review) this.task.close(review);
  }

  protected async resend() {
    try {
      await this.me.meEmailConfirmationControllerAskAgain();
      toast(this.i18n.t(`${KEY}.resent`));
    } catch {
      toast(this.i18n.t('shell.form.problem.error'));
    }
  }
}
