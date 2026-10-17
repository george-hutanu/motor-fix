import { isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  Injector,
  inject,
  input,
  type OnInit,
  PLATFORM_ID,
  runInInjectionContext,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import type { EventKind } from '@motor-fix/contracts';
import { DECLINE_REASON_TEXTS } from '@motor-fix/contracts/request-status';
import {
  type QuoteComparisonDto,
  QuoteRequestsService,
  QuotesService,
} from '@motor-fix/data-access';
import { I18n, TranslatePipe } from '@motor-fix/i18n';
import { toProblem } from '@motor-fix/overlays';
import { HlmButton } from '@motor-fix/ui-cockpit';

import {
  headerCount,
  headerWhat,
  rowState,
  SORT_KEY,
  SORTS,
  type Sort,
  sortQuotes,
  storedSort,
} from './compare-rules/compare-rules';
import { QuoteRow } from './quote-row/quote-row';
import type { LiveView } from '../../live/view';
import { EmptyState } from '../empty-state/empty-state';
import { Live, liveResource } from '../live';
import { TiePipe } from '../tie/tie';

// Every event that changes a row, a line or whether Acceptă is offered.
const KINDS: readonly EventKind[] = [
  'quote.sent',
  'quote.changed',
  'quote.withdrawn',
  'quote.expired',
  'quote.declined_by_driver',
  'request.declined',
  'request.decline_undone',
  'garage.suspended',
  'quote.accepted',
  'booking.confirmed',
  'booking.lapsed',
];

// The clock the rows read: expiry, "azi" and "Modificată acum …" move with it.
const TICK_MS = 60_000;

const SORT_LABELS: Record<Sort, string> = {
  earliest: 'driver.quotes.sort.earliest',
  fastest: 'driver.quotes.sort.fastest',
  price: 'driver.quotes.sort.price',
  rating: 'driver.quotes.sort.rating',
};

// The quotes one request received, side by side: the same facts in every
// row, a sort kept for the tab, and Acceptă on each quote still open. The
// rows follow the quote events, so a new answer shows up without a reload.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    EmptyState,
    HlmButton,
    QuoteRow,
    RouterLink,
    TiePipe,
    TranslatePipe,
  ],
  selector: 'mf-quotes-compare',
  styleUrl: './quotes-compare.css',
  templateUrl: './quotes-compare.html',
})
export class QuotesCompare implements OnInit {
  readonly requestId = input.required<string>();

  private readonly api = inject(QuoteRequestsService);
  private readonly quotesApi = inject(QuotesService);
  private readonly i18n = inject(I18n);
  private readonly injector = inject(Injector);
  protected readonly offline = inject(Live).offline;
  protected readonly language = this.i18n.language;
  protected readonly sorts = SORTS;
  protected readonly sortLabels = SORT_LABELS;
  protected readonly sort = signal<Sort>(
    storedSort(() => sessionStorage.getItem(SORT_KEY)),
  );
  // The panel reads once its request is known: inputs are set after the
  // constructor, and a parent makes a new panel for another request.
  protected view!: LiveView<QuoteComparisonDto>;

  protected readonly busy = signal<string | null>(null);
  protected readonly problems = signal<Record<string, string>>({});
  // A click that got no answer is sent again with the same key, so the
  // server answers it once.
  private unanswered: { id: string; key: string } | null = null;
  protected readonly now = signal(new Date());

  constructor() {
    if (!isPlatformBrowser(inject(PLATFORM_ID))) return;
    const tick = setInterval(() => this.now.set(new Date()), TICK_MS);
    inject(DestroyRef).onDestroy(() => clearInterval(tick));
  }

  protected readonly header = computed(() => {
    const data = this.view.value();
    if (!data) return '';
    const { car } = data.request;
    return [
      headerWhat(data.request, this.language()),
      `${car.brand} ${car.model}`,
      this.i18n.t('driver.quotes.count', { count: headerCount(data.quotes) }),
    ]
      .filter(Boolean)
      .join(' · ');
  });
  protected readonly rows = computed(() => {
    const data = this.view.value();
    if (!data) return undefined;
    const now = this.now();
    return sortQuotes(data.quotes, this.sort()).map((quote) => ({
      quote,
      state: rowState(quote, data.request.booking, now),
    }));
  });
  protected readonly lines = computed(() => {
    const data = this.view.value();
    if (!data) return [];
    const language = this.language();
    return [
      ...data.withdrawn.map((w) =>
        this.i18n.t(`driver.quotes.withdrawn.${w.reason}`, {
          name: w.garageName,
        }),
      ),
      ...data.declined.map((d) =>
        this.i18n.t('driver.quotes.declined', {
          name: d.garageName,
          why: DECLINE_REASON_TEXTS[d.declineReason].clause[language],
        }),
      ),
    ];
  });

  ngOnInit() {
    runInInjectionContext(this.injector, () => {
      this.view = liveResource(
        () => this.api.compareControllerGet({ id: this.requestId() }),
        KINDS,
      );
    });
  }

  protected choose(sort: Sort) {
    this.sort.set(sort);
    try {
      sessionStorage.setItem(SORT_KEY, sort);
    } catch {
      // A tab that cannot store keeps the sort until it closes the panel.
    }
  }

  protected async accept(id: string) {
    if (this.busy() || this.offline()) return;
    const key =
      this.unanswered?.id === id ? this.unanswered.key : crypto.randomUUID();
    this.unanswered = { id, key };
    this.busy.set(id);
    this.problems.update(({ [id]: _, ...rest }) => rest);
    try {
      await this.quotesApi.acceptControllerAccept({
        body: { historyShared: false },
        'Idempotency-Key': key,
        id,
      });
      this.unanswered = null;
      this.view.reload();
    } catch (error) {
      const problem = toProblem(error);
      if (problem.status !== 0) this.unanswered = null;
      this.problems.update((all) => ({ ...all, [id]: this.wording(problem) }));
    } finally {
      this.busy.set(null);
    }
  }

  private wording({ code, detail }: { code: string; detail?: string }) {
    if (detail) return detail;
    const key = `shell.form.problem.${code}`;
    const text = this.i18n.t(key);
    return text === key ? this.i18n.t('shell.form.problem.error') : text;
  }
}
