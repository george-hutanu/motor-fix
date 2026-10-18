import {
  Component,
  computed,
  inject,
  input,
  linkedSignal,
  type OnDestroy,
  output,
} from '@angular/core';
import { SYSTEM_LOG_SEARCH_MAX } from '@motor-fix/contracts/system-log';
import { I18n, TranslatePipe } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';

import { LogPickers } from './log-pickers/log-pickers';
import { AdminLogFiltersSheet } from '../admin-log-filters-sheet/admin-log-filters-sheet';
import {
  filtersSet,
  type LogChoice,
  type LogFilter,
  searchText,
} from '../admin-log-view/narrowing';

// The wait after the last key before the text is searched for.
const SETTLE_MS = 300;

// The log's search box, pickers and dates: from 768 px one row, below it the
// search box over one button opening the same pickers in a sheet.
@Component({
  imports: [LogPickers, TranslatePipe],
  selector: 'mf-admin-log-filters',
  styleUrl: './admin-log-filters.css',
  templateUrl: './admin-log-filters.html',
})
export class AdminLogFilters implements OnDestroy {
  private readonly i18n = inject(I18n);
  private readonly overlays = inject(Overlays);
  private wait: ReturnType<typeof setTimeout> | undefined;

  readonly filter = input.required<LogFilter>();
  // The settled search text, 300 ms after the last key. Neither output
  // shares a name with a DOM event: the box's search and the pickers' change
  // events bubble to the host, where a binding would take them for these.
  readonly settled = output<string>();
  // The whole filter, at each choice the pickers allow.
  readonly narrowed = output<LogFilter>();

  protected readonly max = SYSTEM_LOG_SEARCH_MAX;
  // What the box holds: the address's text until the admin types, and the
  // typed text while the address only catches up with it.
  protected readonly text = linkedSignal<string, string>({
    computation: (q, previous) =>
      previous !== undefined && searchText(previous.value) === q
        ? previous.value
        : q,
    source: () => this.filter().q,
  });
  protected readonly choice = computed<LogChoice>(
    () => {
      const { q: _q, ...choice } = this.filter();
      return choice;
    },
    {
      equal: (a, b) =>
        a.from === b.from &&
        a.to === b.to &&
        a.type === b.type &&
        a.severity === b.severity &&
        a.source === b.source,
    },
  );
  protected readonly set = computed(() =>
    filtersSet(this.filter(), new Date()),
  );
  protected readonly buttonName = computed(() => {
    const n = this.set();
    return n === 0
      ? this.i18n.t('admin.log.view.filters.button')
      : this.i18n.t('admin.log.view.filters.buttonSet', { count: n, n });
  });

  constructor() {
    void this.i18n.enter('admin');
  }

  protected type(value: string) {
    this.text.set(value);
    clearTimeout(this.wait);
    this.wait = setTimeout(() => {
      this.wait = undefined;
      this.settled.emit(searchText(value));
    }, SETTLE_MS);
  }

  protected choose(choice: LogChoice) {
    this.narrowed.emit({ ...choice, q: this.filter().q });
  }

  protected async openSheet() {
    const chosen = await this.overlays.open<LogChoice, LogChoice>(
      AdminLogFiltersSheet,
      {
        confirmDiscard: false,
        data: this.choice(),
        shape: 'dialog',
        title: 'admin.log.view.filters.title',
      },
    );
    if (chosen !== 'cancelled') this.choose(chosen);
  }

  ngOnDestroy() {
    clearTimeout(this.wait);
  }
}
