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
import {
  AdminService,
  type ReportQueueDto,
  type ReportQueueItemDto,
} from '@motor-fix/data-access';
import { formatNum, I18n, TranslatePipe } from '@motor-fix/i18n';
import { reportAge } from '@motor-fix/i18n/report-age';
import { Panel } from '@motor-fix/ui-cockpit';

import { AdminReviewItem } from '../admin-review-item/admin-review-item';
import { liveResource, REVIEW_QUEUE_KINDS } from '../live';
import { LiveChange } from '../live-in-place/live-in-place';
import type { RemoveReviewResult } from '../remove-review-dialog/remove-review-dialog';

const SKELETON_ROWS = [0, 1, 2];
const PANEL_ITEMS = 5;
const LIST = '/app/admin/reviews';
// How often a page left open reads the clock again, so the oldest report's
// age moves with no new read.
const TICK_MS = 60_000;

// An item this admin decided, kept where it was until "Mai multe" or leaving.
interface Decided {
  at: number;
  item: ReportQueueItemDto;
  outcome: RemoveReviewResult;
}

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

  private readonly decisions = signal<ReadonlyMap<string, Decided>>(new Map());

  // The read's items, those this admin decided put back where they were when
  // a later read no longer lists them.
  private readonly shown = computed(() => {
    const items = [...(this.queue.value()?.items ?? [])];
    const listed = new Set(items.map((i) => i.report.id));
    const back = [...this.decisions()]
      .filter(([id]) => !listed.has(id))
      .sort(([, a], [, b]) => a.at - b.at);
    for (const [, { at, item }] of back)
      items.splice(Math.min(at, items.length), 0, item);
    return items;
  });

  protected readonly items = computed(() => {
    const items = this.shown();
    return this.overview ? items.slice(0, PANEL_ITEMS) : items;
  });

  protected outcome(id: string) {
    return this.decisions().get(id)?.outcome;
  }

  // The decided items the read still lists, which its counts still hold.
  private readonly stale = computed(() =>
    (this.queue.value()?.items ?? []).filter((i) =>
      this.decisions().has(i.report.id),
    ),
  );

  private readonly total = computed(() =>
    Math.max(0, (this.queue.value()?.total ?? 0) - this.stale().length),
  );

  protected readonly oldest = computed(() => {
    const oldest = this.stale().length
      ? this.shown()
          .filter((i) => !this.decisions().has(i.report.id))
          .map((i) => i.report.createdAt)
          .sort()[0]
      : this.queue.value()?.oldestCreatedAt;
    if (this.overview || !oldest) return undefined;
    return this.t('oldest', {
      age: reportAge(oldest, this.i18n.language(), this.now()),
    });
  });

  protected readonly more = computed(
    () =>
      !this.overview &&
      this.items().length - this.decisions().size < this.total(),
  );
  protected readonly all = computed(() =>
    this.overview && this.total() > PANEL_ITEMS
      ? this.t('all', { total: formatNum(this.total(), this.i18n.language()) })
      : undefined,
  );

  protected readonly pending = computed(() =>
    this.queue.value() ? this.total() : undefined,
  );
  protected readonly announcement = computed(() => {
    const n = this.pending() ?? 0;
    return this.t('announce', {
      count: n,
      n: formatNum(n, this.i18n.language()),
    });
  });

  // The place of the first item "Mai multe" asked for, focused once it shows.
  private focusAt?: number;

  // An item this admin decided keeps its place and says how it ended.
  decide(item: ReportQueueItemDto, outcome: RemoveReviewResult) {
    const at = this.shown().findIndex((i) => i.report.id === item.report.id);
    this.decisions.update((map) =>
      new Map(map).set(item.report.id, { at, item, outcome }),
    );
  }

  showMore() {
    // The decided items leave once the next read is in, so the first new
    // item sits where the undecided ones end.
    const at = this.items().length - this.decisions().size;
    this.focusAt = at;
    this.pages.update((n) => n + 1);
    // A page that brought nothing drops the wish, so a later live re-read
    // that adds an item does not take the focus.
    void this.queue.reload().then(() => {
      // A failed read keeps the old page, which still lists the decided
      // items: they keep their outcome until a read leaves them out.
      if (!this.queue.failed()) this.decisions.set(new Map());
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
