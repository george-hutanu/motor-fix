import { _IdGenerator } from '@angular/cdk/a11y';
import {
  Component,
  computed,
  inject,
  input,
  linkedSignal,
  output,
} from '@angular/core';
import {
  SYSTEM_LOG_SEVERITIES,
  SYSTEM_LOG_SOURCES,
} from '@motor-fix/contracts/system-log';
import { I18n, TranslatePipe } from '@motor-fix/i18n';

import {
  dayLimits,
  LOG_TYPE_ORDER,
  type LogChoice,
  rangeFault,
} from '../../admin-log-view/narrowing';

type Field = keyof LogChoice;

// The type, severity and source pickers and the two dates, shared by the
// wide filter row and the phone's sheet. Only a range the dates allow is
// emitted; one they do not is named on the input at fault.
@Component({
  imports: [TranslatePipe],
  selector: 'mf-log-pickers',
  styleUrl: './log-pickers.css',
  templateUrl: './log-pickers.html',
})
export class LogPickers {
  private readonly i18n = inject(I18n);
  protected readonly id = inject(_IdGenerator).getId('mf-log-pickers-');
  protected readonly days = [
    { field: 'from', label: 'admin.log.view.filters.from' },
    { field: 'to', label: 'admin.log.view.filters.to' },
  ] as const;

  readonly choice = input.required<LogChoice>();
  readonly chosen = output<LogChoice>();

  protected readonly limits = dayLimits(new Date());
  // What the controls hold, an unsent range included, until the choice in
  // force changes.
  protected readonly draft = linkedSignal(() => this.choice());
  readonly fault = computed(() => rangeFault(this.draft(), new Date()));

  protected readonly pickers = computed(() => {
    const options = (all: string, keys: readonly string[], key: string) => [
      { key: '', name: this.i18n.t(`admin.log.view.filters.${all}`) },
      ...keys.map((k) => ({ key: k, name: this.i18n.t(`${key}.${k}`) })),
    ];
    return [
      {
        field: 'type',
        label: 'admin.log.view.filters.type',
        options: options('allTypes', LOG_TYPE_ORDER, 'admin.log.view.types'),
      },
      {
        field: 'severity',
        label: 'admin.log.view.filters.severity',
        options: options(
          'allSeverities',
          SYSTEM_LOG_SEVERITIES,
          'admin.log.severity',
        ),
      },
      {
        field: 'source',
        label: 'admin.log.view.filters.source',
        options: options('allSources', SYSTEM_LOG_SOURCES, 'admin.log.source'),
      },
    ] as const;
  });

  constructor() {
    void this.i18n.enter('admin');
  }

  protected pick(field: Field, value: string) {
    const next = {
      ...this.draft(),
      [field]: field === 'from' || field === 'to' ? value : value || null,
    } as LogChoice;
    this.draft.set(next);
    if (!rangeFault(next, new Date())) this.chosen.emit(next);
  }
}
