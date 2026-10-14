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
  output,
  PLATFORM_ID,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { fold } from '@motor-fix/contracts/fold';
import type { ListingCheck } from '@motor-fix/contracts/listing-check';
import {
  JOB_NAME_MAX,
  JOB_NAME_MIN,
  type PriceEnds,
  type PriceEntry,
  type PricesSection,
} from '@motor-fix/contracts/listing-sections';
import { checkPriceRange } from '@motor-fix/contracts/price-range';
import { CatalogueService, type JobTypeDto } from '@motor-fix/data-access';
import { I18n, TranslatePipe } from '@motor-fix/i18n';
import { HlmButton, HlmInput, HlmLabel } from '@motor-fix/ui-cockpit';

import {
  addBrandRange,
  addJob,
  addProposal,
  brandOffer,
  canAdd,
  jobName,
  PRE_LISTED,
  preList,
  remove,
  rows,
  setEnds,
} from './prices-rows';
import type { MarkedBrand } from '../brands-section';
import { type FieldMessage, FieldWatch, NO_PROBLEMS } from '../field-watch';
import { LeiInput } from '../lei-input';

// The search waits for the owner to stop typing.
const DEBOUNCE_MS = 250;
// A catalogue answer later than this counts as none.
const TIMEOUT_MS = 8_000;
const KEY = 'public.listing.prices';
const LABOUR = 'steps.3.labour';
const JOBS = 'steps.3.jobs';
const ENDS = ['from', 'to'] as const;

type End = (typeof ENDS)[number];

// What a range shows: the error of the end that has one, else the warning.
interface RangeMessages {
  from: FieldMessage | null;
  to: FieldMessage | null;
  shown: FieldMessage | null;
}

// The catalogue's answer, or a failure once it is late.
function inTime<T>(answer: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('late')), TIMEOUT_MS);
  });
  return Promise.race([answer, late]).finally(() => clearTimeout(timer));
}

// A range on screen that the draft does not hold yet (the listed jobs
// before the first change), judged here as the page would judge it.
function unsavedRange(
  path: string,
  { fromBani, toBani }: PriceEnds,
  into: ListingCheck,
) {
  if (fromBani === undefined)
    into.errors.push({ code: 'required', field: `${path}.from` });
  if (toBani === undefined)
    into.errors.push({ code: 'required', field: `${path}.to` });
  if (fromBani === undefined) return;
  const { errors, warnings } = checkPriceRange({ fromBani, toBani });
  for (const { code, field } of errors)
    into.errors.push({ code, field: `${path}.${field}` });
  for (const { code, field } of warnings)
    into.warnings.push({ code, field: `${path}.${field}` });
}

// Step 3 of listing a garage: the labour range, the jobs with their ranges,
// a range per taken brand, and new jobs proposed by name. It holds the
// draft's section and saves nothing; the page judges it, and a range says
// what is wrong once it has been left, when it opens wrong, or when sending
// is asked for. A wide range is only a warning.
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
  // The catalogue jobs it has looked up, so step 2 can name them too.
  readonly known = output<ReadonlyMap<string, JobTypeDto>>();
  // The page's judgement of this step, and whether sending was asked for.
  readonly problems = input<ListingCheck>(NO_PROBLEMS);
  readonly showAll = input(false);
  // Whether any field shows an error, for the step list's dot.
  readonly shown = output<boolean>();

  protected readonly nameMax = JOB_NAME_MAX;
  private readonly names = signal<ReadonlyMap<string, JobTypeDto>>(new Map());
  // Renewed when a row goes, as the rows after it change their index.
  private watch = new FieldWatch();
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
    const known = this.names();
    const ids = (this.value()?.jobs ?? []).flatMap(({ jobTypeId }) =>
      jobTypeId !== undefined && !known.has(jobTypeId) ? [jobTypeId] : [],
    );
    return [...new Set(ids)].join(',');
  });
  protected readonly rows = computed(() => rows(this.section()));
  protected readonly full = computed(() => !canAdd(this.section()));
  // The page's judgement, plus the listed jobs it cannot see before the
  // draft takes them.
  private readonly judgement = computed((): ListingCheck => {
    const check = this.problems();
    if (this.value()?.jobs !== undefined) return check;
    const into = { errors: [...check.errors], warnings: [...check.warnings] };
    (this.section().jobs ?? []).forEach((entry, n) => {
      unsavedRange(`${JOBS}[${n}]`, entry, into);
    });
    return into;
  });
  // Every message the step shows, by the field's path.
  protected readonly messages = computed(() => {
    const check = this.judgement();
    const all = this.showAll();
    const watch = this.watch;
    const out = new Map<string, FieldMessage>();
    const tell = (field: string, filled: boolean) => {
      const message = watch.message(check, field, { all, filled });
      if (message) out.set(field, message);
    };
    const range = (path: string, ends: PriceEnds = {}) => {
      tell(`${path}.from`, ends.fromBani !== undefined);
      tell(`${path}.to`, ends.toBani !== undefined);
    };
    const section = this.section();
    range(LABOUR, section.labour);
    (section.jobs ?? []).forEach((entry, n) => {
      range(`${JOBS}[${n}]`, entry);
      tell(`${JOBS}[${n}].name`, entry.name !== undefined);
    });
    tell(JOBS, false);
    return out;
  });
  protected readonly jobsError = computed(() => this.error(JOBS));
  // Jobs already listed are never offered again.
  protected readonly results = computed(() => {
    const listed = new Set(this.section().jobs?.map((e) => e.jobTypeId));
    return this.found().filter((job) => !listed.has(job.id));
  });
  // Never a new job for a name an offered or listed job already bears.
  protected readonly proposal = computed(() => {
    const typed = this.query().trim();
    if (typed.length < JOB_NAME_MIN || typed.length > JOB_NAME_MAX) return null;
    const known = this.names();
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
    effect(() =>
      this.shown.emit([...this.messages().values()].some((m) => !m.warning)),
    );
    inject(DestroyRef).onDestroy(() => clearTimeout(this.timer));
    // The catalogue comes with the client: a server render would drop it.
    if (isPlatformServer(inject(PLATFORM_ID))) return;
    effect(() => this.known.emit(this.names()));
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
          return true;
        },
        () => {
          this.notice.set(`${KEY}.searchDown`);
          return false;
        },
      )
      .then((answered) => {
        this.asking = false;
        // What came to be wanted while this one was out; an id the
        // catalogue does not hold is not asked for twice, and a failure
        // waits for the step to become current again.
        const wantsKeys = this.wantsListed() && !keys;
        const wantsIds = this.unnamed() !== ids ? this.unnamed() : '';
        if (answered) this.lookup(wantsKeys, wantsIds);
      });
  }

  protected nameOf(entry: PriceEntry) {
    return jobName(entry, this.names(), this.i18n.language());
  }

  protected brandName(entry: PriceEntry) {
    return (
      this.takenBrands().find((b) => b.brandId === entry.brandId)?.name ?? ''
    );
  }

  protected offer(index: number) {
    return brandOffer(this.section(), index, this.takenBrands());
  }

  protected jobPath(index: number) {
    return `${JOBS}[${index}]`;
  }

  protected error(field: string): string | null {
    const message = this.messages().get(field);
    return message && !message.warning ? message.key : null;
  }

  /** The id of a range's message, which both its inputs point at. */
  protected messageIdOf(path: string) {
    return `listing-${path.replace(/[^a-z0-9]+/gi, '-')}-message`;
  }

  protected rangeOf(path: string): RangeMessages {
    const at = (end: End) => this.messages().get(`${path}.${end}`) ?? null;
    const errorAt = (end: End) => {
      const message = at(end);
      return message && !message.warning ? message : null;
    };
    const from = errorAt('from');
    const to = errorAt('to');
    return { from, shown: from ?? at('to'), to };
  }

  protected type(path: string, end: End) {
    this.watch.type(`${path}.${end}`);
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

  // Leaving either end leaves the range: a missing end shows too.
  protected leave(path: string) {
    for (const end of ENDS) this.watch.leave(`${path}.${end}`);
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

  // Indexes move once a row goes, so what was left is forgotten, all but
  // the labour range.
  protected drop(index: number) {
    const before = this.watch;
    this.watch = new FieldWatch();
    for (const end of ENDS) {
      const field = `${LABOUR}.${end}`;
      if (before.shows(field, { all: false, filled: false }))
        this.watch.leave(field);
    }
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
    this.names.update((known) => {
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
