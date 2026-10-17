import { HttpErrorResponse } from '@angular/common/http';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { CHECK_DETAIL_MAX } from '@motor-fix/contracts/verification-target';
import {
  AdminService,
  type RecordVerificationCheckDto,
  type VerificationCheckRecordedDto,
} from '@motor-fix/data-access';
import { I18n, TranslatePipe } from '@motor-fix/i18n';
import { toProblem } from '@motor-fix/overlays';
import { HlmButton, HlmInput, toast } from '@motor-fix/ui-cockpit';

type Kind = 'company' | 'caen';
type Result = RecordVerificationCheckDto['result'];
type Recorded = Exclude<Result, 'not_run'>;
type Tick = 'certificate' | 'onrc' | 'address';
// The control a refusal points at, so it can be named, marked and focused.
type Fault = 'result' | 'name' | 'detail' | Tick;

const RESULTS: readonly Recorded[] = ['ok', 'warning', 'failed'];
// No control characters inside the detail, as the server refuses them.
const CONTROL = /\p{Cc}/u;

let instances = 0;

// One register check (the company or its CAEN code) recorded by hand, under
// its row in the drawer: the result, the detail a problem needs, and what the
// admin found. Hands the server's answer up; nothing is shown before it.
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

  readonly recorded = output<VerificationCheckRecordedDto>();
  readonly decided = output<void>();

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
  protected readonly detail = signal('');
  protected readonly ticks = signal<Record<Tick, boolean>>({
    address: false,
    certificate: false,
    onrc: false,
  });
  protected readonly busy = signal(false);
  protected readonly error = signal<{ faults: Fault[]; text: string } | null>(
    null,
  );

  protected readonly needsDetail = computed(
    () => this.chosen() === 'warning' || this.chosen() === 'failed',
  );
  protected readonly tickList = computed(() => {
    const where = this.mobile() ? 'seat' : 'premises';
    const all: { tick: Tick; label: string; note: string | null }[] = [
      { label: 'certificate', note: null, tick: 'certificate' },
      { label: 'onrc', note: null, tick: 'onrc' },
      { label: where, note: this.address(), tick: 'address' },
    ];
    this.i18n.language();
    return all
      .filter((t) => t.tick !== 'certificate' || this.certificate())
      .map((t) => ({ ...t, text: this.t(`ticks.${t.label}`) }));
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

  protected typed(field: 'name' | 'detail', event: Event) {
    this[field].set((event.target as HTMLInputElement).value);
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
    const evidence = this.kind() === 'company' ? this.company() : this.caen();
    if (result === 'ok') {
      const missing = this.missing();
      if (missing.length)
        return this.refuse(
          missing.map((m) => m.fault),
          this.t('errors.missing', {
            fields: missing.map((m) => m.label).join(', '),
          }),
        );
    }
    return {
      ...(this.needsDetail() && { detail: this.detail().trim() }),
      ...(evidence && { evidence }),
      result,
    };
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
      .map((t) => ({ fault: t.tick, label: this.t(`ticks.${t.label}`) }));
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
    const message =
      error instanceof HttpErrorResponse && problem.status === 400
        ? (error.error as { message?: unknown } | null)?.message
        : undefined;
    if (typeof message === 'string' && message) {
      this.error.set({ faults: [], text: message });
      return;
    }
    toast(this.i18n.t('admin.file.manual.saveFailed'));
  }

  private focus(fault: Fault | undefined) {
    if (!fault) return;
    this.host.nativeElement
      .querySelector<HTMLElement>(`[data-fault="${fault}"]`)
      ?.focus();
  }

  private t(key: string, params?: Record<string, string | number>) {
    return this.i18n.t(`admin.file.register.${key}`, params);
  }
}
