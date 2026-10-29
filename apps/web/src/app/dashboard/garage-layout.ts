import { isPlatformBrowser } from '@angular/common';
import {
  computed,
  DestroyRef,
  effect,
  Injectable,
  inject,
  PLATFORM_ID,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  DashboardLayoutsService,
  type DashboardPanelDto,
} from '@motor-fix/data-access';
import { merge } from 'rxjs';

import { Live } from './live';
import { Session } from './session';

type GarageRole = 'garage' | 'receptionist' | 'mechanic';
const GARAGE_ROLES: readonly GarageRole[] = [
  'garage',
  'receptionist',
  'mechanic',
];
// Every key Panou can hold, in its default order: the body of a save made
// after the read failed.
const DEFAULT_KEYS = [
  'kpi',
  'now',
  'req',
  'load',
  'sched',
  'funnel',
  'brands',
  'reviews',
];

// The garage person's own Panou layout: which sections she hides, read once
// in the browser, saved one switch at a time and read again when it changes
// in another tab or on another device.
@Injectable({ providedIn: 'root' })
export class GarageLayout {
  private readonly api = inject(DashboardLayoutsService);
  private readonly session = inject(Session);

  private readonly account = computed(() => this.session.current()?.id);
  readonly role = computed<GarageRole | null>(() => {
    const roles: readonly string[] = this.session.current()?.roles ?? [];
    return GARAGE_ROLES.find((role) => roles.includes(role)) ?? null;
  });
  // The last answer: undefined while the first read is out, null if it failed.
  readonly server = signal<DashboardPanelDto[] | null | undefined>(undefined);
  // The sections whose save is out, and the visibility sent.
  readonly pending = signal<ReadonlyMap<string, boolean>>(new Map());
  readonly hidden = computed<ReadonlySet<string>>(() => {
    const hidden = new Set(
      (this.server() ?? []).filter((p) => !p.visible).map((p) => p.key),
    );
    for (const [key, shown] of this.pending()) {
      if (shown) hidden.delete(key);
      else hidden.add(key);
    }
    return hidden;
  });
  readonly ready = computed(() => this.server() !== undefined);

  constructor() {
    if (!isPlatformBrowser(inject(PLATFORM_ID))) return;
    const live = inject(Live);
    merge(live.on(['dashboard_layout.updated']), live.resync)
      .pipe(takeUntilDestroyed(inject(DestroyRef)))
      .subscribe(() => {
        if (this.pending().size === 0) void this.read();
      });
    // A first read for each account and role, the old layout dropped.
    effect(() => {
      this.account();
      this.role();
      untracked(() => {
        this.server.set(undefined);
        void this.read();
      });
    });
  }

  // Shows or hides a section at once; resolves false when the save failed
  // and the section is back as the server has it.
  async toggle(key: string, shown: boolean): Promise<boolean> {
    const role = this.role();
    if (!role) return false;
    if (this.pending().has(key)) return true;
    this.pending.update((pending) => new Map(pending).set(key, shown));
    const base =
      this.server() ?? DEFAULT_KEYS.map((k) => ({ key: k, visible: true }));
    const flips = this.pending();
    const panels = base.map((panel) => ({
      key: panel.key,
      visible: flips.get(panel.key) ?? panel.visible,
    }));
    try {
      const answer = await this.api.dashboardLayoutsControllerSave({
        body: { panels },
        role,
      });
      this.server.set(answer.panels);
      return true;
    } catch {
      return false;
    } finally {
      this.pending.update((pending) => {
        const next = new Map(pending);
        next.delete(key);
        return next;
      });
    }
  }

  private async read() {
    const role = this.role();
    // Without a garage role there is no layout to read: the default is drawn.
    if (!role) {
      this.server.set(null);
      return;
    }
    const account = this.account();
    try {
      const answer = await this.api.dashboardLayoutsControllerRead({ role });
      // An answer for an account signed out meanwhile is dropped.
      if (this.account() === account) this.server.set(answer.panels);
    } catch {
      // The first read failing draws the default; a later one keeps the layout.
      if (this.server() === undefined) this.server.set(null);
    }
  }
}
