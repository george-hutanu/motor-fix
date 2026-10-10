import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
} from '@angular/core';
import { Router } from '@angular/router';
import type { NotificationDto } from '@motor-fix/data-access';
import { formatDay, I18n, TranslatePipe } from '@motor-fix/i18n';
import { injectOverlayTask } from '@motor-fix/overlays';
import { HlmButton } from '@motor-fix/ui-cockpit';

import type { BellStore } from '../bell/bell';

const MINUTE = 60_000;

// "acum 5 min" up to a day, then the day in Bucharest.
export function ago(at: string, now: Date, i18n: I18n): string {
  const minutes = Math.floor((now.getTime() - new Date(at).getTime()) / MINUTE);
  if (minutes < 1) return i18n.t('shell.bell.now');
  if (minutes < 60) return i18n.t('shell.bell.minutes', { n: minutes });
  if (minutes < 24 * 60) {
    return i18n.t('shell.bell.hours', { n: Math.floor(minutes / 60) });
  }
  return formatDay(at, i18n.language());
}

// The person's notifications, newest first; opening one marks it read and,
// when it names a view, closes the list and goes there.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmButton, TranslatePipe],
  selector: 'mf-bell-list',
  styleUrl: './bell-list.css',
  templateUrl: './bell-list.html',
})
export class BellList {
  private readonly task = injectOverlayTask<BellStore, void>();
  protected readonly store = this.task.data;
  private readonly i18n = inject(I18n);
  private readonly router = inject(Router);
  private readonly now = new Date();
  protected readonly unread = computed(() =>
    this.store.items().some((n) => !n.readAt),
  );

  constructor() {
    // The overlay outlives a navigation, so it does not close with the bell.
    effect(() => {
      if (this.store.ended()) this.task.close();
    });
  }

  protected open(item: NotificationDto) {
    void this.store.read(item.id);
    if (!item.link) return;
    this.task.close();
    void this.router.navigateByUrl(item.link);
  }

  protected when(at: string) {
    return ago(at, this.now, this.i18n);
  }
}
