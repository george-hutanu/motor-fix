import { isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  input,
  PLATFORM_ID,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { EVENT_KINDS } from '@motor-fix/contracts/events';
import {
  type GarageStaffReviewDto,
  type GarageStaffReviewsPageDto,
  type ReviewReplyDto,
  ReviewsService,
} from '@motor-fix/data-access';
import { formatNum, formatRating, I18n, TranslatePipe } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';
import { HlmButton } from '@motor-fix/ui-cockpit';

import { liveView } from '../../../live/view';
import { Live } from '../../live';
import { openReply } from '../../reply-dialog/open-reply';
import { openReportReview } from '../../report-review-dialog/open-report-review';
import { SectionTitle } from '../../section-title/section-title';
import { garageOf, Session } from '../../session';
import { GarageReviewRow } from '../garage-review-row/garage-review-row';

// Any change to a review or to the garage's rating reads the first page again.
const KINDS = EVENT_KINDS.filter((kind) => /^(review|rating)\./.test(kind));
const AGE_TICK_MS = 60_000;
const SCORES = [
  ['five', 5],
  ['four', 4],
  ['three', 3],
  ['two', 2],
  ['one', 1],
] as const;

// The garage's own reviews, newest first. With a limit it is Panou's "Recenzii
// noi": that many rows, the links to the public profile and to the view. Without
// one it is the Recenzii view: the rating, how many reviews gave each score,
// and every row, 20 a page. A review or rating message reads the first page
// again, dropping the pages loaded since. The owner replies from a row: the
// reply the API answers shows on it at once, until the next first-page read.
// The owner reports from a row: the row shows reported at once, until the next
// first-page read; a refused report reads the first page again.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    GarageReviewRow,
    HlmButton,
    RouterLink,
    SectionTitle,
    TranslatePipe,
  ],
  selector: 'mf-garage-reviews-panel',
  styleUrl: './garage-reviews-panel.css',
  templateUrl: './garage-reviews-panel.html',
})
export class GarageReviewsPanel {
  readonly limit = input<number | undefined>(undefined);

  private readonly api = inject(ReviewsService);
  private readonly session = inject(Session);
  private readonly live = inject(Live);
  private readonly overlays = inject(Overlays);
  protected readonly i18n = inject(I18n);
  protected readonly now = signal(new Date());

  private readonly garageId = computed(
    () => garageOf(this.session.shown())?.garageId ?? '',
  );
  protected readonly owner = computed(
    () => garageOf(this.session.shown())?.role === 'owner',
  );
  // The replies answered here, by review id, as of the first-page read they
  // were answered after; a later read carries them itself.
  private readonly replied = signal<{
    byId: ReadonlyMap<string, ReviewReplyDto>;
    reads: number;
  }>({ byId: new Map(), reads: -1 });
  // The reviews reported here, as of the first-page read they were reported
  // after; a later read carries them itself.
  private readonly reported = signal<{
    ids: ReadonlySet<string>;
    reads: number;
  }>({ ids: new Set(), reads: -1 });
  // One dialog at a time, reply or report.
  private opening = false;
  // Moves on every read of the first page, so an older page's answer is dropped.
  private generation = 0;
  private readonly pages = signal(1);
  private readonly extra = signal<GarageStaffReviewDto[]>([]);
  protected readonly loadingMore = signal(false);
  protected readonly moreFailed = signal(false);

  protected readonly view = liveView(() => this.read(), {
    changes: this.live.on(KINDS),
    goneOn: [],
    resync: this.live.resync,
  });

  protected readonly home = computed(() => this.limit() !== undefined);
  // How many reviews the garage has, once the first page is read.
  readonly count = computed(() => this.view.value()?.total);
  protected readonly reviews = computed(() => {
    const page = this.view.value();
    if (!page) return [];
    const limit = this.limit();
    const rows =
      limit === undefined
        ? [...page.items, ...this.extra()]
        : page.items.slice(0, limit);
    const replied = this.replied();
    const reported = this.reported();
    const reads = this.view.reads();
    const answers =
      replied.reads === reads
        ? replied.byId
        : new Map<string, ReviewReplyDto>();
    const ids = reported.reads === reads ? reported.ids : new Set<string>();
    if (answers.size === 0 && ids.size === 0) return rows;
    return rows.map((review) => {
      const reply = answers.get(review.id);
      const shown = reply ? { ...review, canReply: false, reply } : review;
      return ids.has(review.id)
        ? {
            ...shown,
            reportRefusal: 'already_reported' as const,
            status: 'reported' as const,
          }
        : shown;
    });
  });
  protected readonly profileHref = computed(() => {
    const slug = this.view.value()?.slug;
    return slug ? ['/', this.i18n.language(), 'garages', slug] : null;
  });
  protected readonly figure = computed(() => {
    const page = this.view.value();
    if (!page || page.total === 0) return null;
    const language = this.i18n.language();
    return this.i18n.t('garage.reviews.figure', {
      count: page.reviewCount,
      rating: formatRating(page.rating, language),
      shown: formatNum(page.reviewCount, language),
    });
  });
  // Each bar is as long as its share of the largest score's count.
  protected readonly bars = computed(() => {
    const page = this.view.value();
    if (!page) return [];
    const largest = Math.max(...SCORES.map(([key]) => page.breakdown[key]));
    return SCORES.map(([key, score]) => {
      const count = page.breakdown[key];
      return {
        count,
        label: this.i18n.t('garage.reviews.score', { rating: score }),
        score,
        share: largest ? (count / largest) * 100 : 0,
      };
    });
  });
  // A page past the last answers no items with the real total, so the pages
  // read, not the rows shown, say whether another one remains.
  protected readonly hasMore = computed(() => {
    const page = this.view.value();
    if (!page || this.home()) return false;
    return this.pages() * page.pageSize < page.total;
  });

  constructor() {
    void this.i18n.enter('garage');
    if (!isPlatformBrowser(inject(PLATFORM_ID))) return;
    const tick = setInterval(() => this.now.set(new Date()), AGE_TICK_MS);
    inject(DestroyRef).onDestroy(() => clearInterval(tick));
  }

  // One dialog at a time: a second press while it loads or shows opens none.
  // A dialog whose chunk failed to load leaves the row as it was, to press again.
  protected async reply(review: GarageStaffReviewDto): Promise<void> {
    if (this.opening) return;
    this.opening = true;
    try {
      await openReply(this.overlays, review, (answer) => {
        const reads = this.view.reads();
        const held = this.replied();
        const byId = new Map(held.reads === reads ? held.byId : []);
        byId.set(review.id, answer);
        this.replied.set({ byId, reads });
      });
    } catch {
      return;
    } finally {
      this.opening = false;
    }
  }

  // A task whose chunk failed to load leaves the row as it was, to press again.
  protected async report(review: GarageStaffReviewDto): Promise<void> {
    if (this.opening) return;
    this.opening = true;
    try {
      const result = await openReportReview(this.overlays, review);
      if (result === 'refused') {
        void this.view.reload();
      } else if (result !== 'cancelled') {
        const reads = this.view.reads();
        const held = this.reported();
        const ids = new Set(held.reads === reads ? held.ids : []);
        ids.add(result.review.id);
        this.reported.set({ ids, reads });
      }
    } catch {
      // A task that failed to load leaves the row as it was; a press retries.
    } finally {
      this.opening = false;
    }
  }

  protected more(): void {
    if (this.loadingMore()) return;
    const generation = this.generation;
    const page = this.pages() + 1;
    // A first-page read that answers before this page leaves it out of step.
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
      .garageReviewsControllerRead({ garageId: this.garageId(), page })
      .then(
        (answer) => {
          if (stale()) return;
          // A review posted between two pages moves the rest down by one: the
          // next page then repeats a row already shown.
          const shown = new Set(
            [...(this.view.value()?.items ?? []), ...this.extra()].map(
              (review) => review.id,
            ),
          );
          this.extra.update((loaded) => [
            ...loaded,
            ...answer.items.filter((review) => !shown.has(review.id)),
          ]);
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

  private read(): Promise<GarageStaffReviewsPageDto> {
    const generation = ++this.generation;
    this.loadingMore.set(false);
    this.moreFailed.set(false);
    return this.api
      .garageReviewsControllerRead({ garageId: this.garageId(), page: 1 })
      .then((answer) => {
        if (generation === this.generation) {
          this.extra.set([]);
          this.pages.set(1);
        }
        return answer;
      });
  }
}
