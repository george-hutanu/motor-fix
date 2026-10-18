import { isPlatformBrowser } from '@angular/common';
import {
  Component,
  computed,
  DestroyRef,
  effect,
  HostAttributeToken,
  inject,
  PLATFORM_ID,
  signal,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  VERIFICATION_QUEUE_PAGE,
  VERIFICATION_QUEUE_PANEL,
} from '@motor-fix/contracts/verification-target';
import {
  AdminService,
  type VerificationQueueDto,
  type VerificationQueueRowDto,
} from '@motor-fix/data-access';
import { appliedAt, formatNum, I18n, TranslatePipe } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';
import { Lamp, Panel } from '@motor-fix/ui-cockpit';
import { map } from 'rxjs';

import { Live, liveResource, pagedRead } from '../live';

const SKELETON_ROWS = [0, 1, 2];
const LIST = '/app/admin/garages';
// How often a page left open reads the clock again, so "azi" turns into
// "ieri" soon after midnight with no new read.
const TICK_MS = 60_000;

// "Service-uri de verificat": the files waiting for an admin, oldest first,
// read again whenever one is sent, opened, checked, decided or reopened. On
// the overview it shows the oldest few and links to the whole list; in the
// "Service-uri" view it shows a page more at each press, as one read of
// every row shown.
@Component({
  imports: [Lamp, Panel, RouterLink, TranslatePipe],
  selector: 'mf-admin-queue',
  styleUrl: './admin-queue.css',
  templateUrl: './admin-queue.html',
})
export class AdminQueue {
  private readonly api = inject(AdminService);
  private readonly i18n = inject(I18n);
  // A static attribute, known before the first read, as an input is not.
  protected readonly overview =
    inject(new HostAttributeToken('overview'), { optional: true }) !== null;
  private readonly pageSize = this.overview
    ? VERIFICATION_QUEUE_PANEL
    : VERIFICATION_QUEUE_PAGE;
  private readonly pages = signal(1);
  private readonly queue = liveResource(
    () => this.read(this.pages() * this.pageSize),
    [
      'verification.submitted',
      'verification.opened',
      'verification.check_recorded',
      'verification.decided',
      'verification.reopened',
      'garage_report.decided',
    ],
  );

  protected readonly skeletonRows = SKELETON_ROWS;
  protected readonly list = LIST;
  protected readonly state = computed(() => {
    if (this.queue.value()) return 'ready';
    return this.queue.failed() ? 'failed' : 'loading';
  });
  // A failed re-read keeps the rows and the count it read last.
  protected readonly stale = computed(
    () => this.queue.failed() && this.queue.value() !== undefined,
  );

  protected readonly heading = computed(() => {
    const total = this.queue.value()?.total;
    const name = this.t('heading');
    if (total === undefined) return name;
    // No-break spaces keep the count on the name's line on a 320 px phone.
    const count = `${name}\u00a0·\u00a0${formatNum(total, this.i18n.language())}`;
    return this.stale() ? `${count} ${this.t('stale')}` : count;
  });

  // Rows approved while shown, kept where they stood until the view closes;
  // outside the count and the page size, which are the server's.
  private readonly approved = signal<
    ReadonlyMap<string, { index: number; row: VerificationQueueRowDto }>
  >(new Map());

  private readonly now = signal(new Date());
  protected readonly rows = computed(() => {
    const now = this.now();
    const approved = this.approved();
    const rows = (this.queue.value()?.items ?? [])
      .filter((row) => !approved.has(row.id))
      .map((row) => this.row(row, now));
    const kept = [...approved.values()].sort((a, b) => a.index - b.index);
    for (const { index, row } of kept) {
      rows.splice(Math.min(index, rows.length), 0, {
        ...this.row(row, now),
        approved: this.t('approved'),
      });
    }
    return rows;
  });

  private readonly hidden = computed(() => {
    const value = this.queue.value();
    return value ? value.total > value.items.length : false;
  });
  protected readonly more = computed(() => !this.overview && this.hidden());
  protected readonly all = computed(() => this.overview && this.hidden());

  showMore() {
    this.pages.update((n) => n + 1);
    this.queue.reload();
  }

  retry() {
    this.queue.reload();
  }

  private read(wanted: number): Promise<VerificationQueueDto> {
    return pagedRead(wanted, (page) =>
      this.api.adminOverviewControllerQueue(page),
    );
  }

  private t(key: string, params?: Record<string, string | number>) {
    return this.i18n.t(`admin.queue.${key}`, params);
  }

  private row(row: VerificationQueueRowDto, now: Date) {
    const language = this.i18n.language();
    const counted = (key: string, n: number) =>
      this.t(key, { count: n, n: formatNum(n, language) });
    const area =
      row.area?.kind === 'mobile'
        ? this.t('mobile', { km: formatNum(row.area.radiusKm, language) })
        : row.area?.name;
    return {
      applied: appliedAt(row.submittedAt, language, now),
      approved: undefined as string | undefined,
      area: [
        area,
        counted('brands', row.brands),
        row.mechanics === undefined
          ? undefined
          : counted('mechanics', row.mechanics),
      ]
        .filter(Boolean)
        .join(' · '),
      id: row.id,
      lamp: row.lamp,
      link: [LIST, row.id],
      name: row.garageName,
      open: this.t('openNamed', { name: row.garageName }),
      summary: row.summary[language],
      waiting: row.flagged ? counted('waiting', row.workingDays) : undefined,
    };
  }

  // A decision on a shown row: the message names no outcome, so the file is
  // read; an approved one keeps its row, any other leaves it to drop.
  private keepApproved() {
    inject(Live)
      .on(['verification.decided'])
      .pipe(takeUntilDestroyed())
      .subscribe(({ id }) => {
        const row = this.queue.value()?.items.find((item) => item.id === id);
        if (!row || this.approved().has(id)) return;
        // Where it stands on screen, rows kept earlier included.
        const index = this.rows().findIndex((shown) => shown.id === id);
        this.api.verificationFileControllerRead({ id }).then(
          ({ file }) => {
            if (file.status !== 'approved') return;
            this.approved.update((kept) =>
              new Map(kept).set(id, { index, row }),
            );
          },
          // A failed read leaves the row to drop, as before this story.
          () => undefined,
        );
      });
  }

  // The file named in the address, /app/admin/garages/{fileId}, opens as a
  // drawer over the list, once; closing it returns the address to the list
  // unless it already names another place. Another file named while one is
  // open closes that one first: one drawer at a time.
  private shown: string | null = null;
  private drawer?: AbortController;
  private openFiles() {
    const fileId = toSignal(
      inject(ActivatedRoute).url.pipe(map((url) => url[0]?.path ?? null)),
      { initialValue: null },
    );
    const overlays = inject(Overlays);
    const router = inject(Router);
    effect(() => {
      const id = fileId();
      if (id === this.shown) return;
      this.shown = id;
      this.drawer?.abort();
      this.drawer = undefined;
      if (!id) return;
      const drawer = new AbortController();
      this.drawer = drawer;
      void overlays
        .open(
          () =>
            import('../verification-file/verification-file').then(
              (m) => m.VerificationFile,
            ),
          {
            // Each tick saves at once: there is nothing to discard on close.
            confirmDiscard: false,
            data: { fileId: id },
            shape: 'drawer-wide',
            signal: drawer.signal,
            title: 'admin.file.title',
          },
        )
        .then(() => {
          if (this.drawer === drawer) this.drawer = undefined;
          if (this.shown !== id) return;
          this.shown = null;
          void router.navigate([LIST], { replaceUrl: true });
        });
    });
  }

  constructor() {
    void this.i18n.enter('admin');
    if (!isPlatformBrowser(inject(PLATFORM_ID))) return;
    this.keepApproved();
    if (!this.overview) this.openFiles();
    const tick = setInterval(() => this.now.set(new Date()), TICK_MS);
    inject(DestroyRef).onDestroy(() => clearInterval(tick));
  }
}
