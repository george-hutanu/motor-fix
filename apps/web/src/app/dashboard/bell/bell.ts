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
import { Router } from '@angular/router';
import type { LiveMessage } from '@motor-fix/contracts';
import {
  type NotificationDto,
  NotificationsService,
} from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';
import { toast } from '@motor-fix/ui-cockpit';

import { BellList } from '../bell-list/bell-list';
import { Live } from '../live';
import { Session } from '../session';

const REFRESH_MS = 60_000;

// The bell's count and rows, kept current by the live connection and a
// one-minute refresh for when that connection is down.
@Injectable()
export class BellStore {
  private readonly api = inject(NotificationsService);
  private readonly i18n = inject(I18n);
  private readonly session = inject(Session);
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
  // First-page requests in the order they were sent, and the one shown.
  private pageAsked = 0;
  private pageShown = 0;
  // When the count a live message carried was true; an older one is stale.
  private carriedAt: string | null = null;

  constructor() {
    const destroyRef = inject(DestroyRef);
    destroyRef.onDestroy(() => this.ended.set(true));
    inject(Live)
      .events.pipe(takeUntilDestroyed(destroyRef))
      .subscribe((message) => {
        if (message.kind === 'notification.created') void this.arrived(message);
        if (message.kind === 'notification.read')
          void this.readElsewhere(message);
      });
    if (isPlatformBrowser(inject(PLATFORM_ID))) {
      const timer = setInterval(() => void this.refreshCount(), REFRESH_MS);
      destroyRef.onDestroy(() => clearInterval(timer));
    }
    void this.refreshCount();
  }

  // A failed count keeps the last one shown, and so does an answer to an
  // older request than the one shown; the caller still gets its own answer.
  // Without a token the call would only be refused: the next tick asks again.
  async refreshCount() {
    if (!this.session.token()) return null;
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
    const asked = ++this.pageAsked;
    try {
      const page = await this.page();
      if (!this.newest(asked)) return;
      this.items.set(page.items);
      this.follow(page.nextCursor);
      this.state.set('ready');
    } catch {
      if (asked > this.pageShown) this.state.set('error');
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

  // The row and the count show the read at once; a failure puts back only
  // what nothing newer has changed since.
  async read(id: string) {
    const row = this.items().find((n) => n.id === id);
    if (row?.readAt || this.reading.has(id)) return;
    this.reading.add(id);
    const at = new Date().toISOString();
    this.markRead((n) => n.id === id, at);
    const shownAtPress = this.show(Math.max(0, this.count() - 1));
    try {
      const read = await this.api.bellControllerRead({ id });
      this.items.update((items) => items.map((n) => (n.id === id ? read : n)));
      await this.refreshCount();
    } catch {
      this.unmark((n) => n.id === id, at);
      if (this.shown === shownAtPress) this.count.update((count) => count + 1);
      toast(this.i18n.t('shell.bell.readFailed'));
    } finally {
      this.reading.delete(id);
    }
  }

  async readAll() {
    const at = new Date().toISOString();
    const unread = new Set(
      this.items()
        .filter((n) => !n.readAt)
        .map((n) => n.id),
    );
    const before = this.count();
    this.markRead((n) => unread.has(n.id), at);
    // A count already in flight was asked before this and answers too late.
    const shownAtPress = this.show(0);
    try {
      await this.api.bellControllerReadAll();
    } catch {
      this.unmark((n) => unread.has(n.id), at);
      if (this.shown === shownAtPress) this.count.set(before);
      toast(this.i18n.t('shell.bell.readFailed'));
    }
  }

  // Shows a count of this tab's own making, newer than any still being asked.
  private show(count: number) {
    this.shown = ++this.asked;
    this.count.set(count);
    return this.shown;
  }

  private unmark(match: (n: NotificationDto) => boolean, at: string) {
    this.items.update((items) =>
      items.map((n) =>
        n.readAt === at && match(n) ? { ...n, readAt: null } : n,
      ),
    );
  }

  private newest(asked: number) {
    if (asked <= this.pageShown) return false;
    this.pageShown = asked;
    return true;
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

  // The count a live message carries, unless a newer one was already shown;
  // it also outranks any count still being asked for. Null when it has none.
  private carried({ at, unreadCount }: LiveMessage): number | null {
    if (typeof unreadCount !== 'number') return null;
    if (this.carriedAt === null || at >= this.carriedAt) {
      this.carriedAt = at;
      this.shown = ++this.asked;
      this.count.set(unreadCount);
    }
    return unreadCount;
  }

  // The new row joins the top; the pages already shown stay.
  private async arrived(message: LiveMessage) {
    const { id } = message;
    if (this.carried(message) === null) void this.refreshCount();
    let text = this.i18n.t('shell.bell.new');
    const asked = ++this.pageAsked;
    try {
      const page = await this.page();
      const row = page.items.find((n) => n.id === id);
      if (this.state() === 'ready' && this.newest(asked))
        this.merge(page.items);
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
  private async readElsewhere(message: LiveMessage) {
    const { id, at } = message;
    this.markRead((n) => n.id === id, at);
    // Rows that join while the count is reloading are newer than it.
    const shown = new Set(this.items().map((n) => n.id));
    if ((this.carried(message) ?? (await this.refreshCount())) === 0)
      this.markRead((n) => shown.has(n.id), at);
    if (this.state() !== 'ready') return;
    const asked = ++this.pageAsked;
    try {
      const { items } = await this.page();
      if (this.newest(asked)) this.merge(items);
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

  // A row this tab is reading stays read when the page still lists it
  // unread: the read may not have reached the server yet.
  private merge(first: readonly NotificationDto[]) {
    const fresh = new Set(first.map((n) => n.id));
    this.items.update((items) => {
      const shown = new Map(items.map((n) => [n.id, n]));
      return [
        ...first.map((n) =>
          n.readAt === null && this.reading.has(n.id)
            ? (shown.get(n.id) ?? n)
            : n,
        ),
        ...items.filter((n) => !fresh.has(n.id)),
      ];
    });
  }
}

// In every dashboard's header; the list opens in a drawer, a bottom sheet on
// a phone.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [BellStore],
  selector: 'mf-bell',
  styleUrl: './bell.css',
  templateUrl: './bell.html',
})
export class Bell {
  private readonly store = inject(BellStore);
  private readonly overlays = inject(Overlays);
  private readonly router = inject(Router);
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

  // A row that names a view closes the list on its address; going there
  // waits for the close, whose step back the router replays first.
  protected async openList() {
    void this.store.load();
    void this.store.refreshCount();
    const link = await this.overlays.open<string | undefined, BellStore>(
      BellList,
      { data: this.store, shape: 'drawer', title: 'shell.bell.title' },
    );
    if (link && link !== 'cancelled') void this.router.navigateByUrl(link);
  }
}
