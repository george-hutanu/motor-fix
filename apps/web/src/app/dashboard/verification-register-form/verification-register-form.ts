import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  input,
  linkedSignal,
  output,
  signal,
} from '@angular/core';
import {
  CHECK_DETAIL_MAX,
  coversJob,
  uncoveredJobs,
} from '@motor-fix/contracts/verification-target';
import {
  AdminService,
  type RecordVerificationCheckDto,
  type VerificationCheckRecordedDto,
} from '@motor-fix/data-access';
import { I18n, TranslatePipe } from '@motor-fix/i18n';
import { toProblem } from '@motor-fix/overlays';
import { HlmButton, HlmInput, toast } from '@motor-fix/ui-cockpit';

type Kind = 'company' | 'caen' | 'rar' | 'activities';
type Result = RecordVerificationCheckDto['result'];
type Recorded = Exclude<Result, 'not_run'>;
type CaenTick = 'certificate' | 'onrc' | 'address';
type RarTick = 'found' | 'sameCompany' | 'sameAddress';
type Tick = CaenTick | RarTick;
// The control a refusal points at, so it can be named, marked and focused.
type Fault = 'result' | 'name' | 'detail' | 'activities' | Tick;
type Named = { nameEn: string; nameRo: string };
type RegisterActivity = Named & { code: string };
type RegisterJob = Named & {
  jobTypeId: string;
  rarActivity: string | null;
};
// The RAR authorisation as the documents section shows it: its line and the
// buttons that open each page.
type RegisterDocument = {
  line: string;
  buttons: { n: number; label: string; named: string }[];
};

const RESULTS: readonly Recorded[] = ['ok', 'warning', 'failed'];
// The fields a server refusal can name that the form has a control for.
const FIELD_FAULTS: readonly Fault[] = [
  'name',
  'certificate',
  'onrc',
  'address',
  'found',
  'sameCompany',
  'sameAddress',
];
// No control characters inside the detail, as the server refuses them.
const CONTROL = /\p{Cc}/u;

let instances = 0;

// One register check (the company, its CAEN code, its RAR authorisation or
// the authorised activities) recorded by hand, under its row in the drawer:
// the result, the detail a problem needs, and what the admin found. Hands the
// server's answer up; nothing is shown before it.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmButton, HlmInput, TranslatePipe],
  selector: 'mf-verification-register-form',
  styleUrl: './verification-register-form.css',
  templateUrl: './verification-register-form.html',
})
export class VerificationRegisterForm {
  private readonly api = inject(AdminService);
  private readonly i18n = inject(I18n);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly fileId = input.required<string>();
  readonly kind = input.required<Kind>();
  // The row's current result: "Resetează" clears one that has been recorded.
  readonly result = input<Result>('not_run');
  // Whether the file holds an ONRC certificate to tick.
  readonly certificate = input(false);
  readonly mobile = input(false);
  readonly address = input<string | null>(null);
  // The RAR number on the file, null when the garage gave none.
  readonly rarNumber = input<string | null>(null);
  // The RAR activity catalogue, the price list's jobs, the stored activities
  // and the uploaded authorisation, for the activities check.
  readonly catalogue = input<readonly RegisterActivity[]>([]);
  readonly jobs = input<readonly RegisterJob[]>([]);
  readonly activities = input<readonly string[]>([]);
  readonly document = input<RegisterDocument | null>(null);

  readonly recorded = output<VerificationCheckRecordedDto>();
  readonly decided = output<void>();
  // A page of the authorisation to open, by number.
  readonly page = output<number>();

  protected readonly id = `mf-register-${++instances}`;
  protected readonly results = computed(() => {
    this.i18n.language();
    return RESULTS.map((result) => ({
      label: this.t(`form.${result}`),
      result,
    }));
  });
  protected readonly detailMax = CHECK_DETAIL_MAX;

  protected readonly chosen = signal<Recorded | null>(null);
  protected readonly name = signal('');
  // What the admin typed in the detail; until then the proposed text shows.
  private readonly typedDetail = signal<string | null>(null);
  protected readonly ticks = signal<Record<Tick, boolean>>({
    address: false,
    certificate: false,
    found: false,
    onrc: false,
    sameAddress: false,
    sameCompany: false,
  });
  protected readonly ticked = linkedSignal(() => new Set(this.activities()));
  protected readonly busy = signal(false);
  protected readonly error = signal<{ faults: Fault[]; text: string } | null>(
    null,
  );

  protected readonly needsDetail = computed(
    () => this.chosen() === 'warning' || this.chosen() === 'failed',
  );
  protected readonly tickList = computed(() => {
    const all = this.kind() === 'rar' ? this.rarTicks() : this.caenTicks();
    this.i18n.language();
    return all.map((t) => ({ ...t, text: this.tickLabel(t.tick) }));
  });
  protected readonly catalogueList = computed(() => {
    const en = this.i18n.language() === 'en';
    return this.catalogue().map((a) => ({
      code: a.code,
      name: en ? a.nameEn : a.nameRo,
    }));
  });
  protected readonly jobList = computed(() => {
    const en = this.i18n.language() === 'en';
    const list = [...this.ticked()];
    return this.jobs().map((job) => ({
      id: job.jobTypeId,
      mark: this.jobMark(job.rarActivity, list),
      name: en ? job.nameEn : job.nameRo,
      uncovered: !coversJob(job.rarActivity, list),
    }));
  });
  protected readonly detail = computed(
    () => this.typedDetail() ?? this.proposal(),
  );
  // The detail a problem starts from: the number not found, or the jobs the
  // ticked activities leave uncovered.
  private readonly proposal = computed(() => {
    if (!this.needsDetail()) return '';
    if (this.kind() === 'rar')
      return this.ticks().found ? '' : this.t('proposed.rarNotFound');
    if (this.kind() !== 'activities') return '';
    const names = this.uncoveredNames();
    return names.length
      ? this.t('proposed.uncovered', {
          count: names.length,
          jobs: names.join(', '),
        })
      : '';
  });

  constructor() {
    afterNextRender(() => this.focus('result'));
  }

  protected faulty(fault: Fault) {
    return this.error()?.faults.includes(fault) ?? false;
  }

  protected choose(result: Recorded) {
    this.chosen.set(result);
    this.error.set(null);
  }

  protected toggle(tick: Tick, event: Event) {
    const checked = (event.target as HTMLInputElement).checked;
    this.ticks.update((all) => ({ ...all, [tick]: checked }));
  }

  protected toggleActivity(code: string, event: Event) {
    const checked = (event.target as HTMLInputElement).checked;
    this.ticked.update((all) => {
      const next = new Set(all);
      if (checked) next.add(code);
      else next.delete(code);
      return next;
    });
  }

  protected typed(field: 'name' | 'detail', event: Event) {
    const value = (event.target as HTMLInputElement).value;
    if (field === 'name') this.name.set(value);
    else this.typedDetail.set(value);
  }

  async save(event?: Event) {
    event?.preventDefault();
    const body = this.body();
    if (body) await this.send(body);
  }

  async clear() {
    this.error.set(null);
    await this.send({ result: 'not_run' });
  }

  // The body to send, or null once the refusal is shown.
  private body(): RecordVerificationCheckDto | null {
    const result = this.chosen();
    if (!result) return this.refuse(['result'], this.t('errors.result'));
    if (this.needsDetail() && !this.detailFits())
      return this.refuse(
        ['detail'],
        this.t('errors.detail', { field: this.t('form.detail') }),
      );
    if (result === 'ok' && !this.okHolds()) return null;
    const evidence = this.evidence();
    const activities = this.kind() === 'activities' && this.activityList();
    return {
      ...(activities && { activities }),
      ...(this.needsDetail() && { detail: this.detail().trim() }),
      ...(evidence && { evidence }),
      result,
    };
  }

  // Whether an OK holds what it needs, the refusal shown when it does not.
  private okHolds(): boolean {
    if (this.kind() === 'activities') return this.activitiesHold();
    if (this.kind() === 'rar' && !this.rarNumber()) {
      this.refuse(['found'], this.t('errors.noNumber'));
      return false;
    }
    const missing = this.missing();
    if (!missing.length) return true;
    this.refuse(
      missing.map((m) => m.fault),
      this.t('errors.missing', {
        fields: missing.map((m) => m.label).join(', '),
      }),
    );
    return false;
  }

  private activitiesHold(): boolean {
    if (!this.ticked().size) {
      this.refuse(['activities'], this.t('errors.oneActivity'));
      return false;
    }
    const names = this.uncoveredNames();
    if (!names.length) return true;
    this.refuse(
      ['activities'],
      this.t('errors.uncovered', { jobs: names.join(', ') }),
    );
    return false;
  }

  private evidence() {
    switch (this.kind()) {
      case 'company':
        return this.company();
      case 'caen':
        return this.caen();
      case 'rar':
        return this.rar();
      default:
        return undefined;
    }
  }

  // The ticked activities in the catalogue's order.
  private activityList() {
    const ticked = this.ticked();
    return this.catalogue()
      .map((a) => a.code)
      .filter((code) => ticked.has(code));
  }

  private uncoveredNames() {
    const en = this.i18n.language() === 'en';
    return uncoveredJobs(this.jobs(), [...this.ticked()]).map((job) =>
      en ? job.nameEn : job.nameRo,
    );
  }

  private rarTicks(): { tick: Tick; note: string | null }[] {
    return [
      { note: this.rarNumber() ?? this.t('noNumber'), tick: 'found' },
      { note: null, tick: 'sameCompany' },
      { note: this.address(), tick: 'sameAddress' },
    ];
  }

  private caenTicks(): { tick: Tick; note: string | null }[] {
    const all: { tick: Tick; note: string | null }[] = [
      { note: null, tick: 'certificate' },
      { note: null, tick: 'onrc' },
      { note: this.address(), tick: 'address' },
    ];
    return all.filter((t) => t.tick !== 'certificate' || this.certificate());
  }

  private detailFits() {
    const detail = this.detail().trim();
    return (
      detail.length > 0 &&
      detail.length <= CHECK_DETAIL_MAX &&
      !CONTROL.test(detail)
    );
  }

  private company() {
    const name = this.name().trim();
    return name ? { name } : undefined;
  }

  private rar() {
    const { found, sameAddress, sameCompany } = this.ticks();
    return { found, sameAddress, sameCompany };
  }

  private caen() {
    const { address, certificate, onrc } = this.ticks();
    return {
      address,
      ...(this.certificate() && { certificate }),
      onrc,
    };
  }

  // What an OK still lacks: the company's name, or a tick in the form.
  private missing(): { fault: Fault; label: string }[] {
    if (this.kind() === 'company')
      return this.company()
        ? []
        : [{ fault: 'name', label: this.t('form.name') }];
    const ticks = this.ticks();
    return this.tickList()
      .filter((t) => !ticks[t.tick])
      .map((t) => ({ fault: t.tick, label: t.text }));
  }

  private refuse(faults: Fault[], text: string): null {
    this.error.set({ faults, text });
    setTimeout(() => this.focus(faults[0]));
    return null;
  }

  private async send(body: RecordVerificationCheckDto) {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      const answer = await this.api.verificationChecksControllerRecord({
        body,
        id: this.fileId(),
        kind: this.kind(),
      });
      this.error.set(null);
      this.recorded.emit(answer);
    } catch (error) {
      this.failed(error);
    } finally {
      this.busy.set(false);
    }
  }

  // A decided file goes back to the drawer; the server's own refusal is shown
  // as the form's; anything else keeps the form and says so.
  private failed(error: unknown) {
    const problem = toProblem(error);
    if (problem.code === 'verification_file_decided') {
      this.decided.emit();
      return;
    }
    if (problem.status === 400 && this.serverRefusal(problem)) return;
    toast(this.i18n.t('admin.file.manual.saveFailed'));
  }

  // The server names the fields at fault: a missing tick or name is shown,
  // marked and focused as the form's own refusal; an invalid CUI in the
  // viewer's language; anything else as the server worded it.
  private serverRefusal(problem: ReturnType<typeof toProblem>): boolean {
    const fields = (problem.errors ?? []).map((e) => e.field);
    const faults = fields
      .map((f) => f.replace(/^evidence\./, ''))
      .filter((f): f is Fault => FIELD_FAULTS.includes(f as Fault));
    if (faults.length) {
      const labels = faults.map((f) =>
        f === 'name' ? this.t('form.name') : this.tickLabel(f as Tick),
      );
      this.refuse(
        faults,
        this.t('errors.missing', { fields: labels.join(', ') }),
      );
      return true;
    }
    if (fields.includes('cui')) {
      this.refuse(['result'], this.t('errors.cui'));
      return true;
    }
    if (fields.includes('rarNumber')) {
      this.refuse(['found'], this.t('errors.noNumber'));
      return true;
    }
    if (!problem.detail) return false;
    this.error.set({ faults: [], text: problem.detail });
    return true;
  }

  private tickLabel(tick: Tick) {
    return this.t(`ticks.${this.tickKey(tick)}`);
  }

  private tickKey(tick: Tick) {
    if (tick === 'address') return this.mobile() ? 'seat' : 'premises';
    if (tick === 'sameAddress' && this.mobile()) return 'sameSeat';
    return tick;
  }

  private focus(fault: Fault | undefined) {
    if (!fault) return;
    this.host.nativeElement
      .querySelector<HTMLElement>(`[data-fault="${fault}"]`)
      ?.focus();
  }

  // A job mapped to a code outside the catalogue can never be ticked, so it
  // reads uncovered with its code.
  // An unmapped job, or any job while nothing is ticked, is covered: the price
  // list's own rule (FR-004), so every job carries a mark (FR-008).
  private jobMark(rarActivity: string | null, list: readonly string[]) {
    if (!rarActivity || coversJob(rarActivity, list))
      return this.t('form.covered');
    const known = this.catalogue().some((a) => a.code === rarActivity);
    return known
      ? this.t('form.uncovered')
      : this.t('form.uncoveredCode', { code: rarActivity });
  }

  private t(key: string, params?: Record<string, string | number>) {
    return this.i18n.t(`admin.file.register.${key}`, params);
  }
}
