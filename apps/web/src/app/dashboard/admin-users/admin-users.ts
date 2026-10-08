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
import {
  type AdminAccountDto,
  type AdminAccountsSummaryDto,
  AdminService,
} from '@motor-fix/data-access';
import { formatNum, I18n, TranslatePipe } from '@motor-fix/i18n';
import { Lamp, Panel } from '@motor-fix/ui-cockpit';

import { accountRow } from './account-row';
import { AdminGrowth } from '../admin-growth/admin-growth';

type Load = 'loading' | 'ready' | 'failed';

const SKELETON_ROWS = [0, 1, 2, 3, 4];

// The admin's Utilizatori view: the platform totals, the newest accounts
// (more as the admin scrolls) and the growth charts beside them.
@Component({
  imports: [AdminGrowth, Lamp, Panel, TranslatePipe],
  selector: 'mf-admin-users',
  styleUrl: './admin-users.css',
  templateUrl: './admin-users.html',
})
export class AdminUsers {
  private readonly api = inject(AdminService);
  private readonly i18n = inject(I18n);
  private readonly sentinel = viewChild<ElementRef<HTMLElement>>('sentinel');
  private observer: IntersectionObserver | undefined;

  protected readonly skeletonRows = SKELETON_ROWS;
  protected readonly tip = signal(false);

  private readonly summary = signal<AdminAccountsSummaryDto | undefined>(
    undefined,
  );
  protected readonly summaryState = signal<Load>('loading');

  private readonly items = signal<AdminAccountDto[]>([]);
  private readonly cursor = signal<string | null>(null);
  protected readonly listState = signal<Load>('loading');
  protected readonly moreState = signal<'idle' | 'loading' | 'failed'>('idle');
  protected readonly hasMore = computed(
    () => this.listState() === 'ready' && this.cursor() !== null,
  );

  protected readonly rows = computed(() =>
    this.items().map((item) => ({
      id: item.id,
      name: item.name,
      ...accountRow(item, this.i18n),
    })),
  );

  protected readonly totals = computed(() => {
    const figures = this.summary();
    if (!figures) return '';
    const language = this.i18n.language();
    const part = (key: string, value: number) =>
      this.i18n.t(`admin.users.totals.${key}`, {
        count: value,
        n: formatNum(value, language),
      });
    return [
      part('drivers', figures.activeDrivers),
      part('garages', figures.garagesListed),
      part('mechanics', figures.mechanics),
    ].join(' · ');
  });

  protected readonly unavailable = computed(() =>
    this.i18n.t('admin.panel.unavailable'),
  );

  constructor() {
    void this.i18n.enter('admin');
    void this.readSummary();
    void this.readFirst();
    // The sentinel after the last row asks for the next page as it comes
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
  }

  private async readSummary() {
    try {
      this.summary.set(await this.api.adminAccountsControllerSummary());
      this.summaryState.set('ready');
    } catch {
      this.summaryState.set('failed');
    }
  }

  protected async readFirst() {
    this.listState.set('loading');
    try {
      const page = await this.api.adminAccountsControllerList({});
      this.items.set(page.items);
      this.cursor.set(page.nextCursor);
      this.listState.set('ready');
    } catch {
      this.listState.set('failed');
    }
  }

  protected async readMore(retry = false) {
    const cursor = this.cursor();
    if (cursor === null || this.moreState() === 'loading') return;
    if (this.moreState() === 'failed' && !retry) return;
    this.moreState.set('loading');
    try {
      const page = await this.api.adminAccountsControllerList({ cursor });
      this.items.update((items) => [...items, ...page.items]);
      this.cursor.set(page.nextCursor);
      this.moreState.set('idle');
      this.lookAgain();
    } catch {
      this.moreState.set('failed');
    }
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
