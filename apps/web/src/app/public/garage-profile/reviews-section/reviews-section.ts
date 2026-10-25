import { isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  Injector,
  inject,
  input,
  makeStateKey,
  type OnInit,
  PendingTasks,
  PLATFORM_ID,
  runInInjectionContext,
  signal,
  TransferState,
  untracked,
} from '@angular/core';
import { EVENT_KINDS } from '@motor-fix/contracts/events';
import { DELETED_AUTHOR } from '@motor-fix/contracts/lei-text';
import {
  type GarageReviewDto,
  type GarageReviewsPageDto,
  ReviewsService,
} from '@motor-fix/data-access';
import {
  formatDay,
  formatLei,
  formatLeiSpan,
  formatRating,
  formatShortMonthYear,
  I18n,
  type Language,
  TranslatePipe,
} from '@motor-fix/i18n';

import { LiveChange } from '../../../dashboard/live-in-place/live-in-place';
import { type LiveView, liveView } from '../../../live/view';
import { publicRead } from '../../../public-read';
import { PublicLive } from '../../live';

// Any change to a review or to the garage's rating reads the first page again.
const KINDS = EVENT_KINDS.filter((kind) => /^(review|rating)\./.test(kind));

const SECTION = 'public.garageProfile.reviewsSection';

const SCORES = [
  ['five', 5],
  ['four', 4],
  ['three', 3],
  ['two', 2],
  ['one', 1],
] as const;

// The page the server render read, handed to the browser so hydration keeps
// the section drawn.
const served = (garageId: string) =>
  makeStateKey<GarageReviewsPageDto>(`reviews:${garageId}`);

// The garage's reviews on its profile: the stored rating and count, how many
// reviews gave each score, and the reviews newest first, 20 a page. It follows
// the profile's own stream: a review or rating message reads the first page
// again, dropping the pages loaded since, and a page still loading loses to it.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.aria-label]': 'label()' },
  imports: [LiveChange, TranslatePipe],
  selector: 'section[mf-reviews-section]',
  styleUrl: './reviews-section.css',
  templateUrl: './reviews-section.html',
})
export class ReviewsSection implements OnInit {
  readonly garageId = input.required<string>();

  private readonly api = inject(ReviewsService);
  private readonly live = inject(PublicLive);
  private readonly i18n = inject(I18n);
  private readonly injector = inject(Injector);
  private readonly pending = inject(PendingTasks);
  private readonly state = inject(TransferState);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));

  protected readonly label = computed(() =>
    this.i18n.t('public.garageProfile.reviewsSection.title'),
  );
  protected view!: LiveView<GarageReviewsPageDto>;
  // The answer the server render handed over, standing in for the first read.
  private handed: GarageReviewsPageDto | undefined;
  // Moves on every read of the first page, so an older page's answer is dropped.
  private generation = 0;
  private readonly pages = signal(1);
  private readonly extra = signal<GarageReviewDto[]>([]);
  protected readonly loadingMore = signal(false);
  protected readonly moreFailed = signal(false);

  private readonly page = computed(() => this.view.value());
  protected readonly figure = computed(() => {
    const rating = this.page()?.rating;
    return typeof rating === 'number'
      ? formatRating(rating, this.i18n.language())
      : '—';
  });
  protected readonly rows = computed(() => {
    const page = this.page();
    if (!page || page.total === 0) return [];
    return SCORES.map(([key, score]) => {
      const count = page.breakdown[key];
      return {
        count,
        label: this.i18n.t('public.garageProfile.reviewsSection.stars', {
          count: score,
        }),
        score,
        share: (count / page.total) * 100,
      };
    });
  });
  protected readonly reviews = computed(() => {
    const page = this.page();
    if (!page) return [];
    const language = this.i18n.language();
    return [...page.items, ...this.extra()].map((review) =>
      this.row(review, language),
    );
  });
  // A page past the last answers no items with the real total, so the pages
  // read, not the rows shown, say whether another one remains.
  protected readonly hasMore = computed(() => {
    const page = this.page();
    if (!page) return false;
    return this.pages() * page.pageSize < page.total;
  });

  private row(review: GarageReviewDto, language: Language) {
    const jobs = review.jobs
      .map((job) => (language === 'en' ? job.nameEn : job.nameRo))
      .join(', ');
    const car = review.car && `${review.car.brand} ${review.car.model}`;
    const profile = review.source === 'profile';
    return {
      about: profile
        ? this.i18n.t(`${SECTION}.notThroughMotorFix`)
        : car && [car, jobs].filter(Boolean).join(' · '),
      author:
        review.author.shortName === DELETED_AUTHOR
          ? this.i18n.t('public.garageProfile.reviewsSection.deletedAuthor')
          : review.author.shortName,
      edited: review.editedAt && formatDay(review.editedAt, language),
      id: review.id,
      month: formatShortMonthYear(review.postedAt, language),
      price: profile ? '' : this.price(review),
      score: this.i18n.t('public.garageProfile.reviewsSection.score', {
        rating: formatRating(review.rating, language),
      }),
      text: review.text,
    };
  }

  // "Ofertă … · Final … · Plătit, după șofer: …": each part whose amount the
  // read carries; the driver's amount only when it says something the final
  // price does not. No part, no line.
  private price(review: GarageReviewDto): string {
    const language = this.i18n.language();
    const part = (key: string, amount: string) =>
      this.i18n.t(`${SECTION}.price.${key}`, { amount });
    const { finalPriceBani: final, paidBani: paid, quote } = review;
    const parts: string[] = [];
    if (quote) {
      parts.push(
        part('quote', formatLeiSpan(quote.fromBani, quote.toBani, language)),
      );
    }
    if (final !== null) parts.push(part('final', formatLei(final, language)));
    if (paid !== null && paid !== final) {
      parts.push(part('paid', formatLei(paid, language)));
    }
    return parts.join(' · ');
  }

  ngOnInit(): void {
    this.handed = this.take();
    runInInjectionContext(this.injector, () => {
      this.view = liveView(() => this.read(), {
        changes: this.live.on(KINDS),
        goneOn: [],
        initial: this.handed,
        resync: this.live.resync,
      });
      // Another garage on the same page: its first page, nothing kept.
      let shown = untracked(this.garageId);
      effect(() => {
        const garageId = this.garageId();
        if (garageId === shown) return;
        shown = garageId;
        untracked(() => this.view.reload());
      });
    });
  }

  protected more(): void {
    const generation = this.generation;
    const page = this.pages() + 1;
    // A re-read of the first page that began before the click and answers
    // before this page does leaves this page out of step: it is dropped.
    const stale = () => {
      if (generation === this.generation && this.pages() === page - 1) {
        return false;
      }
      if (generation === this.generation) this.loadingMore.set(false);
      return true;
    };
    this.loadingMore.set(true);
    this.moreFailed.set(false);
    this.api
      .reviewsControllerForGarage(
        { garageId: this.garageId(), page },
        publicRead(),
      )
      .then(
        (answer) => {
          if (stale()) return;
          this.extra.update((loaded) => [...loaded, ...answer.items]);
          this.pages.set(page);
          this.loadingMore.set(false);
        },
        () => {
          if (stale()) return;
          this.moreFailed.set(true);
          this.loadingMore.set(false);
        },
      );
  }

  private take(): GarageReviewsPageDto | undefined {
    if (!this.browser) return undefined;
    const key = served(untracked(this.garageId));
    const handed = this.state.get(key, undefined);
    this.state.remove(key);
    return handed;
  }

  // The server render waits for the first page, so it draws the reviews.
  private read(): Promise<GarageReviewsPageDto> {
    const handed = this.handed;
    this.handed = undefined;
    if (handed) return Promise.resolve(handed);
    const generation = ++this.generation;
    this.loadingMore.set(false);
    this.moreFailed.set(false);
    const garageId = untracked(this.garageId);
    const done = this.pending.add();
    return this.api
      .reviewsControllerForGarage({ garageId, page: 1 }, publicRead())
      .then((answer) => {
        if (generation === this.generation) {
          this.extra.set([]);
          this.pages.set(1);
        }
        if (!this.browser) this.state.set(served(garageId), answer);
        return answer;
      })
      .finally(done);
  }
}
