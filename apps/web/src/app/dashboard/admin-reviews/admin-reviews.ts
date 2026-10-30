import { isPlatformBrowser } from '@angular/common';
import {
  afterRenderEffect,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  effect,
  HostAttributeToken,
  inject,
  PLATFORM_ID,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { AdminService, type ReportQueueDto } from '@motor-fix/data-access';
import { formatNum, I18n, reportAge, TranslatePipe } from '@motor-fix/i18n';
import { Panel } from '@motor-fix/ui-cockpit';

import { AdminReviewItem } from '../admin-review-item/admin-review-item';
import { liveResource, REVIEW_QUEUE_KINDS } from '../live';
import { LiveChange } from '../live-in-place/live-in-place';

const SKELETON_ROWS = [0, 1, 2];
const PANEL_ITEMS = 5;
const LIST = '/app/admin/reviews';
// How often a page left open reads the clock again, so the oldest report's
// age moves with no new read.
const TICK_MS = 60_000;

// "Recenzii raportate": the reports waiting for an admin, oldest first. On
// the overview it shows the five oldest and links to the whole list; the
// view shows a page more at each press, every page shown read again together.
@Component({
  imports: [AdminReviewItem, LiveChange, Panel, RouterLink, TranslatePipe],
  selector: 'mf-admin-reviews',
  styleUrl: './admin-reviews.css',
  templateUrl: './admin-reviews.html',
})
export class AdminReviews {
  private readonly api = inject(AdminService);
  private readonly i18n = inject(I18n);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  // A static attribute, known before the first read, as an input is not.
  protected readonly overview =
    inject(new HostAttributeToken('overview'), { optional: true }) !== null;
  private readonly pages = signal(1);
  private readonly queue = liveResource(() => this.read(), REVIEW_QUEUE_KINDS);

  protected readonly skeletonRows = SKELETON_ROWS;
  protected readonly list = LIST;
  protected readonly now = signal(new Date());

  protected readonly state = computed(() => {
    if (this.queue.value()) return 'ready';
    return this.queue.failed() ? 'failed' : 'loading';
  });

  protected readonly items = computed(() => {
    const items = this.queue.value()?.items ?? [];
    return this.overview ? items.slice(0, PANEL_ITEMS) : items;
  });

  private readonly total = computed(() => this.queue.value()?.total ?? 0);

  protected readonly oldest = computed(() => {
    const oldest = this.queue.value()?.oldestCreatedAt;
    if (this.overview || !oldest) return undefined;
    return this.t('oldest', {
      age: reportAge(oldest, this.i18n.language(), this.now()),
    });
  });

  protected readonly more = computed(
    () => !this.overview && this.items().length < this.total(),
  );
  protected readonly all = computed(() =>
    this.overview && this.total() > PANEL_ITEMS
      ? this.t('all', { total: formatNum(this.total(), this.i18n.language()) })
      : undefined,
  );

  protected readonly pending = computed(() => this.queue.value()?.total);
  protected readonly announcement = computed(() => {
    const n = this.pending() ?? 0;
    return this.t('announce', {
      count: n,
      n: formatNum(n, this.i18n.language()),
    });
  });

  // The place of the first item "Mai multe" asked for, focused once it shows.
  private focusAt?: number;

  showMore() {
    const at = this.items().length;
    this.focusAt = at;
    this.pages.update((n) => n + 1);
    // A page that brought nothing drops the wish, so a later live re-read
    // that adds an item does not take the focus.
    void this.queue.reload().then(() => {
      if (this.focusAt === at && this.items().length <= at)
        this.focusAt = undefined;
    });
  }

  retry() {
    this.queue.reload();
  }

  // Pages 1..n read together, each item once by its report: an item can
  // move a page between two reads. The totals are the first page's.
  private async read(): Promise<ReportQueueDto> {
    const pages = this.overview ? 1 : this.pages();
    const reads = await Promise.all(
      Array.from({ length: pages }, (_, i) =>
        this.api.reportQueueControllerList({ page: i + 1 }),
      ),
    );
    const [first] = reads;
    const seen = new Set<string>();
    const items = reads
      .flatMap((read) => read.items)
      .filter((item) => !seen.has(item.report.id) && seen.add(item.report.id));
    return { ...first, items };
  }

  private t(key: string, params?: Record<string, string | number>) {
    return this.i18n.t(`admin.reviews.${key}`, params);
  }

  constructor() {
    void this.i18n.enter('admin');
    afterRenderEffect(() => {
      const shown = this.items().length;
      const at = this.focusAt;
      if (at === undefined || shown <= at) return;
      this.focusAt = undefined;
      this.host.nativeElement.querySelectorAll('article')[at]?.focus();
    });
    if (!isPlatformBrowser(inject(PLATFORM_ID))) return;
    const tick = setInterval(() => this.now.set(new Date()), TICK_MS);
    // The clock is also read again when the next item crosses its 48 hours,
    // so its mark appears then rather than at the next tick.
    let due: ReturnType<typeof setTimeout> | undefined;
    effect(() => {
      clearTimeout(due);
      const now = this.now().getTime();
      const next = Math.min(
        ...this.items()
          .map((item) => new Date(item.report.dueAt).getTime())
          .filter((at) => at > now),
      );
      // Further out than a tick, the tick reaches it first; a timer that far
      // could also pass the 24.8-day limit and fire at once.
      if (next - now <= TICK_MS) {
        due = setTimeout(() => this.now.set(new Date()), next - now);
      }
    });
    inject(DestroyRef).onDestroy(() => {
      clearInterval(tick);
      clearTimeout(due);
    });
  }
}
