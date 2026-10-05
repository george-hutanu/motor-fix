import { isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  Injectable,
  inject,
  PLATFORM_ID,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  type NotificationDto,
  NotificationsService,
} from '@motor-fix/data-access';
import { formatDay, I18n, TranslatePipe } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';
import { toast } from '@motor-fix/ui-cockpit';

import { BellList } from './bell-list';
import { Live } from './live';

const REFRESH_MS = 60_000;
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

// The bell's count and rows, kept current by the live connection and a
// one-minute refresh for when that connection is down.
@Injectable()
export class BellStore {
  private readonly api = inject(NotificationsService);
  private readonly i18n = inject(I18n);
  readonly count = signal(0);
  readonly items = signal<readonly NotificationDto[]>([]);
  readonly state = signal<'idle' | 'loading' | 'ready' | 'error'>('idle');
  readonly more = signal(false);
  private next: string | null = null;

  constructor() {
    const destroyRef = inject(DestroyRef);
    inject(Live)
      .events.pipe(takeUntilDestroyed(destroyRef))
      .subscribe((message) => {
        if (message.kind === 'notification.created')
          void this.arrived(message.id);
        if (message.kind === 'notification.read') void this.refresh();
      });
    if (isPlatformBrowser(inject(PLATFORM_ID))) {
      const timer = setInterval(() => void this.refreshCount(), REFRESH_MS);
      destroyRef.onDestroy(() => clearInterval(timer));
    }
    void this.refreshCount();
  }

  // A failed count keeps the last one shown.
  async refreshCount() {
    try {
      this.count.set((await this.api.bellControllerUnreadCount()).count);
    } catch {
      // Tried again at the next refresh.
    }
  }

  async load() {
    this.state.set('loading');
    try {
      const page = await this.page();
      this.items.set(page.items);
      this.follow(page.nextCursor);
      this.state.set('ready');
    } catch {
      this.state.set('error');
    }
  }

  async loadMore() {
    if (!this.next) return;
    try {
      const page = await this.page(this.next);
      this.items.update((items) => [...items, ...page.items]);
      this.follow(page.nextCursor);
    } catch {
      toast(this.i18n.t('shell.bell.failed'));
    }
  }

  async read(id: string) {
    const unread = this.items().some((n) => n.id === id && !n.readAt);
    try {
      const read = await this.api.bellControllerRead({ id });
      this.items.update((items) => items.map((n) => (n.id === id ? read : n)));
      if (unread) this.count.update((count) => Math.max(0, count - 1));
    } catch {
      toast(this.i18n.t('shell.bell.readFailed'));
    }
  }

  async readAll() {
    try {
      await this.api.bellControllerReadAll();
      const at = new Date().toISOString();
      this.items.update((items) =>
        items.map((n) => (n.readAt ? n : { ...n, readAt: at })),
      );
      this.count.set(0);
    } catch {
      toast(this.i18n.t('shell.bell.readFailed'));
    }
  }

  private page(cursor?: string) {
    const language = this.i18n.language();
    return this.api.bellControllerList(
      cursor ? { cursor, language } : { language },
    );
  }

  private follow(next: string | null) {
    this.next = next;
    this.more.set(next !== null);
  }

  // The new row joins the top; the pages already shown stay.
  private async arrived(id: string) {
    void this.refreshCount();
    let text = this.i18n.t('shell.bell.new');
    try {
      const page = await this.page();
      text = page.items.find((n) => n.id === id)?.text ?? text;
      if (this.state() === 'ready') this.merge(page.items);
    } catch {
      // The toast still says something arrived.
    }
    toast(text, { duration: 5000 });
  }

  private async refresh() {
    await this.refreshCount();
    if (this.state() !== 'ready') return;
    try {
      this.merge((await this.page()).items);
    } catch {
      // The rows shown stay until the next open.
    }
  }

  private merge(first: readonly NotificationDto[]) {
    const fresh = new Set(first.map((n) => n.id));
    this.items.update((items) => [
      ...first,
      ...items.filter((n) => !fresh.has(n.id)),
    ]);
  }
}

// In every dashboard's header; the list opens in a drawer, a bottom sheet on
// a phone.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
  providers: [BellStore],
  selector: 'mf-bell',
  styles: `
    :host { display: inline-flex; }
    button {
      position: relative; display: inline-flex; align-items: center; justify-content: center;
      width: var(--mf-tap); height: var(--mf-tap); padding: 0;
      border: 1px solid var(--mf-line-strong); border-radius: var(--mf-radius-control);
      background: transparent; color: var(--mf-text-secondary); cursor: pointer;
    }
    button:hover { border-color: var(--mf-amber); color: var(--mf-amber-ink); }
    .badge {
      position: absolute; top: -6px; right: -6px; min-width: 20px; height: 20px; padding: 0 5px;
      border-radius: 10px; background: var(--mf-amber); color: var(--mf-on-amber);
      font-size: var(--mf-size-label); font-weight: 700; line-height: 20px; text-align: center;
      font-variant-numeric: tabular-nums;
    }
  `,
  template: `
    <button type="button" [attr.aria-label]="label()" (click)="openList()">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z" />
        <path d="M10 20.5a2.2 2.2 0 0 0 4 0" />
      </svg>
      @if (badge(); as text) {
        <span class="badge" aria-hidden="true">{{ text }}</span>
      }
    </button>
  `,
})
export class Bell {
  private readonly store = inject(BellStore);
  private readonly overlays = inject(Overlays);
  private readonly i18n = inject(I18n);
  protected readonly badge = computed(() => {
    const count = this.store.count();
    return count > 9 ? '9+' : count > 0 ? String(count) : '';
  });
  protected readonly label = computed(() => {
    const count = this.store.count();
    return count > 0
      ? this.i18n.t('shell.bell.label', { count })
      : this.i18n.t('shell.bell.title');
  });

  protected openList() {
    void this.store.load();
    void this.store.refreshCount();
    void this.overlays.open(BellList, {
      data: this.store,
      shape: 'drawer',
      title: 'shell.bell.title',
    });
  }
}
