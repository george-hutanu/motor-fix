import {
  Component,
  computed,
  Injector,
  inject,
  input,
  type OnInit,
  runInInjectionContext,
} from '@angular/core';
import {
  VERIFICATION_CHANGE_AREAS,
  type VerificationChangeArea,
} from '@motor-fix/contracts/verification-target';
import {
  AdminService,
  type VerificationChangeDto,
  type VerificationChangeJobDto,
  type VerificationFileChangesDto,
} from '@motor-fix/data-access';
import {
  formatDay,
  formatDuration,
  formatKm,
  formatLei,
  formatLeiRange,
  formatNum,
  I18n,
  TranslatePipe,
} from '@motor-fix/i18n';

import { type LiveView } from '../../live/view';
import { liveResource } from '../live';

const MISSING = '—';
const WORKS_ON = 'works_on';

// "Ce s-a schimbat": what the garage changed after the request for more,
// read from the history, for a file it sent back. The drawer shows it only
// for such a file; it reads again when the garage sends the file once more.
@Component({
  imports: [TranslatePipe],
  selector: 'mf-verification-changes',
  styleUrl: './verification-changes.css',
  templateUrl: './verification-changes.html',
})
export class VerificationChanges implements OnInit {
  private readonly api = inject(AdminService);
  private readonly i18n = inject(I18n);
  private readonly injector = inject(Injector);

  readonly fileId = input.required<string>();
  // The garage's photos and brands it works on now, from the file read.
  readonly photos = input.required<number>();
  readonly brands = input.required<number>();

  // Started once the file's id is bound: a required input has no value
  // while the component is constructed.
  private read!: LiveView<VerificationFileChangesDto>;

  ngOnInit() {
    this.read = runInInjectionContext(this.injector, () =>
      liveResource(
        () => this.api.verificationFileControllerChanges({ id: this.fileId() }),
        ['verification.submitted'],
        () => this.fileId(),
      ),
    );
  }

  protected readonly state = computed(() => {
    if (this.read.value()) return 'ready';
    return this.read.failed() || this.read.gone() ? 'failed' : 'loading';
  });

  protected readonly view = computed(() => {
    const answer = this.read.value();
    if (!answer) return undefined;
    const language = this.i18n.language();
    const cut = answer.total > answer.changes.length;
    return {
      groups: VERIFICATION_CHANGE_AREAS.map((area) => ({
        area,
        heading: this.t(`areas.${area}`),
        lines: this.linesOf(area, answer, cut),
      })).filter((group) => group.lines.length > 0),
      more: cut
        ? this.t('more', {
            count: answer.total - answer.changes.length,
            n: formatNum(answer.total - answer.changes.length, language),
          })
        : null,
      since: this.t('since', { date: formatDay(answer.requestedAt, language) }),
    };
  });

  retry() {
    this.read.reload();
  }

  private linesOf(
    area: VerificationChangeArea,
    answer: VerificationFileChangesDto,
    cut: boolean,
  ): string[] {
    const changes = answer.changes.filter((c) => c.area === area);
    if (changes.length === 0) return [];
    if (area === 'photos') {
      return [this.counted('garage_photo', this.photos(), changes, cut)];
    }
    if (area === 'brands') {
      return [this.counted('garage_brand', this.brands(), changes, cut)];
    }
    if (area === 'documents') return this.documents(changes);
    return this.fields(changes);
  }

  // A field of the garage is one line from its value before the request to
  // its latest; a price's field is one line per entry, its addition or
  // removal too; any other record added, changed or removed is one line for
  // its kind.
  private fields(changes: VerificationChangeDto[]): string[] {
    // Keyed so that a field changed twice is one line.
    const lines = new Map<string, string>();
    // Newest first: the first entry of a field holds its latest value, the
    // last its value before the request.
    const latest = new Map<string, VerificationChangeDto>();
    changes.forEach((change, n) => {
      if (isField(change)) {
        const key =
          change.subjectType === 'garage'
            ? `field:${change.field}`
            : `entry:${n}`;
        const newest = latest.get(key) ?? change;
        latest.set(key, newest);
        lines.set(
          key,
          this.fieldLine(
            change.field,
            change.oldValue ?? null,
            newest.newValue ?? null,
            change.job,
          ),
        );
        return;
      }
      const key = `subject:${change.subjectType}`;
      if (!lines.has(key)) {
        lines.set(
          key,
          this.t('changed', { label: this.subject(change.subjectType) }),
        );
      }
    });
    return [...lines.values()];
  }

  private fieldLine(
    field: string,
    before: unknown,
    after: unknown,
    job?: VerificationChangeJobDto,
  ) {
    const label = this.ofJob(this.label(field), job);
    const old = this.value(field, before);
    const now = this.value(field, after);
    return old === undefined || now === undefined
      ? this.t('changed', { label })
      : this.t('line', { label, new: now, old });
  }

  // The number before the request, worked back from the entries: what was
  // added since is taken off the number now, what was removed put back.
  private counted(
    subject: string,
    now: number,
    changes: VerificationChangeDto[],
    cut: boolean,
  ) {
    const label = this.subject(subject);
    const counts = (value: unknown) =>
      subject !== 'garage_brand' || stanceOf(value) === WORKS_ON;
    const before = changes.reduce(
      (n, change) => n - added(change, counts),
      now,
    );
    if (cut || before === now || before < 0) {
      return this.t('changed', { label });
    }
    const language = this.i18n.language();
    return this.t('line', {
      label,
      new: formatNum(now, language),
      old: formatNum(before, language),
    });
  }

  // One line per document kind: added and removed is a replacement.
  private documents(changes: VerificationChangeDto[]): string[] {
    const kinds = new Map<string, Set<string>>();
    for (const change of changes) {
      const kind = change.kind ?? change.subjectType;
      kinds.set(kind, (kinds.get(kind) ?? new Set()).add(change.action));
    }
    return [...kinds].map(([kind, actions]) => {
      const how =
        actions.has('update') ||
        (actions.has('create') && actions.has('delete'))
          ? 'replaced'
          : actions.has('create')
            ? 'added'
            : 'removed';
      return this.t(`documents.${how}`, { label: this.subject(kind) });
    });
  }

  // A value as the admin reads it, or undefined when it cannot be written.
  private value(field: string, value: unknown): string | undefined {
    if (value === null || value === '') return MISSING;
    if (isRange(value)) return this.range(value);
    if (typeof value === 'boolean') return this.t(value ? 'yes' : 'no');
    if (typeof value === 'number') return this.number(field, value);
    return typeof value === 'string' ? value : undefined;
  }

  // A range with no bottom has nothing to start from, whatever its top.
  private range({ from, to }: Range) {
    const language = this.i18n.language();
    if (from === null) return MISSING;
    return to === null
      ? this.t('rangeFrom', { from: formatLei(from, language) })
      : formatLeiRange(from, to, language);
  }

  private number(field: string, value: number) {
    const language = this.i18n.language();
    if (/(_bani|Bani)$/.test(field)) return formatLei(value, language);
    if (field === 'duration_minutes') return formatDuration(value, language);
    if (field === 'serviceRadiusKm') return formatKm(value, language);
    return formatNum(value, language);
  }

  // A price field's label names its job, and a brand range's brand.
  private ofJob(label: string, job?: VerificationChangeJobDto) {
    if (!job) return label;
    const name = this.i18n.language() === 'en' ? job.nameEn : job.nameRo;
    return job.brand
      ? this.t('ofJobBrand', { brand: job.brand, job: name, label })
      : this.t('ofJob', { job: name, label });
  }

  // A field's label, or its stored name when it has none.
  private label(field: string) {
    const key = `admin.file.changes.fields.${field}`;
    const label = this.i18n.t(key);
    return label === key ? field : label;
  }

  private subject(subject: string) {
    const key = `admin.file.changes.subjects.${subject}`;
    const label = this.i18n.t(key);
    return label === key ? subject : label;
  }

  private t(key: string, params?: Record<string, string | number>) {
    return this.i18n.t(`admin.file.changes.${key}`, params);
  }
}

// How many the entry added to the count: 1, -1 for a removal, or 0. A brand
// counts while the garage works on it.
function added(
  change: VerificationChangeDto,
  counts: (value: unknown) => boolean,
): number {
  if (change.action === 'create') return counts(change.newValue) ? 1 : 0;
  if (change.action === 'delete') return counts(change.oldValue) ? -1 : 0;
  if (change.field !== 'stance') return 0;
  return (
    Number(change.newValue === WORKS_ON) - Number(change.oldValue === WORKS_ON)
  );
}

const stanceOf = (value: unknown) =>
  value && typeof value === 'object' && 'stance' in value
    ? (value as { stance: unknown }).stance
    : undefined;

// A field's change, or a price added or removed, which is a line of its
// own from or to the dash.
const isField = (
  change: VerificationChangeDto,
): change is VerificationChangeDto & { field: string } =>
  Boolean(change.field) &&
  (change.action === 'update' || change.job !== undefined);

type Range = { from: number | null; to: number | null };

const isEnd = (end: unknown) => end === null || typeof end === 'number';

const isRange = (value: unknown): value is Range =>
  typeof value === 'object' &&
  value !== null &&
  'from' in value &&
  'to' in value &&
  isEnd(value.from) &&
  isEnd(value.to);
