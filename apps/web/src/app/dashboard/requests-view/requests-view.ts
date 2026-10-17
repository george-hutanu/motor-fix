import { isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  linkedSignal,
  PLATFORM_ID,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { REQUEST_STATUS_LABELS } from '@motor-fix/contracts/request-status';
import {
  type RequestSummaryDto,
  RequestsService,
} from '@motor-fix/data-access';
import { I18n, relativeTime, TranslatePipe, timeLeft } from '@motor-fix/i18n';
import { HlmButton, Panel } from '@motor-fix/ui-cockpit';

import { EmptyState } from '../empty-state/empty-state';
import { focusCard } from '../focus-card';
import { liveResource } from '../live';
import { openRequestOf } from '../quotes-compare/compare-rules/compare-rules';
import { QuotesCompare } from '../quotes-compare/quotes-compare';

interface Row {
  id: string;
  car: string;
  what: string;
  status: string;
  when: string;
  // Set while the booking waits for the garage: the time it has left.
  waiting?: string;
  quoted: boolean;
}

const TICK_MS = 60_000;

// "Cererile mele": the driver's requests, newest first, kept current by the
// request events so one sent in another tab shows up without a reload. A
// booked request waiting for the garage counts down its time to confirm.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    EmptyState,
    HlmButton,
    Panel,
    QuotesCompare,
    RouterLink,
    TranslatePipe,
  ],
  selector: 'mf-requests-view',
  styleUrl: './requests-view.css',
  templateUrl: './requests-view.html',
})
export class RequestsView {
  private readonly api = inject(RequestsService);
  private readonly i18n = inject(I18n);
  protected readonly language = this.i18n.language;
  protected readonly list = liveResource(
    () => this.api.requestsControllerList(),
    ['request.created', 'quote.sent', 'request.declined', 'quote.accepted'],
  );
  private readonly now = signal(new Date());
  protected readonly rows = computed(() => {
    const items = this.list.value()?.items;
    if (!items) return undefined;
    const language = this.language();
    const now = this.now();
    return items.map((item) => this.row(item, language, now));
  });

  private readonly query = toSignal(inject(ActivatedRoute).queryParamMap);
  // The default request: the newest still open, picked once and kept while
  // it is listed, so a live re-read never moves the panel (313-FR-010).
  private readonly fallback = linkedSignal<
    readonly RequestSummaryDto[],
    string | undefined
  >({
    computation: (items, previous) =>
      previous?.value && items.some((i) => i.id === previous.value)
        ? previous.value
        : openRequestOf(items)?.id,
    source: () => this.list.value()?.items ?? [],
  });
  // The request whose quotes are compared above the list: the one the
  // address names when it is the driver's and has quotes, else the default.
  // A list of one, so another request makes a new panel.
  protected readonly compared = computed(() => {
    const items = this.list.value()?.items ?? [];
    const asked = this.query()?.get('request');
    const named = items.find((i) => i.id === asked && i.quotesCount > 0);
    const shown = named?.id ?? this.fallback();
    return shown ? [shown] : [];
  });

  constructor() {
    void this.i18n.enter('driver');
    focusCard('data-request', this.rows);
    if (!isPlatformBrowser(inject(PLATFORM_ID))) return;
    const tick = setInterval(() => this.now.set(new Date()), TICK_MS);
    inject(DestroyRef).onDestroy(() => clearInterval(tick));
  }

  private row(item: RequestSummaryDto, language: 'ro' | 'en', now: Date): Row {
    const { brand, model, year } = item.car;
    const jobs = item.jobs.map((job) =>
      language === 'en' ? job.nameEn : job.nameRo,
    );
    return {
      car: `${brand} ${model} ${year}`,
      id: item.id,
      quoted: item.quotesCount > 0,
      status: REQUEST_STATUS_LABELS[language][item.status],
      what: jobs.length
        ? jobs.join(', ')
        : (item.description ?? '').split('\n')[0],
      when: relativeTime(item.createdAt, language, now),
      ...(item.status === 'booked' &&
        item.booking?.status === 'awaiting_confirmation' && {
          waiting: timeLeft(item.booking.confirmBy, language, now),
        }),
    };
  }
}
