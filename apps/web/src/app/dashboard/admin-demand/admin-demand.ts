import { _IdGenerator } from '@angular/cdk/a11y';
import {
  booleanAttribute,
  Component,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { type AdminDemandDto, AdminService } from '@motor-fix/data-access';
import { formatNum, I18n, TranslatePipe } from '@motor-fix/i18n';
import { BarChart, type ChartPoint, HlmButton } from '@motor-fix/ui-cockpit';

type Kind = 'brands' | 'jobs';

interface Report {
  kind: Kind;
  title: string;
  points: ChartPoint[];
  // Every row, for the full list; empty where no list is offered.
  all: { label: string; count: string }[];
  listId: string;
  more: string;
}

// What drivers asked for in the last 30 days: the view's two reports, or
// with `overview` the dashboard's brand panel alone.
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
  protected readonly expanded = signal<Kind | null>(null);
  private readonly listIds = {
    brands: this.ids.getId('mf-demand-brands-'),
    jobs: this.ids.getId('mf-demand-jobs-'),
  };

  protected readonly empty = computed(() => this.i18n.t('admin.demand.empty'));

  protected readonly reports = computed<Report[]>(() => {
    const answer = this.answer();
    const language = this.i18n.language();
    const overview = this.overview();
    const limit = overview ? 8 : 10;
    const rows = {
      brands: (answer?.brands ?? []).map((b) => ({
        label: b.name,
        value: b.requests,
      })),
      jobs: (answer?.jobs ?? []).map((j) => ({
        label: language === 'en' ? j.nameEn : j.nameRo,
        value: j.requests,
      })),
    };
    const kinds: Kind[] = overview ? ['brands'] : ['brands', 'jobs'];
    return kinds.map((kind) => {
      const listed = !overview && rows[kind].length > limit;
      return {
        all: listed
          ? rows[kind].map((r) => ({
              count: formatNum(r.value, language),
              label: r.label,
            }))
          : [],
        kind,
        listId: this.listIds[kind],
        more: this.i18n.t(
          kind === 'brands' ? 'admin.demand.allBrands' : 'admin.demand.allJobs',
        ),
        points: rows[kind].slice(0, limit),
        title: this.i18n.t(`admin.demand.${kind}`),
      };
    });
  });

  constructor() {
    void this.i18n.enter('admin');
    void this.read();
  }

  protected toggle(kind: Kind) {
    this.expanded.update((open) => (open === kind ? null : kind));
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
