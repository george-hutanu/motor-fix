import {
  afterNextRender,
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  type ElementRef,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import type { EventKind } from '@motor-fix/contracts';
import { GaragesService } from '@motor-fix/data-access';
import { I18n, TranslatePipe } from '@motor-fix/i18n';
import { Overlays } from '@motor-fix/overlays';
import { HlmButton } from '@motor-fix/ui-cockpit';

import {
  axisOf,
  nowAt,
  type Placed,
  type Row,
  rowsOf,
} from './lift-schedule.geometry';
import { openBlockTime } from '../block-time-dialog/open-block-time';
import { bucharestWall } from '../bucharest-time';
import { Live, liveResource } from '../live';
import { SectionTitle } from '../section-title/section-title';
import { garageOf, Session } from '../session';

// Every event that moves a block, a lift or the panel itself: each reads
// today's schedule again (a burst of 300 ms is one read).
const KINDS: readonly EventKind[] = [
  'booking.confirmed',
  'booking.moved',
  'booking.cancelled',
  'booking.lift_changed',
  'job.started',
  'job.paused',
  'job.resumed',
  'job.done',
  'job.mechanic_changed',
  'time_block.created',
  'time_block.updated',
  'time_block.deleted',
  'garage.features_changed',
];

const MINUTE = 60_000;
// Each hour of the axis is at least this wide; the names gutter beside it.
const HOUR_PX = 48;
const NAMES_PX = 104;
const T = 'garage.liftSchedule';

// "Programul de azi, pe elevatoare": today's bookings and lift time blocks on
// an hours axis, one row per lift. On Panou's `sched` place and as the body of
// Programări, while the garage schedules lifts and the person holds the
// schedule; a mechanic sees what the read gives her.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmButton, SectionTitle, TranslatePipe],
  selector: 'mf-lift-schedule',
  styleUrl: './lift-schedule.css',
  templateUrl: './lift-schedule.html',
})
export class LiftSchedule {
  // The view the title links to; none on that view itself.
  readonly view = input<string>();
  private readonly api = inject(GaragesService);
  private readonly overlays = inject(Overlays);
  private readonly session = inject(Session);
  private readonly i18n = inject(I18n);
  protected readonly offline = inject(Live).offline;
  private readonly scroller = viewChild<ElementRef<HTMLElement>>('scroller');

  private readonly garage = computed(() => garageOf(this.session.shown()));
  // Whether the panel is drawn for this person and garage.
  readonly shown = computed(
    () =>
      (this.session.shown()?.capabilities ?? []).includes('garage.schedule') &&
      this.garage()?.features?.['lift_schedule'] !== false,
  );
  private readonly canEdit = computed(() => {
    const role = this.garage()?.role;
    return role === 'owner' || role === 'receptionist';
  });

  protected readonly data = liveResource(() => {
    const garageId = this.garage()?.garageId;
    return untracked(this.shown) && garageId
      ? this.api.garageSchedule({ garageId })
      : Promise.resolve(null);
  }, KINDS);

  private readonly schedule = computed(() => this.data.value() ?? null);
  protected readonly axis = computed(() => {
    const s = this.schedule();
    return s
      ? axisOf(
          s.days.find((d) => d.day === s.from),
          s.hoursSet,
        )
      : null;
  });
  protected readonly rows = computed<Row[]>(() => {
    const s = this.schedule();
    const axis = this.axis();
    return s && axis ? rowsOf(s, axis) : [];
  });
  protected readonly state = computed(() => {
    if (this.schedule()) {
      if (!this.axis()) return 'closed';
      return this.rows().some((r) => r.items.length) ? 'drawn' : 'empty';
    }
    const failed = this.data.error() !== undefined || this.data.gone();
    return failed && !this.data.isLoading() ? 'failed' : 'loading';
  });
  protected readonly width = computed(() => {
    const axis = this.axis();
    return axis ? ((axis.end - axis.start) / 60) * HOUR_PX + NAMES_PX : 0;
  });
  protected readonly hours = computed(() => {
    const axis = this.axis();
    if (!axis) return [];
    const span = axis.end - axis.start;
    return Array.from(
      { length: span / 60 - 1 },
      (_, i) => ((i + 1) * 60 * 100) / span,
    );
  });

  private readonly now = signal(Date.now());
  protected readonly clock = computed(
    () => bucharestWall(new Date(this.now()).toISOString()).time,
  );
  protected readonly nowLine = computed(() => {
    const axis = this.axis();
    return axis ? nowAt(axis, new Date(this.now())) : null;
  });
  protected readonly skeletons = [1, 2, 3];

  constructor() {
    void this.i18n.enter('garage');
    // Switched back on: read at once, the panel was not shown till now.
    let was = this.shown();
    effect(() => {
      const shown = this.shown();
      if (shown && !was) void this.data.reload();
      was = shown;
    });
    const destroyRef = inject(DestroyRef);
    // On each minute boundary, in the browser only.
    afterNextRender(() => {
      let timer: ReturnType<typeof setTimeout>;
      const tick = () => {
        this.now.set(Date.now());
        timer = setTimeout(tick, MINUTE - (Date.now() % MINUTE));
      };
      timer = setTimeout(tick, MINUTE - (Date.now() % MINUTE));
      destroyRef.onDestroy(() => clearTimeout(timer));
    });
    // The first drawing scrolled so the now line is in sight.
    let scrolled = false;
    afterRenderEffect(() => {
      const at = this.nowLine();
      const scroller = this.scroller()?.nativeElement;
      if (scrolled || at === null || !scroller) return;
      scrolled = true;
      const x = NAMES_PX + (at / 100) * (scroller.scrollWidth - NAMES_PX);
      scroller.scrollLeft = Math.max(0, x - scroller.clientWidth / 2);
    });
  }

  protected rowName(row: Row) {
    return row.lift === null
      ? this.i18n.t(`${T}.noLift`)
      : this.i18n.t(`${T}.lift`, { n: row.lift });
  }

  protected car(item: Placed) {
    const car = item.entry?.car;
    return car ? `${car.brand} ${car.model}` : '';
  }

  // The jobs, then the mechanic's first name.
  protected jobs(item: Placed) {
    const jobs = item.entry?.jobs.join(', ') ?? '';
    const first = item.mechanic?.split(' ')[0];
    return first ? `${jobs} · ${first}` : jobs;
  }

  protected blockLabel(item: Placed) {
    const note = item.block?.note;
    const blocked = this.i18n.t(`${T}.blocked`);
    return note ? `${blocked} · ${note}` : blocked;
  }

  // The tooltip and the accessible name: never the driver's phone or plate.
  protected label(item: Placed) {
    const time = this.i18n.t(`${T}.minutes`, {
      minutes: item.minutes,
      time: item.start,
    });
    const parts =
      item.kind === 'block'
        ? [this.blockLabel(item), item.mechanic, time]
        : [
            this.car(item),
            item.entry?.jobs.join(', '),
            item.entry?.customer,
            item.mechanic,
            time,
            this.i18n.t(`${T}.state.${item.state}`),
          ];
    return parts.filter(Boolean).join(' · ');
  }

  protected editable(item: Placed) {
    return item.kind === 'block' && this.canEdit();
  }

  protected async edit(item: Placed) {
    const garageId = this.garage()?.garageId;
    if (!this.editable(item) || !item.block || !garageId) return;
    const result = await openBlockTime(this.overlays, {
      block: item.block,
      garageId,
      lifts: true,
      team: this.garage()?.features?.['team_mechanics'] !== false,
    });
    if (result !== 'cancelled') await this.data.reload();
  }
}
