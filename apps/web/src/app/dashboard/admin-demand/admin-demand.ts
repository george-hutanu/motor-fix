import { _IdGenerator } from '@angular/cdk/a11y';
import {
  booleanAttribute,
  Component,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import {
  type DemandOrder,
  orderBrands,
} from '@motor-fix/contracts/demand-order';
import { type AdminDemandDto, AdminService } from '@motor-fix/data-access';
import { formatDay, formatNum, I18n, TranslatePipe } from '@motor-fix/i18n';
import { BarChart, type ChartPoint, HlmButton } from '@motor-fix/ui-cockpit';

type Kind = 'brands' | 'jobs';

interface Report {
  kind: Kind;
  title: string;
  // The table's name column: brand or job.
  heading: string;
  points: ChartPoint[];
  // The names of the brand report's two figures; none for one figure.
  leadHeading?: string;
  valueHeading?: string;
  empty: string;
  // Every row, for the full list; empty where no list is offered.
  all: { label: string; count: string }[];
  listId: string;
  more: string;
}

// What drivers searched for and asked for in the last 30 days: the view's two
// reports, or with `overview` the dashboard's brand panel alone.
@Component({
  imports: [BarChart, HlmButton, TranslatePipe],
  selector: 'mf-admin-demand',
  styleUrl: './admin-demand.css',
  templateUrl: './admin-demand.html',
})
export class AdminDemand {
  readonly overview = input(false, { transform: booleanAttribute });

  private readonly api = inject(AdminService);
  private readonly i18n = inject(I18n);
  private readonly ids = inject(_IdGenerator);
  private latest = 0;

  protected readonly answer = signal<AdminDemandDto | undefined>(undefined);
  protected readonly loading = signal(true);
  protected readonly failed = signal(false);
  // The brand report's order, chosen in the view; the overview keeps the
  // read's, which is by searches.
  protected readonly order = signal<DemandOrder>('searches');
  protected readonly orders: readonly { by: DemandOrder; key: string }[] = [
    { by: 'searches', key: 'admin.demand.bySearches' },
    { by: 'requests', key: 'admin.demand.byRequests' },
  ];
  protected readonly orderLabelId = this.ids.getId('mf-demand-order-');
  // Each report's full list opens and closes on its own.
  protected readonly expanded = signal<ReadonlySet<Kind>>(new Set());
  private readonly listIds = {
    brands: this.ids.getId('mf-demand-brands-'),
    jobs: this.ids.getId('mf-demand-jobs-'),
  };

  // The day searches are counted from, in the interface language.
  protected readonly from = computed(() => {
    const day = this.answer()?.searchesFrom;
    return day === undefined
      ? undefined
      : this.i18n.t('admin.demand.from', {
          day: formatDay(day, this.i18n.language()),
        });
  });

  protected readonly reports = computed<Report[]>(() => {
    const answer = this.answer();
    const language = this.i18n.language();
    const overview = this.overview();
    const limit = overview ? 8 : 10;
    const searches = this.i18n.t('admin.demand.searches');
    const requests = this.i18n.t('admin.demand.requests');
    const brands = answer?.brands ?? [];
    const rows = {
      brands: (overview ? brands : orderBrands(brands, this.order())).map(
        (b) => ({
          count: `${searches} ${formatNum(b.searches, language)} · ${requests} ${formatNum(b.requests, language)}`,
          label: b.name,
          lead: b.searches,
          value: b.requests,
        }),
      ),
      jobs: (answer?.jobs ?? []).map((j) => ({
        count: formatNum(j.requests, language),
        label: language === 'en' ? j.nameEn : j.nameRo,
        value: j.requests,
      })),
    };
    const kinds: Kind[] = overview ? ['brands'] : ['brands', 'jobs'];
    return kinds.map((kind) => {
      const listed = !overview && rows[kind].length > limit;
      return {
        all: listed
          ? rows[kind].map(({ count, label }) => ({ count, label }))
          : [],
        empty: this.i18n.t(
          kind === 'brands' ? 'admin.demand.emptyBrands' : 'admin.demand.empty',
        ),
        heading: this.i18n.t(
          kind === 'brands' ? 'admin.demand.brand' : 'admin.demand.job',
        ),
        kind,
        listId: this.listIds[kind],
        more: this.i18n.t(
          kind === 'brands' ? 'admin.demand.allBrands' : 'admin.demand.allJobs',
        ),
        points: rows[kind]
          .slice(0, limit)
          .map(({ count: _, ...point }) => point),
        title: this.i18n.t(`admin.demand.${kind}`),
        ...(kind === 'brands' && {
          leadHeading: searches,
          valueHeading: requests,
        }),
      };
    });
  });

  constructor() {
    void this.i18n.enter('admin');
    void this.read();
  }

  protected toggle(kind: Kind) {
    this.expanded.update((open) => {
      const next = new Set(open);
      if (!next.delete(kind)) next.add(kind);
      return next;
    });
  }

  // One read feeds every report; only the answer to the latest is shown.
  protected async read() {
    const read = ++this.latest;
    this.loading.set(true);
    this.failed.set(false);
    try {
      const answer = await this.api.demandControllerDemand();
      if (read === this.latest) this.answer.set(answer);
    } catch {
      if (read === this.latest) this.failed.set(true);
    } finally {
      if (read === this.latest) this.loading.set(false);
    }
  }
}
