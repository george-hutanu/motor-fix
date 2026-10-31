import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  signal,
} from '@angular/core';
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  type ValidatorFn,
} from '@angular/forms';
import { normalisePhone } from '@motor-fix/contracts/phone';
import {
  type CarDto,
  type CarSaleDto,
  type CarSaleRepairDto,
  CarsService,
  type CarTransferSentDto,
} from '@motor-fix/data-access';
import { formatDay, I18n, TranslatePipe } from '@motor-fix/i18n';
import {
  FieldError,
  injectOverlayTask,
  type OverlayResult,
  TaskError,
  TaskSubmit,
  taskSave,
  toProblem,
} from '@motor-fix/overlays';
import { HlmButton, HlmInput, HlmLabel } from '@motor-fix/ui-cockpit';

export interface SellCarData {
  car: CarDto;
}

// 'remove' asks the card to go on to the removal confirmation; 'sent' (and a
// close after the send) asks it to read the cars again.
export type SellCarResult = 'sent' | 'remove';

type Read =
  | { state: 'loading' }
  | { state: 'failed' }
  | { state: 'read'; sale: CarSaleDto };

// Refusals of the phone the API names, shown under the field.
const PHONE_CODES = new Set(['invalid_phone', 'own_phone']);

// The shared normaliser's rule, so the field refuses what the API would.
const phoneRule: ValidatorFn = (control) =>
  normalisePhone(String(control.value ?? '')) ? null : { pattern: true };

// "Ai vândut <car>?": reads what the sale may pass on, asks whether the
// history goes to the buyer, then lists the repairs to pass and sends the
// buyer a link by WhatsApp. A "no" answers 'remove'; the done step shows the
// link to copy and answers 'sent' on Gata.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FieldError,
    HlmButton,
    HlmInput,
    HlmLabel,
    ReactiveFormsModule,
    TaskError,
    TaskSubmit,
    TranslatePipe,
  ],
  selector: 'mf-sell-car',
  styleUrl: './sell-car.css',
  templateUrl: './sell-car.html',
})
export class SellCar {
  private readonly cars = inject(CarsService);
  private readonly i18n = inject(I18n);
  protected readonly task = injectOverlayTask<
    SellCarData,
    OverlayResult<SellCarResult>
  >();

  protected readonly read = signal<Read>({ state: 'loading' });
  protected readonly step = signal<'choice' | 'list'>('choice');
  protected readonly ticked = signal<ReadonlySet<string>>(new Set());
  protected readonly copied = signal(false);
  protected readonly canCopy = !!globalThis.navigator?.clipboard?.writeText;

  protected readonly form = new FormGroup({
    phone: new FormControl('', { nonNullable: true, validators: phoneRule }),
  });

  protected readonly save = taskSave({
    form: this.form,
    messages: 'driver.cars.sale',
    send: ({ phone }) => this.send(phone ?? ''),
  });

  protected readonly sent = computed(
    () => this.save.result() as CarTransferSentDto | undefined,
  );

  private copyTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    // Nothing but the dialog's own buttons closes it while the link is sent.
    effect(() => this.task.hold(this.save.state() === 'sending'));
    inject(DestroyRef).onDestroy(() => clearTimeout(this.copyTimer));
    void this.load();
  }

  protected async load() {
    this.read.set({ state: 'loading' });
    try {
      const sale = await this.cars.carSaleControllerSale({
        id: this.task.data.car.id,
      });
      this.read.set({ sale, state: 'read' });
    } catch {
      this.read.set({ state: 'failed' });
    }
  }

  protected day(repair: CarSaleRepairDto) {
    return formatDay(repair.doneOn, this.i18n.language());
  }

  protected tick(id: string, on: boolean) {
    this.ticked.update((now) => {
      const set = new Set(now);
      if (on) set.add(id);
      else set.delete(id);
      return set;
    });
  }

  protected async copy(link: string) {
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      return;
    }
    this.copied.set(true);
    clearTimeout(this.copyTimer);
    this.copyTimer = setTimeout(() => this.copied.set(false), 2000);
  }

  private async send(buyerPhone: string) {
    const read = this.read();
    const repairs = read.state === 'read' ? read.sale.repairs : [];
    const ticked = this.ticked();
    try {
      return await this.cars.carSaleControllerSend({
        body: {
          buyerPhone,
          repairIds: repairs.map((r) => r.id).filter((id) => ticked.has(id)),
        },
        id: this.task.data.car.id,
      });
    } catch (error) {
      // The API names a refused phone at the top; the field shows it.
      const { code, status } = toProblem(error);
      if (!PHONE_CODES.has(code)) throw error;
      throw new HttpErrorResponse({
        error: {
          code: 'validation_failed',
          errors: [{ code, field: 'phone' }],
        },
        status,
      });
    }
  }
}
