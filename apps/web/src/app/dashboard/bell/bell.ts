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
  // How many counts the server or a "mark all" has given the badge: a failed
  // read puts back what it took off only while none came since the press.
  private served = 0;
  // Rows whose read from this tab is on its way, with the instant they show
  // and what they took off the count, and a "mark all" on its way.
  private readonly reading = new Map<string, { at: string; taken: number }>();
  private readingAll = false;
  // First-page requests in the order they were sent, and the one shown.
  private pageAsked = 0;
  private pageShown = 0;
  // The last first-page request sent before each row was read here: a page
  // asked by then may still list the row unread.
  private readonly readSince = new Map<string, number>();
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
        this.served++;
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
      this.items.set(this.kept(page.items, asked));
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
    // Only a listed unread row is known to be in the count.
    const mine = {
      at: new Date().toISOString(),
      taken: row && this.count() > 0 ? 1 : 0,
    };
    this.reading.set(id, mine);
    this.markRead((n) => n.id === id && n.readAt === null, mine.at);
    const served = this.served;
    this.show(this.count() - mine.taken);
    try {
      const read = await this.api.bellControllerRead({ id });
      this.items.update((items) => items.map((n) => (n.id === id ? read : n)));
      await this.refreshCount();
    } catch {
      this.putBack(id, mine, served);
      toast(this.i18n.t('shell.bell.readFailed'));
    } finally {
      if (this.reading.get(id) === mine) this.reading.delete(id);
    }
  }

  // A "mark all" pressed since owns the row and what it took.
  private putBack(
    id: string,
    mine: { at: string; taken: number },
    served: number,
  ) {
    if (this.reading.get(id) !== mine) return;
    this.unmark((n) => n.id === id, mine.at);
    if (this.served === served)
      this.count.update((count) => count + mine.taken);
  }

  // A second press while one is on its way does nothing.
  async readAll() {
    if (this.readingAll) return;
    this.readingAll = true;
    const all = { at: new Date().toISOString(), taken: 0 };
    const { taken, unread } = this.takeOver(all);
    const served = ++this.served;
    this.markRead((n) => unread.has(n.id), all.at);
    // A count already in flight was asked before this and answers too late.
    this.show(0);
    try {
      await this.api.bellControllerReadAll();
    } catch {
      this.unmark((n) => unread.has(n.id), all.at);
      if (this.served === served) this.count.update((count) => count + taken);
      toast(this.i18n.t('shell.bell.readFailed'));
    } finally {
      for (const id of unread)
        if (this.reading.get(id) === all) this.reading.delete(id);
      this.readingAll = false;
    }
  }

  // The unread rows and the reads still on their way become part of a
  // "mark all": a read's own failure then puts nothing back, and the mark
  // all's puts back what both took.
  private takeOver(all: { at: string; taken: number }) {
    let taken = this.count();
    const unread = new Set<string>();
    for (const n of this.items()) {
      const own = this.reading.get(n.id);
      if (n.readAt !== null && own?.at !== n.readAt) continue;
      taken += own?.taken ?? 0;
      unread.add(n.id);
      this.reading.set(n.id, all);
    }
    return { taken, unread };
  }

  // Shows a count of this tab's own making, newer than any still being asked.
  private show(count: number) {
    this.shown = ++this.asked;
    this.count.set(count);
  }

  private unmark(match: (n: NotificationDto) => boolean, at: string) {
    this.items.update((items) =>
      items.map((n) => {
        if (n.readAt !== at || !match(n)) return n;
        this.readSince.delete(n.id);
        return { ...n, readAt: null };
      }),
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
      this.served++;
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
        this.merge(page.items, asked);
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
    this.markRead((n) => n.id === id && n.readAt === null, at);
    // Rows that join while the count is reloading are newer than it.
    const shown = new Set(this.items().map((n) => n.id));
    if ((this.carried(message) ?? (await this.refreshCount())) === 0)
      this.markRead((n) => shown.has(n.id) && n.readAt === null, at);
    if (this.state() !== 'ready') return;
    const asked = ++this.pageAsked;
    try {
      const { items } = await this.page();
      if (this.newest(asked)) this.merge(items, asked);
    } catch {
      // The rows shown stay until the next open.
    }
  }

  private markRead(match: (n: NotificationDto) => boolean, at: string) {
    this.items.update((items) =>
      items.map((n) => {
        if (!match(n)) return n;
        this.readSince.set(n.id, this.pageAsked);
        return { ...n, readAt: at };
      }),
    );
  }

  private merge(first: readonly NotificationDto[], asked: number) {
    const fresh = new Set(first.map((n) => n.id));
    const kept = this.kept(first, asked);
    this.items.update((items) => [
      ...kept,
      ...items.filter((n) => !fresh.has(n.id)),
    ]);
  }

  // A row shown read stays read when the page lists it unread but was asked
  // before the row was read here, or the read is still on its way.
  private kept(first: readonly NotificationDto[], asked: number) {
    const shown = new Map(this.items().map((n) => [n.id, n]));
    return first.map((n) => {
      const row = shown.get(n.id);
      if (n.readAt !== null || !row?.readAt) return n;
      const since = this.readSince.get(n.id) ?? -1;
      return this.reading.has(n.id) || asked <= since ? row : n;
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
