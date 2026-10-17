import { _IdGenerator } from '@angular/cdk/a11y';
import { isPlatformBrowser } from '@angular/common';
import {
  Component,
  computed,
  DestroyRef,
  inject,
  PLATFORM_ID,
} from '@angular/core';
import { AdminService, type SystemLogEntryDto } from '@motor-fix/data-access';
import {
  bucharestDayStart,
  formatClock,
  I18n,
  TranslatePipe,
} from '@motor-fix/i18n';
import { HlmButton, Lamp, type LampState } from '@motor-fix/ui-cockpit';
import { filter } from 'rxjs';

import { lineOf } from './admin-log.line';
import { liveView } from '../../live/view';
import { Live } from '../live';

const LAMPS: Record<SystemLogEntryDto['severity'], LampState> = {
  error: 'red',
  info: 'grey',
  warning: 'amber',
};
// Longer than any day, a summer-time change included, shorter than two.
const PAST_TOMORROW = 26 * 3_600_000;
const AFTER_MIDNIGHT = 1_000;

@Component({
  imports: [HlmButton, Lamp, TranslatePipe],
  selector: 'mf-admin-log',
  styleUrl: './admin-log.css',
  templateUrl: './admin-log.html',
})
export class AdminLog {
  private readonly api = inject(AdminService);
  private readonly i18n = inject(I18n);
  private readonly live = inject(Live);
  protected readonly headingId = inject(_IdGenerator).getId('mf-log-');

  // Read in the browser only: the server render shows the loading lines.
  protected readonly view = isPlatformBrowser(inject(PLATFORM_ID))
    ? liveView(
        () =>
          this.api.systemLogControllerList({
            from: bucharestDayStart(new Date()).toISOString(),
          }),
        {
          changes: this.live.events.pipe(
            filter((m) => m.kind === 'system_log.added'),
          ),
          goneOn: [],
          resync: this.live.resync,
          retryAfter: 60_000,
        },
      )
    : undefined;

  protected readonly lines = computed(() =>
    (this.view?.value()?.items ?? []).map((entry) => ({
      at: entry.at,
      clock: formatClock(entry.at),
      count:
        entry.count > 1
          ? {
              mark: `×${entry.count}`,
              words: this.i18n.t('admin.log.times', {
                count: entry.count,
                n: entry.count,
              }),
            }
          : undefined,
      id: entry.id,
      lamp: LAMPS[entry.severity],
      text: lineOf(entry, this.i18n),
      word: this.i18n.t(`admin.log.severity.${entry.severity}`),
    })),
  );

  constructor() {
    void this.i18n.enter('admin');
    if (this.view) this.atMidnight(inject(DestroyRef));
  }

  // A new day in Bucharest starts an empty log: read again just after midnight.
  private atMidnight(destroyRef: DestroyRef) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      const now = Date.now();
      const today = bucharestDayStart(new Date(now)).getTime();
      const tomorrow = bucharestDayStart(new Date(today + PAST_TOMORROW));
      timer = setTimeout(
        () => {
          this.view?.reload();
          arm();
        },
        tomorrow.getTime() - now + AFTER_MIDNIGHT,
      );
    };
    arm();
    destroyRef.onDestroy(() => clearTimeout(timer));
  }
}
