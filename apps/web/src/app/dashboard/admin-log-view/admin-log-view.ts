import { _IdGenerator } from '@angular/cdk/a11y';
import {
  Component,
  computed,
  type ElementRef,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, type Params, Router } from '@angular/router';
import {
  SYSTEM_LOG_SEARCH_MIN,
  type SystemLogAddedMessage,
} from '@motor-fix/contracts/system-log';
import { AdminService, type SystemLogEntryDto } from '@motor-fix/data-access';
import { formatDay, I18n, TranslatePipe } from '@motor-fix/i18n';
import { HlmButton } from '@motor-fix/ui-cockpit';
import { filter } from 'rxjs';

import {
  filterOf,
  filtersSet,
  includesToday,
  type LogFilter,
  paramsOf,
  passes,
  queryOf,
} from './narrowing';
import { lineView } from '../admin-log/admin-log.line';
import { LogLines } from '../admin-log/log-lines/log-lines';
import { AdminLogFilters } from '../admin-log-filters/admin-log-filters';
import { Live } from '../live';

type Load = 'loading' | 'ready' | 'failed';

const sameFilter = (a: LogFilter, b: LogFilter) =>
  a.from === b.from &&
  a.to === b.to &&
  a.type === b.type &&
  a.severity === b.severity &&
  a.source === b.source &&
  a.q === b.q;

// The admin's whole system log: the entries of the range the address names,
// newest first under one heading per Bucharest day, more as the admin
// scrolls, and a count of the matching entries written since.
@Component({
  imports: [AdminLogFilters, HlmButton, LogLines, TranslatePipe],
  selector: 'mf-admin-log-view',
  styleUrl: './admin-log-view.css',
  templateUrl: './admin-log-view.html',
})
export class AdminLogView {
  private readonly api = inject(AdminService);
  private readonly i18n = inject(I18n);
  private readonly live = inject(Live);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly sentinel = viewChild<ElementRef<HTMLElement>>('sentinel');
  private observer: IntersectionObserver | undefined;
  protected readonly headingId = inject(_IdGenerator).getId('mf-log-view-');

  private readonly params = toSignal(this.route.queryParams, {
    initialValue: {} as Params,
  });
  // The address is the source of truth: the controls and the list follow it.
  protected readonly filter = computed(
    () => filterOf(this.params(), new Date()).filter,
    { equal: sameFilter },
  );
  protected readonly isNarrowed = computed(
    () => this.filter().q !== '' || filtersSet(this.filter(), new Date()) > 0,
  );
  // Each read's number: an answer to an older one is dropped.
  private read = 0;

  private readonly items = signal<SystemLogEntryDto[]>([]);
  private readonly cursor = signal<string | null>(null);
  protected readonly listState = signal<Load>('loading');
  protected readonly moreState = signal<'idle' | 'loading' | 'failed'>('idle');
  protected readonly hasMore = computed(
    () => this.listState() === 'ready' && this.cursor() !== null,
  );
  protected readonly fresh = signal(0);

  protected readonly days = computed(() => {
    const language = this.i18n.language();
    const days: { name: string; lines: ReturnType<typeof lineView>[] }[] = [];
    for (const entry of this.items()) {
      const name = formatDay(entry.at, language);
      if (days.at(-1)?.name !== name) days.push({ lines: [], name });
      days.at(-1)?.lines.push(lineView(entry, this.i18n));
    }
    return days;
  });

  constructor() {
    void this.i18n.enter('admin');
    // A value the view does not know, or a lone date, is fixed in place.
    effect(() => {
      const { filter, rewrite } = filterOf(this.params(), new Date());
      if (rewrite) untracked(() => this.write(filter, true));
    });
    effect(() => {
      this.filter();
      untracked(() => void this.readFirst());
    });
    // The sentinel after the last line asks for the next page as it comes
    // into view; it is there only while one is left.
    effect((onCleanup) => {
      const element = this.sentinel()?.nativeElement;
      if (!element || typeof IntersectionObserver === 'undefined') return;
      const observer = new IntersectionObserver((entries) => {
        if (entries.some((e) => e.isIntersecting))
          untracked(() => void this.readMore());
      });
      observer.observe(element);
      this.observer = observer;
      onCleanup(() => {
        observer.disconnect();
        this.observer = undefined;
      });
    });
    // A new entry is counted, not shown: the list stays where the admin is.
    this.live.events
      .pipe(
        filter((m) => m.kind === 'system_log.added'),
        takeUntilDestroyed(),
      )
      .subscribe((message) => {
        const filter = this.filter();
        if (
          includesToday(filter, new Date()) &&
          passes(filter, message as SystemLogAddedMessage)
        )
          this.fresh.update((n) => n + 1);
      });
    this.live.resync
      .pipe(takeUntilDestroyed())
      .subscribe(() => void this.readFirst());
  }

  protected readonly freshName = computed(() =>
    this.i18n.t('admin.log.view.fresh', {
      count: this.fresh(),
      n: this.fresh(),
    }),
  );

  protected async readFirst() {
    const read = ++this.read;
    this.fresh.set(0);
    this.listState.set('loading');
    this.moreState.set('idle');
    try {
      const page = await this.api.systemLogControllerList(
        queryOf(this.filter()),
      );
      if (read !== this.read) return;
      this.items.set(page.items);
      this.cursor.set(page.nextCursor);
      this.listState.set('ready');
    } catch {
      if (read === this.read) this.listState.set('failed');
    }
  }

  protected async readMore(retry = false) {
    const cursor = this.cursor();
    if (cursor === null || this.moreState() === 'loading') return;
    if (this.moreState() === 'failed' && !retry) return;
    const read = this.read;
    this.moreState.set('loading');
    try {
      const page = await this.api.systemLogControllerList(
        queryOf(this.filter(), cursor),
      );
      if (read !== this.read) return;
      this.items.update((items) => [...items, ...page.items]);
      this.cursor.set(page.nextCursor);
      this.moreState.set('idle');
      this.lookAgain();
    } catch {
      if (read === this.read) this.moreState.set('failed');
    }
  }

  protected search(text: string) {
    const q = text.length >= SYSTEM_LOG_SEARCH_MIN ? text : '';
    if (q !== this.filter().q) this.write({ ...this.filter(), q });
  }

  protected clear() {
    this.write(filterOf({}, new Date()).filter);
  }

  // One history entry per applied change; the shell's own keys are kept.
  protected write(filter: LogFilter, replaceUrl = false) {
    const {
      from: _from,
      kind: _kind,
      q: _q,
      severity: _severity,
      source: _source,
      to: _to,
      ...rest
    } = this.params();
    void this.router.navigate([], {
      queryParams: { ...rest, ...paramsOf(filter, new Date()) },
      relativeTo: this.route,
      replaceUrl,
    });
  }

  // A sentinel still in view after a page fires no new intersection: observe
  // it afresh so the browser reports where it stands and the pages chain.
  private lookAgain() {
    const element = this.sentinel()?.nativeElement;
    if (!this.observer || !element) return;
    this.observer.unobserve(element);
    this.observer.observe(element);
  }
}
