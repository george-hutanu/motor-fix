import { DOCUMENT } from '@angular/common';
import { computed, effect, Injectable, inject, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { EventKind } from '@motor-fix/contracts';
import {
  type GarageRequestListDto,
  type GarageRequestSummaryDto,
  GarageRequestsService,
} from '@motor-fix/data-access';
import { I18n } from '@motor-fix/i18n';
import { toast } from '@motor-fix/ui-cockpit';

import { Live, liveResource } from '../live';
import { Session } from '../session';

// Every event that moves a row into, within or out of the garage's lists.
const CHANGES: readonly EventKind[] = [
  'request.created',
  'quote.sent',
  'request.declined',
  'request.decline_undone',
  'request.cancelled',
  'request.expired',
  'quote.accepted',
];

// A toast's job: the first one, else the description's first line, shortened.
const DESCRIPTION_CUT = 40;

// The garage's quote requests, read once for the whole dashboard: the menu's
// and the bar's count, Panou's panel, the Cereri de ofertă view and the
// new-request toast all read this. Only a session that may answer quotes reads.
@Injectable()
export class GarageRequestsFeed {
  private readonly api = inject(GarageRequestsService);
  private readonly session = inject(Session);
  private readonly i18n = inject(I18n);
  private readonly document = inject(DOCUMENT);
  private readonly allowed = computed(
    () =>
      this.session.shown()?.capabilities?.includes('garage.requests') ?? false,
  );
  private readonly waiting = liveResource(() => this.read('waiting'), CHANGES);
  private readonly closedRows = liveResource(
    () => this.read('closed'),
    CHANGES,
  );
  private readonly quotedRows = liveResource(
    () => this.read('quoted'),
    CHANGES,
  );
  // Arrived while the tab was in view, not yet shown as a toast.
  private readonly arrived = new Set<string>();
  private readonly toasted = new Set<string>();
  // Requests answered from this tab, until their quoted row has been shown.
  private readonly mine = new Set<string>();

  // The server's 404: this session may not see the garage's requests.
  readonly visible = computed(() => this.allowed() && !this.waiting.gone());
  readonly rows = computed(() => this.shown(this.waiting.value())?.items);
  readonly total = computed(() => this.shown(this.waiting.value())?.total);
  readonly nextCursor = computed(
    () => this.shown(this.waiting.value())?.nextCursor,
  );
  readonly closed = computed(() => this.shown(this.closedRows.value())?.items);
  // The requests answered with a quote still waiting for the driver.
  readonly quoted = computed(() => this.shown(this.quotedRows.value())?.items);
  readonly quotedNextCursor = computed(
    () => this.shown(this.quotedRows.value())?.nextCursor,
  );
  readonly quotedLoading = computed(
    () => this.allowed() && this.quotedRows.isLoading(),
  );
  readonly loading = computed(() => this.allowed() && this.waiting.isLoading());
  // The first read failed and there is nothing to show.
  readonly failed = computed(
    () =>
      this.allowed() &&
      this.waiting.error() !== undefined &&
      !this.waiting.gone(),
  );
  // The last read failed: the rows shown may be old.
  readonly stale = computed(
    () => this.allowed() && this.waiting.failed() && !this.waiting.gone(),
  );

  constructor() {
    void this.i18n.enter('garage');
    let allowed = this.allowed();
    effect(() => {
      const now = this.allowed();
      if (now && !allowed) untracked(() => this.reload());
      allowed = now;
    });
    inject(Live)
      .on(['request.created'])
      .pipe(takeUntilDestroyed())
      .subscribe(({ id }) => {
        if (
          !this.allowed() ||
          this.toasted.has(id) ||
          this.document.visibilityState !== 'visible'
        )
          return;
        this.arrived.add(id);
        this.announce(this.rows());
      });
    effect(() => {
      const rows = this.rows();
      untracked(() => this.announce(rows));
    });
  }

  reload() {
    this.waiting.reload();
    this.closedRows.reload();
    this.quotedRows.reload();
  }

  // A quote sent from this tab: re-read now, and show its row even on a
  // scrolled page, since the person is waiting for it.
  sent(id: string) {
    this.mine.add(id);
    this.reload();
  }

  // Whether these rows hold a quote sent from this tab; forgets it once shown.
  showsSent(rows: readonly { id: string }[]) {
    const found = rows.filter((row) => this.mine.delete(row.id));
    return found.length > 0;
  }

  // A further page of waiting or quoted rows, for the view's scroll.
  page(
    cursor: string,
    status: 'waiting' | 'quoted' = 'waiting',
  ): Promise<GarageRequestListDto> {
    return this.api.garageRequestsControllerList({ cursor, status });
  }

  private read(status: 'waiting' | 'closed' | 'quoted') {
    return this.allowed()
      ? this.api.garageRequestsControllerList({ status })
      : Promise.resolve(null);
  }

  private shown<T>(value: T | null | undefined) {
    return this.allowed() ? (value ?? undefined) : undefined;
  }

  // One toast per arrived request, once its row has been read.
  private announce(rows: readonly GarageRequestSummaryDto[] | undefined) {
    for (const row of rows ?? []) {
      if (!this.arrived.delete(row.id)) continue;
      this.toasted.add(row.id);
      toast(this.toastText(row));
    }
  }

  private toastText({ car, descriptionLine, jobs }: GarageRequestSummaryDto) {
    const english = this.i18n.language() === 'en';
    const first = jobs[0];
    const job = first
      ? english
        ? first.nameEn
        : first.nameRo
      : descriptionLine?.slice(0, DESCRIPTION_CUT);
    const name = `${car.brand} ${car.model}`;
    return job
      ? this.i18n.t('garage.requests.toast', { car: name, job })
      : this.i18n.t('garage.requests.toastCar', { car: name });
  }
}
