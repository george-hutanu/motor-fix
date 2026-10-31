import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import {
  GaragesService,
  type WeeklyFigureDto,
  type WeeklyFiguresDto,
} from '@motor-fix/data-access';
import {
  formatDayMonth,
  formatNum,
  formatRating,
  I18n,
  TranslatePipe,
} from '@motor-fix/i18n';
import { HlmButton } from '@motor-fix/ui-cockpit';
import { BarChart, type ChartPoint } from '@motor-fix/ui-cockpit/chart';

import { SectionTitle } from '../section-title/section-title';
import { garageOf, Session } from '../session';

type Kind = 'views' | 'requests';
const KINDS: readonly Kind[] = ['views', 'requests'];

// "De la profil la cerere": the garage's profile views and requests over the
// last eight full weeks, oldest first, as the server answers them. A week the
// garage was not yet approved has no figures: its label stays, with no bar.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BarChart, HlmButton, SectionTitle, TranslatePipe],
  selector: 'mf-weekly-figures-panel',
  styleUrl: './weekly-figures-panel.css',
  templateUrl: './weekly-figures-panel.html',
})
export class WeeklyFiguresPanel {
  // The full view the heading links to; none where the panel sits in it.
  readonly view = input<string>();
  private readonly api = inject(GaragesService);
  private readonly session = inject(Session);
  private readonly i18n = inject(I18n);
  // Moves on every read, so an older garage's answer is dropped.
  private latestRead = 0;

  protected readonly answer = signal<WeeklyFiguresDto | undefined>(undefined);
  protected readonly loading = signal(true);
  protected readonly failed = signal(false);

  private readonly garageId = computed(
    () => garageOf(this.session.shown())?.garageId,
  );
  private readonly weeks = computed(() => this.answer()?.weeks ?? []);
  protected readonly empty = computed(() =>
    this.weeks().every((week) => week.views === null),
  );

  protected readonly columns = computed(() => {
    const language = this.i18n.language();
    const latest = this.weeks().at(-1);
    return KINDS.map((kind) => ({
      figure: formatNum(latest?.[kind], language),
      kind,
      points: this.weeks().map((week) => this.point(week, kind)),
      title: this.i18n.t(`garage.weekly.${kind}`),
    }));
  });

  protected readonly sentence = computed(() => {
    const conversion = this.weeks().at(-1)?.conversion ?? null;
    if (conversion === null) return this.i18n.t('garage.weekly.noViews');
    const pct = `${formatRating(conversion, this.i18n.language())}%`;
    return this.i18n.t('garage.weekly.sentence', { pct });
  });

  constructor() {
    void this.i18n.enter('garage');
    effect(() => {
      const garageId = this.garageId();
      if (garageId) untracked(() => this.read(garageId));
    });
  }

  protected retry(): void {
    const garageId = this.garageId();
    if (garageId) this.read(garageId);
  }

  private read(garageId: string): void {
    const read = ++this.latestRead;
    this.loading.set(true);
    this.failed.set(false);
    this.api.garageWeeklyFigures({ garageId }).then(
      (answer) => {
        if (read !== this.latestRead) return;
        this.answer.set(answer);
        this.loading.set(false);
      },
      () => {
        if (read !== this.latestRead) return;
        this.failed.set(true);
        this.loading.set(false);
      },
    );
  }

  private point(week: WeeklyFigureDto, kind: Kind): ChartPoint {
    const label = `${this.i18n.t('garage.weekly.week')}${week.key.slice(-2)}`;
    const value = week[kind];
    if (value === null) return { label, value };
    const language = this.i18n.language();
    const days = `${formatDayMonth(week.from, language)} – ${formatDayMonth(week.to, language)}`;
    return {
      label,
      tooltip: `${label} · ${days}: ${formatNum(value, language)}`,
      value,
    };
  }
}
