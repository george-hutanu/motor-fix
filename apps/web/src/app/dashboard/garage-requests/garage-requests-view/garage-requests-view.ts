import {
  afterNextRender,
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  type ElementRef,
  effect,
  Injector,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import type { GarageRequestSummaryDto } from '@motor-fix/data-access';
import { TranslatePipe } from '@motor-fix/i18n';

import { GarageRequestRow } from '../garage-request-row/garage-request-row';
import { GarageRequestsFeed } from '../garage-requests-feed';
import { GarageRequestsPanel } from '../garage-requests-panel/garage-requests-panel';

// "Cereri de ofertă": every waiting request, 20 more each time the list's end
// comes into view, then those the driver closed in the last day, greyed.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [GarageRequestRow, GarageRequestsPanel, TranslatePipe],
  selector: 'mf-garage-requests-view',
  styleUrl: './garage-requests-view.css',
  templateUrl: './garage-requests-view.html',
})
export class GarageRequestsView {
  protected readonly feed = inject(GarageRequestsFeed);
  private readonly sentinel = viewChild<ElementRef<HTMLElement>>('end');
  protected readonly more = signal<readonly GarageRequestSummaryDto[]>([]);
  // Where the next page starts: undefined until the first page is read.
  private cursor: string | null | undefined;
  private reading = false;
  // Watches the end again once the new rows are drawn, so an end still in view asks once more.
  private watchAgain: () => void = () => undefined;
  private readonly injector = inject(Injector);

  constructor() {
    // A re-read of the first page reads the further pages again, as many rows
    // as were shown, so a scrolled list keeps its depth.
    effect(() => {
      this.feed.rows();
      const next = this.feed.nextCursor();
      untracked(() => void this.again(next));
    });
    if (typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void this.next();
    });
    let watched: HTMLElement | undefined;
    afterRenderEffect(() => {
      const end = this.sentinel()?.nativeElement;
      if (end === watched) return;
      if (watched) observer.unobserve(watched);
      if (end) observer.observe(end);
      watched = end;
    });
    this.watchAgain = () => {
      if (!watched) return;
      observer.unobserve(watched);
      observer.observe(watched);
    };
    inject(DestroyRef).onDestroy(() => observer.disconnect());
  }

  private async again(first: string | null | undefined) {
    const shown = this.more().length;
    this.cursor = first;
    if (!shown || !first) {
      this.more.set([]);
      return;
    }
    let cursor: string | null = first;
    const rows: GarageRequestSummaryDto[] = [];
    try {
      while (cursor && rows.length < shown) {
        const page = await this.feed.page(cursor);
        if (this.cursor !== first) return;
        rows.push(...page.items);
        cursor = page.nextCursor;
      }
    } catch {
      // The rows shown stay; the next re-read or scroll asks again.
      return;
    }
    this.more.set(rows);
    this.cursor = cursor;
  }

  private async next() {
    const cursor = this.cursor;
    if (!cursor || this.reading) return;
    this.reading = true;
    try {
      const page = await this.feed.page(cursor);
      if (this.cursor !== cursor) return;
      this.more.update((rows) => [...rows, ...page.items]);
      this.cursor = page.nextCursor;
      afterNextRender(() => this.watchAgain(), {
        injector: this.injector,
      });
    } catch {
      // The next time the end comes into view asks again.
    } finally {
      this.reading = false;
    }
  }
}
