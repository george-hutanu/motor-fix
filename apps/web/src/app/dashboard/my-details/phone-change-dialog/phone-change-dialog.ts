import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  type ElementRef,
  Injector,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import {
  type AbstractControl,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { normalisePhone } from '@motor-fix/contracts/phone';
import { type MeDto, MeService } from '@motor-fix/data-access';
import { I18n, TranslatePipe } from '@motor-fix/i18n';
import {
  FieldError,
  injectOverlayTask,
  TaskError,
  TaskSubmit,
  taskSave,
} from '@motor-fix/overlays';
import { HlmButton, HlmInput } from '@motor-fix/ui-cockpit';

const possiblePhone = (control: AbstractControl<string>) =>
  normalisePhone(control.value) ? null : { pattern: true };

// A new phone number: a code goes to it by WhatsApp, and the number changes
// once the code is typed here. Closes with who am I, the number confirmed.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FieldError,
    HlmButton,
    HlmInput,
    ReactiveFormsModule,
    TaskError,
    TaskSubmit,
    TranslatePipe,
  ],
  selector: 'mf-phone-change-dialog',
  styleUrl: './phone-change-dialog.css',
  templateUrl: './phone-change-dialog.html',
})
export class PhoneChangeDialog {
  private readonly api = inject(MeService);
  private readonly injector = inject(Injector);
  private readonly task = injectOverlayTask<undefined, MeDto>();
  private readonly codeInput =
    viewChild<ElementRef<HTMLInputElement>>('codeInput');

  protected readonly step = signal<'phone' | 'code'>('phone');
  // The number the code went to, in E.164.
  protected readonly number = signal('');

  protected readonly phoneForm = new FormGroup({
    phone: new FormControl('+40', {
      nonNullable: true,
      validators: [Validators.required, possiblePhone],
    }),
  });

  protected readonly codeForm = new FormGroup({
    code: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.pattern(/^\d{6}$/)],
    }),
  });

  protected readonly phoneSave = taskSave({
    done: (phone: string) => this.toCode(phone),
    form: this.phoneForm,
    messages: 'driver.phoneChange',
    send: async ({ phone: typed = '' }) => {
      const phone = normalisePhone(typed) ?? typed;
      await this.api.phoneChangeControllerRequest({ body: { phone } });
      return phone;
    },
  });

  protected readonly codeSave = taskSave({
    done: (me: MeDto) => this.task.close(me),
    form: this.codeForm,
    messages: 'driver.phoneChange.code',
    send: ({ code = '' }) =>
      this.api.phoneChangeControllerConfirm({ body: { code } }),
  });

  constructor() {
    void inject(I18n).enter('driver');
  }

  // A new code to the same number; it replaces the one sent before.
  protected sendAgain() {
    this.codeForm.reset();
    this.phoneSave.submit();
  }

  private toCode(phone: string) {
    this.number.set(phone);
    this.step.set('code');
    afterNextRender(() => this.codeInput()?.nativeElement.focus(), {
      injector: this.injector,
    });
  }
}
