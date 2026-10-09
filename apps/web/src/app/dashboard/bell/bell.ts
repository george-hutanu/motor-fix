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
import { I18n, TranslatePipe } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';
import { toast } from '@motor-fix/ui-cockpit';

import { BellList } from '../bell-list/bell-list';
import { Live } from '../live';

const REFRESH_MS = 60_000;

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
  // The bell left the screen (a sign-out navigates away): its open list closes.
  readonly ended = signal(false);
  private next: string | null = null;
  // Count requests in the order they were sent, and the one the badge shows.
  private asked = 0;
  private shown = 0;
  private readonly reading = new Set<string>();

  constructor() {
    const destroyRef = inject(DestroyRef);
    destroyRef.onDestroy(() => this.ended.set(true));
    inject(Live)
      .events.pipe(takeUntilDestroyed(destroyRef))
      .subscribe((message) => {
        if (message.kind === 'notification.created')
          void this.arrived(message.id);
        if (message.kind === 'notification.read')
          void this.readElsewhere(message.id, message.at);
      });
    if (isPlatformBrowser(inject(PLATFORM_ID))) {
      const timer = setInterval(() => void this.refreshCount(), REFRESH_MS);
      destroyRef.onDestroy(() => clearInterval(timer));
    }
    void this.refreshCount();
  }

  // A failed count keeps the last one shown, and so does an answer to an
  // older request than the one shown; the caller still gets its own answer.
  async refreshCount() {
    const asked = ++this.asked;
    try {
      const { count } = await this.api.bellControllerUnreadCount();
      if (asked > this.shown) {
        this.shown = asked;
        this.count.set(count);
      }
      return count;
    } catch {
      // Tried again at the next refresh.
      return null;
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

  // One page at a time: a second tap while one loads does nothing.
  async loadMore() {
    const cursor = this.next;
    if (!cursor) return;
    this.follow(null);
    try {
      const page = await this.page(cursor);
      this.items.update((items) => [...items, ...page.items]);
      this.follow(page.nextCursor);
    } catch {
      this.follow(cursor);
      toast(this.i18n.t('shell.bell.failed'));
    }
  }

  async read(id: string) {
    const row = this.items().find((n) => n.id === id);
    if (row?.readAt || this.reading.has(id)) return;
    this.reading.add(id);
    const sent = this.asked;
    try {
      const read = await this.api.bellControllerRead({ id });
      this.items.update((items) => items.map((n) => (n.id === id ? read : n)));
      // The live echo of this read may already have lowered the count; a
      // count asked for after the read was sent already holds it.
      if ((await this.refreshCount()) === null && this.shown <= sent)
        this.count.update((count) => Math.max(0, count - 1));
    } catch {
      toast(this.i18n.t('shell.bell.readFailed'));
    } finally {
      this.reading.delete(id);
    }
  }

  async readAll() {
    try {
      await this.api.bellControllerReadAll();
      const at = new Date().toISOString();
      this.items.update((items) =>
        items.map((n) => (n.readAt ? n : { ...n, readAt: at })),
      );
      // A count already in flight was asked before this and answers too late.
      this.shown = ++this.asked;
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
      const row = page.items.find((n) => n.id === id);
      if (this.state() === 'ready') this.merge(page.items);
      // The requests feed already toasts a new quote request.
      if (row?.kind === 'REQUEST_RECEIVED') return;
      text = row?.text ?? text;
    } catch {
      // The toast still says something arrived.
    }
    toast(text, { duration: 5000 });
  }

  // A read, this tab's own echo included, may touch any page: the rows loaded
  // stay, and "Mai multe" keeps following the last one. A "mark all" carries
  // the account's id, so it shows as an unread count of zero.
  private async readElsewhere(id: string, at: string) {
    this.markRead((n) => n.id === id, at);
    // Rows that join while the count is reloading are newer than it.
    const shown = new Set(this.items().map((n) => n.id));
    if ((await this.refreshCount()) === 0)
      this.markRead((n) => shown.has(n.id), at);
    if (this.state() !== 'ready') return;
    try {
      this.merge((await this.page()).items);
    } catch {
      // The rows shown stay until the next open.
    }
  }

  private markRead(match: (n: NotificationDto) => boolean, at: string) {
    this.items.update((items) =>
      items.map((n) =>
        n.readAt === null && match(n) ? { ...n, readAt: at } : n,
      ),
    );
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
  styleUrl: './bell.css',
  templateUrl: './bell.html',
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
