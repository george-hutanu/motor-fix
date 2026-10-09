import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  type ElementRef,
  inject,
  linkedSignal,
  PLATFORM_ID,
  signal,
  viewChild,
} from '@angular/core';
import type { GarageRequestSummaryDto } from '@motor-fix/data-access';
import { TranslatePipe } from '@motor-fix/i18n';

import {
  LiveAnchor,
  LiveChange,
  LivePill,
  liveRows,
} from '../../live-in-place/live-in-place';
import { GarageRequestsFeed } from '../garage-requests-feed';
import { moreRows } from '../more-rows/more-rows';
import { QuoteSentRow } from '../quote-sent-row/quote-sent-row';

const SLOT_TICK_MS = 60_000;

interface Arrivals {
  // Undefined until the first read: nothing on it counts as just arrived.
  seen?: ReadonlySet<string>;
  fresh: ReadonlySet<string>;
}

// "Oferte trimise": the requests the garage has answered, newest sent first,
// 20 at a time. A quote sent from elsewhere arrives at the top, highlighted.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LiveAnchor, LiveChange, LivePill, QuoteSentRow, TranslatePipe],
  selector: 'mf-quotes-sent-panel',
  styleUrl: './quotes-sent-panel.css',
  templateUrl: './quotes-sent-panel.html',
})
export class QuotesSentPanel {
  protected readonly feed = inject(GarageRequestsFeed);
  private readonly window = inject(DOCUMENT).defaultView;
  protected readonly now = signal(new Date());
  private readonly end = viewChild<ElementRef<HTMLElement>>('end');
  private readonly more = moreRows(
    this.feed.quoted,
    this.feed.quotedNextCursor,
    (cursor) => this.feed.page(cursor, 'quoted'),
    this.end,
  );

  private readonly all = computed(() => {
    const first = this.feed.quoted();
    if (!first) return undefined;
    const seen = new Set(first.map((row) => row.id));
    const rest = this.more().filter((row) => !seen.has(row.id));
    return rest.length ? [...first, ...rest] : first;
  });
  protected readonly list = liveRows(
    this.all,
    (next) => this.feed.showsSent(next) || (this.window?.scrollY ?? 0) <= 0,
  );
  // Rows of a re-read of the first page that no earlier read held.
  private readonly arrivals = linkedSignal<
    readonly GarageRequestSummaryDto[] | undefined,
    Arrivals
  >({
    computation: (rows, previous) => {
      const before = previous?.value.seen;
      if (!rows) return { fresh: new Set(), seen: before };
      const ids = rows.map((row) => row.id);
      if (!before) return { fresh: new Set(), seen: new Set(ids) };
      return {
        fresh: new Set(ids.filter((id) => !before.has(id))),
        seen: new Set([...before, ...ids]),
      };
    },
    source: this.feed.quoted,
  });
  protected readonly fresh = computed(() => this.arrivals().fresh);

  constructor() {
    if (!isPlatformBrowser(inject(PLATFORM_ID))) return;
    const tick = setInterval(() => this.now.set(new Date()), SLOT_TICK_MS);
    inject(DestroyRef).onDestroy(() => clearInterval(tick));
  }
}
