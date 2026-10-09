import { DOCUMENT, isPlatformBrowser } from '@angular/common';
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
import type { GarageRequestSummaryDto } from '@motor-fix/data-access';
import { I18n, TranslatePipe } from '@motor-fix/i18n';
import { HlmButton } from '@motor-fix/ui-cockpit';

import { Live } from '../../live';
import {
  LiveAnchor,
  LiveChange,
  LivePill,
  liveRows,
} from '../../live-in-place/live-in-place';
import { GarageRequestRow } from '../garage-request-row/garage-request-row';
import { GarageRequestsFeed } from '../garage-requests-feed';

const AGE_TICK_MS = 60_000;

// "Cereri de ofertă": the garage's waiting requests, newest first. With a
// limit it is Panou's section, linking to the view; the view adds its further
// pages through `more` and puts its own rows after the list.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    GarageRequestRow,
    HlmButton,
    LiveAnchor,
    LiveChange,
    LivePill,
    RouterLink,
    TranslatePipe,
  ],
  selector: 'mf-garage-requests-panel',
  styleUrl: './garage-requests-panel.css',
  templateUrl: './garage-requests-panel.html',
})
export class GarageRequestsPanel {
  readonly limit = input<number | undefined>(undefined);
  readonly more = input<readonly GarageRequestSummaryDto[]>([]);
  // The requests page already says it in its title.
  readonly titled = input(true);
  protected readonly feed = inject(GarageRequestsFeed);
  protected readonly live = inject(Live);
  private readonly i18n = inject(I18n);
  private readonly window = inject(DOCUMENT).defaultView;
  protected readonly now = signal(new Date());

  private readonly all = computed(() => {
    const first = this.feed.rows();
    if (!first) return undefined;
    const seen = new Set(first.map((row) => row.id));
    const rest = this.more().filter((row) => !seen.has(row.id));
    const rows = rest.length ? [...first, ...rest] : first;
    const limit = this.limit();
    return limit === undefined ? rows : rows.slice(0, limit);
  });
  protected readonly list = liveRows(
    this.all,
    () => (this.window?.scrollY ?? 0) <= 0,
  );
  protected readonly reconnecting = computed(() => {
    const state = this.live.state();
    return state === 'reconnecting' || state === 'polling';
  });
  protected readonly counter = computed(() => {
    const count = this.feed.total();
    return count === undefined
      ? undefined
      : this.i18n.t('garage.requests.counter', { count });
  });
  protected readonly seeAll = computed(() => {
    const limit = this.limit();
    const total = this.feed.total();
    return limit !== undefined && total !== undefined && total > limit;
  });

  constructor() {
    if (!isPlatformBrowser(inject(PLATFORM_ID))) return;
    const tick = setInterval(() => this.now.set(new Date()), AGE_TICK_MS);
    inject(DestroyRef).onDestroy(() => clearInterval(tick));
  }
}
