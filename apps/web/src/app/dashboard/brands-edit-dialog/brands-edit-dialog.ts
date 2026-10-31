import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { checkListing } from '@motor-fix/contracts/listing-check';
import type { PriceEntry } from '@motor-fix/contracts/listing-sections';
import {
  type GarageBrandOwnerAnswerDto,
  type GarageBrandOwnerReadDto,
  GaragesService,
} from '@motor-fix/data-access';
import { I18n, TranslatePipe } from '@motor-fix/i18n';
import {
  injectOverlayTask,
  type OverlayResult,
  TaskError,
  TaskSubmit,
  taskSave,
} from '@motor-fix/overlays';
import { HlmButton } from '@motor-fix/ui-cockpit';

import {
  type BrandsSection,
  fuelsOf,
  type MarkedBrand,
  untickedOf,
} from '../../public/brands-section';
import { BrandsStep } from '../../public/brands-step/brands-step';
import { forStep } from '../../public/field-watch';

export interface BrandsEditData {
  garageId: string;
}

type JobNames = ReadonlyMap<string, { nameEn: string; nameRo: string }>;

const PRICES = '/app/garage/prices';

// The owner's stored answer as the brands step holds it: fuels as stored,
// a job ticked unless its price-list row is missing from the brand's jobs.
function sectionOf(read: GarageBrandOwnerReadDto): BrandsSection {
  const priced = read.priceList.map((job) => job.jobTypeId);
  const taken: MarkedBrand[] = read.worksOn.map((brand) => {
    const unticked = priced.filter((id) => !brand.jobs.includes(id));
    return {
      brandId: brand.id,
      fuels: [...brand.fuels],
      name: brand.name,
      stance: 'works_on',
      ...(unticked.length > 0 && { unticked }),
    };
  });
  const refused: MarkedBrand[] = read.doesNotTake.map((brand) => ({
    brandId: brand.id,
    name: brand.name,
    stance: 'does_not_take',
  }));
  return {
    brands: [...taken, ...refused],
    ...(read.brandNote && { brandNote: read.brandNote }),
    ...(read.refusalPhrase && { refusalPhrase: read.refusalPhrase }),
  };
}

// The write's body: every marked brand, a taken one with its fuels and jobs
// always named, and the texts, a blank one clearing what was stored.
function bodyOf(section: BrandsSection, priced: string[]) {
  return {
    brandNote: section.brandNote ?? '',
    brands: section.brands.map((brand) => {
      if (brand.stance !== 'works_on')
        return { brandId: brand.brandId, stance: brand.stance };
      const off = untickedOf(brand);
      return {
        brandId: brand.brandId,
        fuels: fuelsOf(brand),
        jobs: priced.filter((id) => !off.includes(id)),
        stance: brand.stance,
      };
    }),
    refusalPhrase: section.refusalPhrase ?? '',
  };
}

const BRAND_FIELD = /^brands\[(\d+)\]/;

// The brands group of the profile, edited in place: read on opening, the
// listing's brands step over the whole catalogue, one replace on save.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    BrandsStep,
    HlmButton,
    ReactiveFormsModule,
    TaskError,
    TaskSubmit,
    TranslatePipe,
  ],
  selector: 'mf-brands-edit-dialog',
  styleUrl: './brands-edit-dialog.css',
  templateUrl: './brands-edit-dialog.html',
})
export class BrandsEditDialog {
  private readonly api = inject(GaragesService);
  private readonly router = inject(Router);
  private readonly i18n = inject(I18n);
  protected readonly task = injectOverlayTask<
    BrandsEditData,
    OverlayResult<GarageBrandOwnerAnswerDto>
  >();
  private readonly garageId = this.task.data.garageId;

  protected readonly loading = signal<'reading' | 'failed' | 'ready'>(
    'reading',
  );
  protected readonly jobs = signal<PriceEntry[]>([]);
  protected readonly jobNames = signal<JobNames>(new Map());
  private priced: string[] = [];

  protected readonly form = new FormGroup({
    section: new FormControl<BrandsSection>(
      { brands: [] },
      { nonNullable: true },
    ),
  });
  protected readonly section = signal<BrandsSection>({ brands: [] });
  // The brands as last sent, for naming the one a refusal is about.
  private sent: MarkedBrand[] = [];

  // A taken brand with no fuel: Save waits until one is ticked.
  private readonly fuelless = computed(() =>
    this.section().brands.filter(
      (b) => b.stance === 'works_on' && fuelsOf(b).length === 0,
    ),
  );
  private readonly pressed = signal(false);

  // The step's own warnings (a taken brand with no job gets no requests);
  // they never block the save.
  protected readonly problems = computed(() => {
    const check = forStep(
      checkListing({
        data: {
          steps: { '2': this.section(), '3': { jobs: this.jobs() } },
        },
      }),
      2,
    );
    return { errors: [], warnings: check.warnings };
  });

  protected readonly save = taskSave({
    done: (answer: GarageBrandOwnerAnswerDto) => this.task.close(answer),
    form: this.form,
    messages: 'garage.profile.edit',
    send: ({ section }) => {
      const value = section ?? { brands: [] };
      this.sent = value.brands;
      return this.api.garageBrandsControllerReplace({
        body: bodyOf(value, this.priced),
        garageId: this.garageId,
      });
    },
  });

  // The lines at the top: a brand with no fuel once Save was pressed, else a
  // refusal of the server about one brand, named.
  protected readonly brandProblems = computed(() => {
    if (this.pressed() && this.fuelless().length)
      return this.fuelless().map((b) =>
        this.i18n.t('garage.profile.edit.brands.problem.fuels_empty', {
          brand: b.name,
        }),
      );
    const problem = this.save.problem();
    return (problem?.errors ?? []).flatMap(({ code, field }) => {
      const at = BRAND_FIELD.exec(field);
      const brand = at ? this.sent[Number(at[1])] : undefined;
      if (!brand) return [];
      const key = `garage.profile.edit.brands.problem.${code}`;
      const said = this.i18n.t(key, { brand: brand.name });
      return [
        said === key
          ? this.i18n.t('garage.profile.edit.brands.problem.other', {
              brand: brand.name,
            })
          : said,
      ];
    });
  });

  constructor() {
    void this.i18n.enter('garage');
    // The brands step speaks in the listing form's texts.
    void this.i18n.enter('public');
    void this.read();
  }

  protected async read() {
    this.loading.set('reading');
    try {
      const answer = await this.api.garageBrandsControllerRead({
        garageId: this.garageId,
      });
      this.priced = answer.priceList.map((job) => job.jobTypeId);
      this.jobs.set(answer.priceList.map(({ jobTypeId }) => ({ jobTypeId })));
      this.jobNames.set(
        new Map(
          answer.priceList.map(({ jobTypeId, nameEn, nameRo }) => [
            jobTypeId,
            { nameEn, nameRo },
          ]),
        ),
      );
      this.keep(sectionOf(answer));
      this.task.markUnchanged();
      this.loading.set('ready');
    } catch {
      this.loading.set('failed');
    }
  }

  protected keep(section: BrandsSection) {
    this.section.set(section);
    this.form.controls.section.setValue(section);
  }

  protected submit() {
    this.pressed.set(true);
    if (this.fuelless().length) return;
    this.save.submit();
  }

  // The price list is where jobs are added: the dialog makes way for it.
  protected toPrices() {
    this.task.close('cancelled');
    void this.router.navigateByUrl(PRICES);
  }
}
