import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import {
  type AdminAreaDto,
  type AdminDemandSupplyDto,
  AdminService,
} from '@motor-fix/data-access';
import {
  bucharestDayStart,
  formatClock,
  formatDayMonth,
  formatNum,
  I18n,
  TranslatePipe,
} from '@motor-fix/i18n';
import { HlmButton, Lamp, Panel } from '@motor-fix/ui-cockpit';

const SKELETON_ROWS = [0, 1, 2, 3, 4];

// "Cerere și ofertă": per brand and area, what drivers searched and asked
// for against the garages that take the brand there, read once per visit,
// per filter change and per retry.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmButton, Lamp, Panel, TranslatePipe],
  selector: 'mf-admin-demand-supply',
  styleUrl: './admin-demand-supply.css',
  templateUrl: './admin-demand-supply.html',
})
export class AdminDemandSupply {
  private readonly api = inject(AdminService);
  private readonly i18n = inject(I18n);
  private latest = 0;

  protected readonly skeletonRows = SKELETON_ROWS;
  protected readonly state = signal<'loading' | 'failed' | 'ready'>('loading');
  private readonly answer = signal<AdminDemandSupplyDto | undefined>(undefined);
  protected readonly brand = signal<string | null>(null);
  protected readonly area = signal<string | null>(null);
  // The brands of the latest answer read with no brand chosen, so choosing
  // one does not shrink the list.
  private readonly unfilteredBrands = signal<string[]>([]);

  protected readonly rows = computed(() => {
    const language = this.i18n.language();
    const count = (key: string, n: number) =>
      this.i18n.t(`admin.demand.supply.${key}`, {
        count: n,
        n: formatNum(n, language),
      });
    return (this.answer()?.rows ?? []).map((row) => ({
      figures: [
        count('searches', row.searches),
        count('requests', row.requests),
        count('garages', row.supply),
      ].join(' · '),
      key: `${row.brand}\u0000${row.area.code}`,
      lamp: row.searches > 0 && row.supply === 0,
      name: `${row.brand} · ${this.areaName(row.area)}`,
      perGarage:
        row.requestsPerGarage === null
          ? null
          : count('perGarage', row.requestsPerGarage),
      unmet: count('unmet', row.unmet),
    }));
  });

  protected readonly brandOptions = computed(() => {
    const brands = this.unfilteredBrands();
    const chosen = this.brand();
    return chosen === null || brands.includes(chosen)
      ? brands
      : [...brands, chosen];
  });

  // A chosen area the latest answer no longer lists stays, by its code,
  // last, as a chosen brand does.
  protected readonly areaOptions = computed(() => {
    const areas = (this.answer()?.areas ?? []).map((area) => ({
      code: area.code,
      name: this.areaName(area),
    }));
    const chosen = this.area();
    return chosen === null || areas.some((area) => area.code === chosen)
      ? areas
      : [...areas, { code: chosen, name: chosen }];
  });

  protected readonly updated = computed(() => {
    const writtenAt = this.answer()?.writtenAt;
    const at = new Date(writtenAt ?? Number.NaN);
    if (Number.isNaN(at.getTime())) return undefined;
    const time = formatClock(at);
    const today =
      bucharestDayStart(at).getTime() ===
      bucharestDayStart(new Date()).getTime();
    return today
      ? this.i18n.t('admin.demand.supply.updatedToday', { time })
      : this.i18n.t('admin.demand.supply.updatedOn', {
          day: formatDayMonth(at, this.i18n.language()),
          time,
        });
  });

  protected readonly emptyText = computed(() =>
    this.i18n.t(
      this.brand() === null && this.area() === null
        ? 'admin.demand.supply.empty'
        : 'admin.demand.supply.emptyFiltered',
    ),
  );

  constructor() {
    void this.i18n.enter('admin');
    void this.read();
  }

  protected chooseBrand(value: string) {
    this.brand.set(value || null);
    void this.read();
  }

  protected chooseArea(value: string) {
    this.area.set(value || null);
    void this.read();
  }

  protected async read() {
    const read = ++this.latest;
    const brand = this.brand();
    const area = this.area();
    this.state.set('loading');
    try {
      const answer = await this.api.demandControllerSupply({
        ...(brand !== null && { brand }),
        ...(area !== null && { area }),
      });
      if (read !== this.latest) return;
      this.answer.set(answer);
      if (brand === null)
        this.unfilteredBrands.set([
          ...new Set(answer.rows.map((row) => row.brand)),
        ]);
      this.state.set('ready');
    } catch {
      if (read === this.latest) this.state.set('failed');
    }
  }

  private areaName(area: AdminAreaDto) {
    return area.code === 'unknown'
      ? this.i18n.t('admin.demand.supply.unknownArea')
      : area.name;
  }
}
