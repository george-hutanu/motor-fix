import { isPlatformServer, NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  effect,
  inject,
  input,
  model,
  PLATFORM_ID,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import {
  checkPriceRange,
  fold,
  JOB_NAME_MAX,
  JOB_NAME_MIN,
  type PriceEnds,
  type PriceEntry,
  type PricesSection,
} from '@motor-fix/contracts';
import { CatalogueService, type JobTypeDto } from '@motor-fix/data-access';
import { I18n, TranslatePipe } from '@motor-fix/i18n';
import { HlmButton, HlmInput, HlmLabel } from '@motor-fix/ui-cockpit';

import {
  addBrandRange,
  addJob,
  addProposal,
  brandOffer,
  canAdd,
  PRE_LISTED,
  preList,
  remove,
  rows,
  setEnds,
} from './prices-rows';
import type { MarkedBrand } from '../brands-section';
import { LeiInput } from '../lei-input';

// The search waits for the owner to stop typing.
const DEBOUNCE_MS = 250;
// A catalogue answer later than this counts as none.
const TIMEOUT_MS = 8_000;
const KEY = 'public.listing.prices';

interface Judged {
  error: string | null;
  field: 'from' | 'to' | null;
  wide: boolean;
}

// The catalogue's answer, or a failure once it is late.
function inTime<T>(answer: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('late')), TIMEOUT_MS);
  });
  return Promise.race([answer, late]).finally(() => clearTimeout(timer));
}

// What a range shows: one error once it has been left, else the wide-range
// warning, judged by the shared range check.
function judge(ends: PriceEnds | undefined, left: boolean): Judged {
  const { fromBani, toBani } = ends ?? {};
  const none: Judged = { error: null, field: null, wide: false };
  if (fromBani === undefined || toBani === undefined) {
    if (!left) return none;
    return {
      error: `${KEY}.errors.required`,
      field: fromBani === undefined ? 'from' : 'to',
      wide: false,
    };
  }
  const { errors, warnings } = checkPriceRange({ fromBani, toBani });
  const [first] = errors;
  if (first && left)
    return {
      error: `${KEY}.errors.${first.code}`,
      field: first.field as 'from' | 'to',
      wide: false,
    };
  return { ...none, wide: errors.length === 0 && warnings.length > 0 };
}

// Step 3 of listing a garage: the labour range, the jobs with their ranges,
// a range per taken brand, and new jobs proposed by name. It holds the
// draft's section and saves nothing.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    HlmButton,
    HlmInput,
    HlmLabel,
    LeiInput,
    NgTemplateOutlet,
    TranslatePipe,
  ],
  selector: 'mf-prices-step',
  styleUrl: './prices-step.css',
  templateUrl: './prices-step.html',
})
export class PricesStep {
  private readonly i18n = inject(I18n);
  private readonly catalogue = inject(CatalogueService);
  private readonly field = viewChild<ElementRef<HTMLInputElement>>('search');
  private timer: ReturnType<typeof setTimeout> | undefined;
  private searches = 0;
  private asking = false;

  // Absent until the draft holds a step 3.
  readonly value = model<PricesSection | undefined>();
  readonly takenBrands = input<readonly MarkedBrand[]>([]);
  // The step in view: a lookup that failed is tried again.
  readonly current = input(false);

  protected readonly nameMax = JOB_NAME_MAX;
  private readonly known = signal<ReadonlyMap<string, JobTypeDto>>(new Map());
  private readonly left = signal<ReadonlySet<string>>(new Set());
  protected readonly query = signal('');
  private readonly found = signal<JobTypeDto[]>([]);
  protected readonly notice = signal<string | null>(null);

  // The common jobs, asked for by key, shown while the section has no job
  // list; the draft takes them with the first change, so opening the page
  // writes nothing.
  private readonly listed = signal<readonly JobTypeDto[] | undefined>(
    undefined,
  );
  protected readonly section = computed(() => {
    const listed = this.listed();
    return listed ? preList(this.value(), listed) : (this.value() ?? {});
  });
  private readonly wantsListed = computed(
    () => this.listed() === undefined && this.value()?.jobs === undefined,
  );
  // Kept jobs the page has no name for yet.
  private readonly unnamed = computed(() => {
    const known = this.known();
    const ids = (this.value()?.jobs ?? []).flatMap(({ jobTypeId }) =>
      jobTypeId !== undefined && !known.has(jobTypeId) ? [jobTypeId] : [],
    );
    return [...new Set(ids)].join(',');
  });
  protected readonly rows = computed(() => rows(this.section()));
  protected readonly full = computed(() => !canAdd(this.section()));
  protected readonly labour = computed(() =>
    judge(this.section().labour, this.left().has('labour')),
  );
  // Jobs already listed are never offered again.
  protected readonly results = computed(() => {
    const listed = new Set(this.section().jobs?.map((e) => e.jobTypeId));
    return this.found().filter((job) => !listed.has(job.id));
  });
  // Never a new job for a name an offered or listed job already bears.
  protected readonly proposal = computed(() => {
    const typed = this.query().trim();
    if (typed.length < JOB_NAME_MIN || typed.length > JOB_NAME_MAX) return null;
    const known = this.known();
    const names = [
      ...this.found().flatMap((job) => [job.nameRo, job.nameEn]),
      ...(this.section().jobs ?? []).flatMap(({ jobTypeId, name }) => {
        const job = known.get(jobTypeId ?? '');
        return name !== undefined
          ? [name]
          : job
            ? [job.nameRo, job.nameEn]
            : [];
      }),
    ];
    const folded = fold(typed);
    return names.some((name) => fold(name) === folded) ? null : typed;
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => clearTimeout(this.timer));
    // The catalogue comes with the client: a server render would drop it.
    if (isPlatformServer(inject(PLATFORM_ID))) return;
    effect(() => {
      this.current();
      const keys = this.wantsListed();
      const ids = this.unnamed();
      untracked(() => this.lookup(keys, ids));
    });
  }

  // The listed jobs by key and the kept jobs by id, past the search's
  // first answers.
  private lookup(keys: boolean, ids: string) {
    if (this.asking || (!keys && !ids)) return;
    this.asking = true;
    inTime(
      this.catalogue.jobTypesControllerSearch({
        ...(keys && { keys: PRE_LISTED.join(',') }),
        ...(ids && { ids }),
      }),
    )
      .then(
        ({ items }) => {
          this.remember(items);
          if (keys) this.listed.set(items);
          this.notice.set(null);
        },
        () => this.notice.set(`${KEY}.searchDown`),
      )
      .finally(() => {
        this.asking = false;
      });
  }

  protected nameOf(entry: PriceEntry) {
    if (entry.name !== undefined) return entry.name;
    const job = this.known().get(entry.jobTypeId ?? '');
    if (!job) return '';
    return this.i18n.language() === 'en' ? job.nameEn : job.nameRo;
  }

  protected brandName(entry: PriceEntry) {
    return (
      this.takenBrands().find((b) => b.brandId === entry.brandId)?.name ?? ''
    );
  }

  protected offer(index: number) {
    return brandOffer(this.section(), index, this.takenBrands());
  }

  protected judged(entry: PriceEntry, index: number) {
    return judge(entry, this.left().has(String(index)));
  }

  protected setLabour(ends: PriceEnds) {
    const { labour, ...rest } = this.section();
    const next: Record<string, number | undefined> = { ...labour, ...ends };
    for (const key of Object.keys(next))
      if (next[key] === undefined) delete next[key];
    this.value.set(Object.keys(next).length ? { ...rest, labour: next } : rest);
  }

  protected setEntry(index: number, ends: PriceEnds) {
    this.value.set(setEnds(this.section(), index, ends));
  }

  protected leave(key: string) {
    if (!this.left().has(key))
      this.left.update((left) => new Set([...left, key]));
  }

  protected pick(job: JobTypeDto) {
    this.change(addJob(this.section(), job));
    this.clear();
  }

  protected propose(name: string) {
    this.change(addProposal(this.section(), name));
    this.clear();
  }

  protected giveBrand(index: number, brand: MarkedBrand) {
    this.change(addBrandRange(this.section(), index, brand.brandId));
  }

  // Indexes move once a row goes, so what was left is forgotten.
  protected drop(index: number) {
    this.left.update(
      (left) => new Set([...left].filter((k) => k === 'labour')),
    );
    this.value.set(remove(this.section(), index));
  }

  protected toSearch() {
    this.field()?.nativeElement.focus();
  }

  protected find(event: Event) {
    const typed = (event.target as HTMLInputElement).value;
    this.query.set(typed);
    clearTimeout(this.timer);
    const q = typed.trim();
    if (q.length < 2) {
      this.searches++;
      this.found.set([]);
      return;
    }
    this.timer = setTimeout(() => this.search(q), DEBOUNCE_MS);
  }

  private search(q: string) {
    const turn = ++this.searches;
    inTime(this.catalogue.jobTypesControllerSearch({ q })).then(
      ({ items }) => {
        if (turn !== this.searches) return;
        this.remember(items);
        this.found.set(items);
        this.notice.set(null);
      },
      () => {
        if (turn === this.searches) this.notice.set(`${KEY}.searchDown`);
      },
    );
  }

  private remember(items: readonly JobTypeDto[]) {
    this.known.update((known) => {
      const next = new Map(known);
      for (const job of items) next.set(job.id, job);
      return next;
    });
  }

  private change(next: PricesSection) {
    if (next !== this.section()) this.value.set(next);
  }

  private clear() {
    clearTimeout(this.timer);
    this.searches++;
    this.query.set('');
    this.found.set([]);
    const field = this.field()?.nativeElement;
    if (field) field.value = '';
  }
}
