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
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, type Params, Router } from '@angular/router';
import {
  type AccountRole,
  type AccountState,
  isAccountState,
  readRoles,
  SEARCH_MAX,
  SEARCH_MIN,
  settleSearch,
} from '@motor-fix/contracts/account-search';
import {
  type AdminAccountDto,
  type AdminAccountsSummaryDto,
  AdminService,
} from '@motor-fix/data-access';
import { formatNum, I18n, TranslatePipe } from '@motor-fix/i18n';
import { Lamp, Panel } from '@motor-fix/ui-cockpit';

import { accountRow } from './account-row';
import { AdminGrowth } from '../admin-growth/admin-growth';
import { AdminUsersFilters } from '../admin-users-filters/admin-users-filters';
import type { UsersFilter } from '../admin-users-filters-sheet/admin-users-filters-sheet';

type Load = 'loading' | 'ready' | 'failed';

// What the list is narrowed to; an empty q is no search.
interface Narrowing {
  q: string;
  roles: readonly AccountRole[];
  status: AccountState | null;
}

const one = (value: unknown) =>
  typeof value === 'string' ? value : Array.isArray(value) ? value[0] : '';

// The address's q, role and status as the list reads them, and whether it
// held a value the list does not know.
function narrowingOf(params: Params) {
  const settled = settleSearch(one(params['q']) ?? '').slice(0, SEARCH_MAX);
  const role = params['role'];
  const { roles, unknown } = readRoles(
    role === undefined ? [] : Array.isArray(role) ? role : [role],
  );
  const state = one(params['status']);
  const status = state && isAccountState(state) ? state : null;
  return {
    narrowing: {
      q: settled.length >= SEARCH_MIN ? settled : '',
      roles,
      status,
    } satisfies Narrowing,
    unknown: unknown.length > 0 || (Boolean(state) && status === null),
  };
}

const narrowed = (n: Narrowing) =>
  n.q !== '' || n.roles.length > 0 || n.status !== null;

const SKELETON_ROWS = [0, 1, 2, 3, 4];

// The admin's Utilizatori view: the platform totals, the newest accounts
// (more as the admin scrolls) and the growth charts beside them.
@Component({
  imports: [AdminGrowth, AdminUsersFilters, Lamp, Panel, TranslatePipe],
  selector: 'mf-admin-users',
  styleUrl: './admin-users.css',
  templateUrl: './admin-users.html',
})
export class AdminUsers {
  private readonly api = inject(AdminService);
  private readonly i18n = inject(I18n);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly filters = viewChild(AdminUsersFilters);
  private readonly sentinel = viewChild<ElementRef<HTMLElement>>('sentinel');
  private observer: IntersectionObserver | undefined;

  protected readonly skeletonRows = SKELETON_ROWS;
  protected readonly tip = signal(false);

  private readonly summary = signal<AdminAccountsSummaryDto | undefined>(
    undefined,
  );
  protected readonly summaryState = signal<Load>('loading');

  private readonly params = toSignal(this.route.queryParams, {
    initialValue: {} as Params,
  });
  // The address is the source of truth: the controls and the list follow it.
  protected readonly narrowing = computed(
    () => narrowingOf(this.params()).narrowing,
    {
      equal: (a, b) =>
        a.q === b.q &&
        a.status === b.status &&
        a.roles.join() === b.roles.join(),
    },
  );
  protected readonly isNarrowed = computed(() => narrowed(this.narrowing()));
  // Each read's number: an answer to an older one is dropped.
  private read = 0;

  private readonly items = signal<AdminAccountDto[]>([]);
  private readonly total = signal<number | undefined>(undefined);
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

  protected readonly found = computed(() => {
    const total = this.total();
    // Said once the list it counts is there, never over the skeleton.
    if (!this.isNarrowed() || total === undefined) return '';
    if (this.listState() !== 'ready') return '';
    return this.i18n.t('admin.users.found', {
      count: total,
      n: formatNum(total, this.i18n.language()),
    });
  });

  protected readonly unavailable = computed(() =>
    this.i18n.t('admin.panel.unavailable'),
  );

  constructor() {
    void this.i18n.enter('admin');
    void this.readSummary();
    // An unknown role or state is dropped from the address in place.
    effect(() => {
      const params = this.params();
      const { narrowing, unknown } = narrowingOf(params);
      if (unknown) untracked(() => this.write(narrowing, true));
    });
    effect(() => {
      this.narrowing();
      untracked(() => void this.readFirst());
    });
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

  // The search and filters as the generated client sends them.
  private query(cursor?: string) {
    const { q, roles, status } = this.narrowing();
    return {
      ...(cursor !== undefined && { cursor }),
      ...(q !== '' && { q }),
      ...(roles.length > 0 && { role: [...roles] }),
      ...(status !== null && { status }),
    };
  }

  protected async readFirst() {
    const read = ++this.read;
    this.listState.set('loading');
    this.moreState.set('idle');
    try {
      const page = await this.api.adminAccountsControllerList(this.query());
      if (read !== this.read) return;
      this.items.set(page.items);
      this.cursor.set(page.nextCursor);
      this.total.set(page.total);
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
      const page = await this.api.adminAccountsControllerList(
        this.query(cursor),
      );
      if (read !== this.read) return;
      this.items.update((items) => [...items, ...page.items]);
      this.cursor.set(page.nextCursor);
      this.total.set(page.total);
      this.moreState.set('idle');
      this.lookAgain();
    } catch {
      if (read === this.read) this.moreState.set('failed');
    }
  }

  protected search(text: string) {
    const q = text.length >= SEARCH_MIN ? text : '';
    if (q !== this.narrowing().q) this.write({ ...this.narrowing(), q });
  }

  protected filter(choice: UsersFilter) {
    this.write({ ...this.narrowing(), ...choice });
  }

  protected clear() {
    this.write({ q: '', roles: [], status: null });
    this.filters()?.focusSearch();
  }

  // One history entry per applied change; the shell's own keys are kept.
  private write(n: Narrowing, replaceUrl = false) {
    const { q: _q, role: _role, status: _status, ...rest } = this.params();
    void this.router.navigate([], {
      queryParams: {
        ...rest,
        q: n.q || null,
        role: n.roles.length > 0 ? n.roles.join(',') : null,
        status: n.status,
      },
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
