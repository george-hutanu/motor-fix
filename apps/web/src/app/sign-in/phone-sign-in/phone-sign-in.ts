import { NgTemplateOutlet } from '@angular/common';
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

import { Session } from '../../dashboard/session';
import { Consent, consentControl } from '../consent/consent';
import { ProviderButtons } from '../providers/providers';
import type { AuthData, AuthSwitch } from '../sign-in';
import { characters } from '../sign-up/sign-up';

const CODE_SECONDS = 5 * 60;
const RESEND_SECONDS = 60;

const possiblePhone = (control: AbstractControl<string>) =>
  normalisePhone(control.value) ? null : { pattern: true };

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
  styleUrl: './phone-sign-in.css',
  templateUrl: './phone-sign-in.html',
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
      this.refused(error);
      throw error;
    }
  }

  // What a refused code leaves on screen.
  private refused(error: unknown) {
    const { attemptsLeft, code } = toProblem(error);
    // A code refused at the profile step cannot open the account any more,
    // and that step has no field to type another in: only a new code helps.
    if (
      code === 'code_expired' ||
      (code === 'code_invalid' && this.step() === 'profile')
    ) {
      this.expire();
    }
    this.attemptsLeft.set(
      code === 'code_invalid' && attemptsLeft !== undefined
        ? { count: attemptsLeft }
        : null,
    );
    if (code === 'code_invalid') this.codeForm.controls.code.reset();
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
