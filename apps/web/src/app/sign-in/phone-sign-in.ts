import { NgTemplateOutlet } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  type ElementRef,
  effect,
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
import { Router } from '@angular/router';
import { normalisePhone } from '@motor-fix/contracts/phone';
import { I18n, TranslatePipe } from '@motor-fix/i18n';
import {
  FieldError,
  injectOverlayTask,
  TaskError,
  TaskSubmit,
  taskSave,
  toProblem,
} from '@motor-fix/overlays';
import { HlmButton, HlmInput } from '@motor-fix/ui-cockpit';

import { Consent, consentControl } from './consent';
import { ProviderButtons } from './providers';
import type { AuthData, AuthSwitch } from './sign-in';
import { characters } from './sign-up';
import { Session } from '../dashboard/session';

const CODE_SECONDS = 5 * 60;
const RESEND_SECONDS = 60;

const possiblePhone = (control: AbstractControl<string>) =>
  normalisePhone(control.value) ? null : { pattern: true };

// The tries a refused code has left, when the answer says so.
function attemptsLeftOf(error: unknown): number | null {
  const left =
    error instanceof HttpErrorResponse ? error.error?.attemptsLeft : undefined;
  return Number.isInteger(left) && left >= 0 ? left : null;
}

const clock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

// Sign-in with a code sent by WhatsApp, in the sign-in dialog: the number,
// then the code, then, for a number no account holds, the name and the
// consent that create a driver account. It closes with "signed-in", or with a switch back to the
// e-mail and password carrying what was typed.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    Consent,
    FieldError,
    HlmButton,
    HlmInput,
    NgTemplateOutlet,
    ProviderButtons,
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
    .fallback { display: grid; gap: var(--mf-space-3); }
    .fallback .problem { color: var(--mf-red-ink); font-size: var(--mf-size-small); }
    .left { margin: 0; color: inherit; }
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
        <ng-container [ngTemplateOutlet]="sendProblem" />
        <button hlmBtn type="submit" [mfTaskSubmit]="phoneSave">
          {{ 'public.signIn.phone.send' | t }}
        </button>
        <p class="links">
          <button type="button" class="link" [disabled]="phoneSave.state() === 'sending'" (click)="toEmail()">
            {{ 'public.signIn.phone.withEmail' | t }}
          </button>
        </p>
      </form>
    } @else if (step() === 'code') {
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
        @if (expired()) {
          <p role="alert" class="expired">{{ 'public.signIn.code.problem.code_expired' | t }}</p>
        } @else {
          <mf-task-error [save]="codeSave">
            @if (codeSave.problem()?.code === 'code_invalid' && attemptsLeft(); as left) {
              <p class="left">{{ 'public.signIn.code.attemptsLeft' | t: { count: left.count } }}</p>
            }
          </mf-task-error>
        }
        <ng-container [ngTemplateOutlet]="sendProblem" />
        <button hlmBtn type="submit" [mfTaskSubmit]="codeSave" [disabled]="expired()">
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
    } @else {
      <form [formGroup]="profileForm" (ngSubmit)="profileSave.submit()" novalidate>
        <p>{{ 'public.signIn.profile.intro' | t }}</p>
        <div class="field">
          <label for="mf-phone-name">{{ 'public.signIn.profile.name' | t }}</label>
          <input
            #nameInput
            hlmInput
            id="mf-phone-name"
            type="text"
            autocomplete="name"
            formControlName="name"
            aria-describedby="mf-phone-name-error"
          />
          <mf-field-error id="mf-phone-name-error" [save]="profileSave" [control]="profileForm.controls.name" />
        </div>
        <mf-consent [control]="profileForm.controls.consent" [save]="profileSave" />
        <mf-task-error [save]="profileSave" />
        <button hlmBtn type="submit" [mfTaskSubmit]="profileSave">
          {{ 'public.signIn.profile.submit' | t }}
        </button>
      </form>
    }
    <!-- Why the code was not sent; when WhatsApp did not take it, the other ways in. -->
    <ng-template #sendProblem>
      @if (phoneSave.problem()?.code === 'whatsapp_failed') {
        <div class="fallback" role="alert">
          <p class="problem">{{ 'public.signIn.phone.problem.whatsapp_failed' | t }}</p>
          <button type="button" class="link" (click)="toEmail()">
            {{ 'public.signIn.phone.withEmail' | t }}
          </button>
          <mf-provider-buttons [remember]="phoneForm.controls.remember.value" [returnTo]="returnTo" />
        </div>
      } @else {
        <mf-task-error [save]="phoneSave" />
      }
    </ng-template>
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
  private readonly nameInput =
    viewChild<ElementRef<HTMLInputElement>>('nameInput');

  // The screen whose action asked for the sign-in, to come back to after a
  // provider.
  protected readonly returnTo =
    this.task.data?.reason === true ? inject(Router).url : null;
  protected readonly step = signal<'phone' | 'code' | 'profile'>('phone');
  // The tries the last wrong code left, wrapped so 0 still shows.
  protected readonly attemptsLeft = signal<{ count: number } | null>(null);
  // The number the code went to, in E.164.
  protected readonly number = signal('');
  private readonly sentAt = signal(0);
  private readonly now = signal(Date.now());

  protected readonly expired = computed(() => this.elapsed() >= CODE_SECONDS);
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

  protected readonly profileForm = new FormGroup({
    consent: consentControl(),
    name: new FormControl('', {
      nonNullable: true,
      validators: [characters(2, 80, true)],
    }),
  });

  protected readonly phoneSave = taskSave({
    done: (phone: string) => this.toCode(phone),
    form: this.phoneForm,
    messages: 'public.signIn.phone',
    send: ({ phone = '' }) => this.ask(phone),
  });

  protected readonly codeSave = taskSave({
    done: (answer) =>
      answer === 'profile' ? this.toProfile() : this.task.close('signed-in'),
    form: this.codeForm,
    messages: 'public.signIn.code',
    send: () => this.signIn(),
  });

  protected readonly profileSave = taskSave({
    done: () => this.task.close('signed-in'),
    form: this.profileForm,
    messages: 'public.signIn.code',
    send: ({ name = '' }) =>
      this.signIn({ language: this.i18n.language(), name: name.trim() }),
  });

  constructor() {
    void this.i18n.enter('public');
    const tick = setInterval(() => this.now.set(Date.now()), 1000);
    inject(DestroyRef).onDestroy(() => clearInterval(tick));
    // At 0:00 only a new code helps: the field and the main button rest.
    effect(() => {
      const code = this.codeForm.controls.code;
      if (this.expired()) code.disable();
      else code.enable();
    });
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

  private async signIn(profile?: { name: string; language: 'ro' | 'en' }) {
    const { remember } = this.phoneForm.getRawValue();
    try {
      const answer = await this.session.signInWithPhone(
        this.number(),
        this.codeForm.getRawValue().code,
        remember,
        profile,
      );
      if (!answer) throw new Error('signed in without an account');
      return answer;
    } catch (error) {
      const { code } = toProblem(error);
      if (code === 'code_expired') this.expire();
      const left = code === 'code_invalid' ? attemptsLeftOf(error) : null;
      this.attemptsLeft.set(left === null ? null : { count: left });
      if (code === 'code_invalid') this.codeForm.controls.code.reset();
      throw error;
    }
  }

  // Back to the code step, where only a new code helps.
  private expire() {
    this.sentAt.set(this.now() - CODE_SECONDS * 1000);
    this.step.set('code');
  }

  private toProfile() {
    this.step.set('profile');
    this.focus(this.nameInput);
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
    this.attemptsLeft.set(null);
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
