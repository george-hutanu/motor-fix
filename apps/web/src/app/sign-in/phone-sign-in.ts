import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
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
import { I18n, TranslatePipe } from '@motor-fix/i18n';
import {
  FieldError,
  injectOverlayTask,
  TaskError,
  TaskSubmit,
  taskSave,
} from '@motor-fix/overlays';
import { HlmButton, HlmInput } from '@motor-fix/ui-cockpit';

import type { AuthData, AuthSwitch } from './sign-in';
import { Session } from '../dashboard/session';

const CODE_SECONDS = 5 * 60;
const RESEND_SECONDS = 60;

const possiblePhone = (control: AbstractControl<string>) =>
  normalisePhone(control.value) ? null : { pattern: true };

const clock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

// Sign-in with a code sent by WhatsApp, in the sign-in dialog: the number,
// then the code. It closes with "signed-in", or with a switch back to the
// e-mail and password carrying what was typed.
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
  selector: 'mf-phone-sign-in',
  styles: `
    form { display: grid; gap: var(--mf-space-4); }
    p { margin: 0; color: var(--mf-text-secondary); overflow-wrap: anywhere; }
    .field { display: grid; gap: var(--mf-space-2); }
    label { font-weight: 700; }
    .remember { display: flex; align-items: center; gap: var(--mf-space-3); min-height: var(--mf-tap); font-weight: 400; cursor: pointer; }
    .remember input { width: 20px; height: 20px; margin: 0; accent-color: var(--mf-amber); }
    .code { font-variant-numeric: tabular-nums; letter-spacing: 0.2em; }
    button[type='submit'] { width: 100%; min-height: 54px; white-space: normal; }
    .links { display: flex; flex-wrap: wrap; justify-content: center; gap: 0 var(--mf-space-4); }
    .link { min-height: var(--mf-tap); padding: 0; border: 0; background: transparent; color: var(--mf-amber-ink); font: inherit; font-weight: 700; cursor: pointer; }
    .link:disabled { color: var(--mf-text-secondary); cursor: default; }
    .link:focus-visible { outline: 2px solid var(--mf-amber-ink); outline-offset: 2px; }
  `,
  template: `
    @if (step() === 'phone') {
      <form [formGroup]="phoneForm" (ngSubmit)="phoneSave.submit()" novalidate>
        <div class="field">
          <label for="mf-phone-number">{{ 'public.signIn.phone.number' | t }}</label>
          <input
            #phoneInput
            hlmInput
            id="mf-phone-number"
            type="tel"
            inputmode="tel"
            autocomplete="tel"
            formControlName="phone"
            aria-describedby="mf-phone-number-error"
          />
          <mf-field-error id="mf-phone-number-error" [save]="phoneSave" [control]="phoneForm.controls.phone" />
        </div>
        <label class="remember">
          <input type="checkbox" formControlName="remember" />
          <span>{{ 'public.signIn.remember' | t }}</span>
        </label>
        <mf-task-error [save]="phoneSave" />
        <button hlmBtn type="submit" [mfTaskSubmit]="phoneSave">
          {{ 'public.signIn.phone.send' | t }}
        </button>
        <p class="links">
          <button type="button" class="link" [disabled]="phoneSave.state() === 'sending'" (click)="toEmail()">
            {{ 'public.signIn.phone.withEmail' | t }}
          </button>
        </p>
      </form>
    } @else {
      <form [formGroup]="codeForm" (ngSubmit)="codeSave.submit()" novalidate>
        <p role="status">{{ 'public.signIn.code.sent' | t: { phone: number() } }}</p>
        <div class="field">
          <label for="mf-phone-code">{{ 'public.signIn.code.label' | t }}</label>
          <input
            #codeInput
            hlmInput
            class="code"
            id="mf-phone-code"
            type="text"
            inputmode="numeric"
            autocomplete="one-time-code"
            maxlength="6"
            formControlName="code"
            aria-describedby="mf-phone-code-error mf-phone-code-expires"
          />
          <mf-field-error id="mf-phone-code-error" [save]="codeSave" [control]="codeForm.controls.code" />
          <p id="mf-phone-code-expires">{{ 'public.signIn.code.expires' | t: { time: expiresIn() } }}</p>
        </div>
        <mf-task-error [save]="codeSave" />
        <mf-task-error [save]="phoneSave" />
        <button hlmBtn type="submit" [mfTaskSubmit]="codeSave">
          {{ 'public.signIn.code.submit' | t }}
        </button>
        <p class="links">
          <button type="button" class="link" [disabled]="resendLocked()" (click)="sendAgain()">
            {{ 'public.signIn.code.again' | t }}
          </button>
          <button type="button" class="link" [disabled]="codeSave.state() === 'sending'" (click)="changeNumber()">
            {{ 'public.signIn.code.change' | t }}
          </button>
        </p>
      </form>
    }
  `,
})
export class PhoneSignIn {
  private readonly session = inject(Session);
  private readonly i18n = inject(I18n);
  private readonly injector = inject(Injector);
  private readonly task = injectOverlayTask<
    AuthData,
    'signed-in' | AuthSwitch
  >();
  private readonly phoneInput =
    viewChild<ElementRef<HTMLInputElement>>('phoneInput');
  private readonly codeInput =
    viewChild<ElementRef<HTMLInputElement>>('codeInput');

  protected readonly step = signal<'phone' | 'code'>('phone');
  // The number the code went to, in E.164.
  protected readonly number = signal('');
  private readonly sentAt = signal(0);
  private readonly now = signal(Date.now());

  protected readonly expiresIn = computed(() =>
    clock(Math.max(0, CODE_SECONDS - this.elapsed())),
  );
  protected readonly resendLocked = computed(
    () =>
      this.elapsed() < RESEND_SECONDS || this.phoneSave.state() === 'sending',
  );

  protected readonly phoneForm = new FormGroup({
    phone: new FormControl(this.task.data?.phone ?? '+40', {
      nonNullable: true,
      validators: [Validators.required, possiblePhone],
    }),
    remember: new FormControl(true, { nonNullable: true }),
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
    messages: 'public.signIn.phone',
    send: ({ phone = '' }) => this.ask(phone),
  });

  protected readonly codeSave = taskSave({
    done: () => this.task.close('signed-in'),
    form: this.codeForm,
    messages: 'public.signIn.code',
    send: async ({ code = '' }) => {
      const { remember } = this.phoneForm.getRawValue();
      const me = await this.session.signInWithPhone(
        this.number(),
        code,
        remember,
      );
      if (!me) throw new Error('signed in without an account');
      return me;
    },
  });

  constructor() {
    void this.i18n.enter('public');
    const tick = setInterval(() => this.now.set(Date.now()), 1000);
    inject(DestroyRef).onDestroy(() => clearInterval(tick));
  }

  protected toEmail() {
    this.task.close({
      email: this.task.data?.email ?? '',
      phone: this.phoneForm.controls.phone.value.trim(),
      switchTo: 'sign-in',
    });
  }

  // The number as it was typed is sent again, as on the first press.
  protected sendAgain() {
    this.codeForm.reset();
    this.phoneSave.submit();
  }

  protected changeNumber() {
    this.codeForm.reset();
    this.step.set('phone');
    this.focus(this.phoneInput);
  }

  private elapsed() {
    return Math.floor((this.now() - this.sentAt()) / 1000);
  }

  private async ask(typed: string) {
    const phone = normalisePhone(typed) ?? typed;
    await this.session.phoneCode(phone, this.i18n.language());
    return phone;
  }

  private toCode(phone: string) {
    this.number.set(phone);
    this.now.set(Date.now());
    this.sentAt.set(this.now());
    this.step.set('code');
    this.focus(this.codeInput);
  }

  private focus(input: () => ElementRef<HTMLInputElement> | undefined) {
    afterNextRender(() => input()?.nativeElement.focus(), {
      injector: this.injector,
    });
  }
}
