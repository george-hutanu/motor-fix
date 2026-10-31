import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  type AbstractControl,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
} from '@angular/forms';
import { parseLeiText } from '@motor-fix/contracts/lei-text';
import { GarageJobsService, type JobDto } from '@motor-fix/data-access';
import { formatLei, LeiPipe, TranslatePipe } from '@motor-fix/i18n';
import {
  FieldError,
  injectOverlayTask,
  type OverlayResult,
  TaskError,
  TaskSubmit,
  taskSave,
} from '@motor-fix/overlays';
import { HlmButton, HlmInput } from '@motor-fix/ui-cockpit';

export interface FinalPriceData {
  jobId: string;
  // The accepted quote's bounds, in bani, from the job read the drawer holds.
  quoteFromBani: number;
  quoteToBani: number;
  // The price recorded at the handover, in bani: set, the dialog corrects it.
  recorded: number | null;
  // A refusal that says the job moved on: the drawer behind reads it again.
  reread: () => void;
}

// What the parser answers, as the field's error the shared texts word.
const lei = (control: AbstractControl<string>) => {
  const read = parseLeiText(control.value);
  return 'error' in read ? { server: read.error } : null;
};

// "Predare" and "Corectează prețul final": one amount in lei, sent as the
// handover or as the correction, closing with the job the API answers.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(window:offline)': 'online.set(false)',
    '(window:online)': 'online.set(true)',
  },
  imports: [
    FieldError,
    HlmButton,
    HlmInput,
    LeiPipe,
    ReactiveFormsModule,
    TaskError,
    TaskSubmit,
    TranslatePipe,
  ],
  selector: 'mf-final-price-dialog',
  styleUrl: './final-price-dialog.css',
  templateUrl: './final-price-dialog.html',
})
export class FinalPriceDialog {
  private readonly api = inject(GarageJobsService);
  protected readonly task = injectOverlayTask<
    FinalPriceData,
    OverlayResult<JobDto>
  >();
  protected readonly data = this.task.data;

  protected readonly online = signal(globalThis.navigator?.onLine !== false);
  // The field takes the Romanian format in both languages, as typed.
  protected readonly form = new FormGroup({
    price: new FormControl(
      this.data.recorded === null
        ? ''
        : formatLei(this.data.recorded, 'ro').replace(/\s*lei$/, ''),
      { nonNullable: true, validators: lei },
    ),
  });

  // Whether the typed amount is above the accepted quote: an advisory hint,
  // the amount still saves.
  private readonly typed = toSignal(this.form.controls.price.valueChanges, {
    initialValue: this.form.controls.price.value,
  });
  protected readonly above = computed(() => {
    const read = parseLeiText(this.typed());
    return 'bani' in read && read.bani > this.data.quoteToBani;
  });

  protected readonly save = taskSave({
    done: (job: JobDto) => this.task.close(job),
    form: this.form,
    messages: 'garage.jobs.finalPrice',
    send: ({ price = '' }) => {
      const read = parseLeiText(price);
      const params = {
        body: { finalPriceBani: 'bani' in read ? read.bani : 0 },
        id: this.data.jobId,
      };
      const sent =
        this.data.recorded === null
          ? this.api.jobStagesControllerHandover(params)
          : this.api.jobStagesControllerCorrect(params);
      return sent.catch((failure: unknown) => {
        if (failure instanceof HttpErrorResponse && failure.status === 409)
          this.data.reread();
        throw failure;
      });
    },
  });
  protected readonly sending = computed(() => this.save.state() === 'sending');
}
