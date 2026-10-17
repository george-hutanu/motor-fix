import { isPlatformBrowser } from '@angular/common';
import {
  Component,
  computed,
  DestroyRef,
  HostAttributeToken,
  inject,
  PLATFORM_ID,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
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
import { Lamp, Panel } from '@motor-fix/ui-cockpit';

import { liveResource, pagedRead } from '../live';

const SKELETON_ROWS = [0, 1, 2];
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
    ],
  );

  protected readonly skeletonRows = SKELETON_ROWS;
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

  private readonly now = signal(new Date());
  protected readonly rows = computed(() => {
    const now = this.now();
    return (this.queue.value()?.items ?? []).map((row) => this.row(row, now));
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
      link: ['/app/admin/garages', row.id],
      name: row.garageName,
      open: this.t('openNamed', { name: row.garageName }),
      summary: row.summary[language],
      waiting: row.flagged ? counted('waiting', row.workingDays) : undefined,
    };
  }

  constructor() {
    void this.i18n.enter('admin');
    if (!isPlatformBrowser(inject(PLATFORM_ID))) return;
    const tick = setInterval(() => this.now.set(new Date()), TICK_MS);
    inject(DestroyRef).onDestroy(() => clearInterval(tick));
  }
}
