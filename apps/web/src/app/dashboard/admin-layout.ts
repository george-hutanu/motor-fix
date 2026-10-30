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
  type DashboardLayoutDto,
  DashboardLayoutsService,
  type DashboardPanelDto,
} from '@motor-fix/data-access';
import { merge } from 'rxjs';

import { Live } from './live';
import { Session } from './session';

// The admin sections in the server's default order, drawn after a failed read.
export const ADMIN_KEYS: readonly string[] = [
  'numbers',
  'verification',
  'growth',
  'demand',
  'log',
];
const fallback = (): DashboardPanelDto[] =>
  ADMIN_KEYS.map((key) => ({ key, visible: true }));

// The admin's own Panou layout: which sections show and in which order, read
// once in the browser, saved whole on every change and read again when it
// changes in another tab or on another device.
@Injectable({ providedIn: 'root' })
export class AdminLayout {
  private readonly api = inject(DashboardLayoutsService);
  private readonly session = inject(Session);

  private readonly account = computed(() => this.session.current()?.id);
  private readonly admin = computed(() =>
    (this.session.current()?.roles ?? []).includes('admin'),
  );
  // The last answer: undefined while the first read is out, null if it failed.
  readonly server = signal<DashboardPanelDto[] | null | undefined>(undefined);
  // What Panou draws: the answer with the changes still being saved.
  readonly shown = signal<DashboardPanelDto[] | null>(null);
  // The sections whose switch save is out.
  readonly pending = signal<ReadonlySet<string>>(new Set());
  readonly ready = computed(() => this.server() !== undefined);
  // Bumped by every read and save, so an answer overtaken by a later one is dropped.
  private turn = 0;
  // The turn of the last answer applied: an older one arriving late is dropped.
  private applied = 0;
  // Saves still out: while any is, an answer does not redraw Panou.
  private outstanding = 0;
  // The last save sent, which a failed earlier save waits for.
  private saving: Promise<unknown> = Promise.resolve();

  constructor() {
    if (!isPlatformBrowser(inject(PLATFORM_ID))) return;
    const live = inject(Live);
    merge(live.on(['dashboard_layout.updated']), live.resync)
      .pipe(takeUntilDestroyed(inject(DestroyRef)))
      .subscribe(() => {
        if (this.outstanding === 0) void this.read();
      });
    effect(() => {
      this.account();
      this.admin();
      untracked(() => {
        this.server.set(undefined);
        this.shown.set(null);
        void this.read();
      });
    });
  }

  // Shows or hides a section at once; resolves false when the save failed
  // and Panou is back as the server has it.
  async toggle(key: string, visible: boolean): Promise<boolean> {
    if (this.pending().has(key)) return this.admin();
    // A key the layout does not hold is neither listed nor drawn: nothing to save.
    if (!this.current().some((panel) => panel.key === key)) return false;
    const panels = this.current().map((panel) =>
      panel.key === key ? { key, visible } : panel,
    );
    this.pending.update((pending) => new Set(pending).add(key));
    try {
      return await this.write(panels, (role) =>
        this.api.dashboardLayoutsControllerSave({ body: { panels }, role }),
      );
    } finally {
      this.pending.update((pending) => {
        const next = new Set(pending);
        next.delete(key);
        return next;
      });
    }
  }

  // Puts each of the two sections in the other's place.
  swap(key: string, other: string): Promise<boolean> {
    const panels = [...this.current()];
    const a = panels.findIndex((panel) => panel.key === key);
    const b = panels.findIndex((panel) => panel.key === other);
    if (a < 0 || b < 0) return Promise.resolve(false);
    [panels[a], panels[b]] = [panels[b], panels[a]];
    return this.write(panels, (role) =>
      this.api.dashboardLayoutsControllerSave({ body: { panels }, role }),
    );
  }

  // Every section back on, in the default order; the server answers its default.
  reset(): Promise<boolean> {
    const known = new Set(ADMIN_KEYS);
    const panels = [
      ...fallback(),
      ...this.current()
        .filter((panel) => !known.has(panel.key))
        .map((panel) => ({ key: panel.key, visible: true })),
    ];
    return this.write(panels, (role) =>
      this.api.dashboardLayoutsControllerReset({ role }),
    );
  }

  private current(): DashboardPanelDto[] {
    return this.shown() ?? this.server() ?? fallback();
  }

  private async write(
    panels: DashboardPanelDto[],
    send: (role: 'admin') => Promise<DashboardLayoutDto>,
  ): Promise<boolean> {
    if (!this.admin()) return false;
    const account = this.account();
    const turn = ++this.turn;
    this.shown.set(panels);
    this.outstanding++;
    try {
      const save = send('admin');
      this.saving = save;
      const answer = await save;
      if (turn > this.applied && this.account() === account) {
        this.applied = turn;
        this.server.set(answer.panels);
      }
      return true;
    } catch {
      // Every later save sends the whole layout as shown, so one that
      // answered carried this change too.
      const later = this.saving;
      if (this.turn > turn) await later.catch(() => undefined);
      return this.applied > turn;
    } finally {
      this.outstanding--;
      // An account switched meanwhile has its own read: it redraws once it answers.
      if (this.outstanding === 0 && this.server() !== undefined) {
        this.shown.set(this.server() ?? fallback());
      }
    }
  }

  private async read() {
    // Without the admin role there is no layout to read: the default is drawn.
    if (!this.admin()) {
      this.redraw(null);
      return;
    }
    const account = this.account();
    const turn = ++this.turn;
    try {
      const answer = await this.api.dashboardLayoutsControllerRead({
        role: 'admin',
      });
      // An answer without a list is as unreadable as a failed read.
      if (!Array.isArray(answer?.panels)) throw new Error('no panels');
      // An answer for an account signed out meanwhile, or overtaken by a
      // later read or save, is dropped; the first one is kept until then.
      const current = this.turn === turn || this.server() === undefined;
      if (this.account() === account && current) {
        this.applied = turn;
        this.redraw(answer.panels);
      }
    } catch {
      // The first read failing draws the default; a later one keeps the layout.
      if (this.server() === undefined && this.account() === account) {
        this.redraw(null);
      }
    }
  }

  private redraw(panels: DashboardPanelDto[] | null) {
    this.server.set(panels);
    if (this.outstanding === 0) this.shown.set(panels ?? fallback());
  }
}
