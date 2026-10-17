import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  type ElementRef,
  effect,
  Injector,
  inject,
  input,
  output,
  untracked,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import {
  SUPPORT_EMAIL_MAX,
  SUPPORT_MESSAGE_MAX,
  SUPPORT_MESSAGE_MIN,
  SUPPORT_NAME_MAX,
  SUPPORT_TOPICS,
} from '@motor-fix/contracts/support';
import {
  type CreateSupportMessageDto,
  SupportService,
} from '@motor-fix/data-access';
import { I18n, TranslatePipe } from '@motor-fix/i18n';
import {
  FieldError,
  TaskError,
  TaskSubmit,
  taskSave,
} from '@motor-fix/overlays';
import { HlmButton, HlmInput } from '@motor-fix/ui-cockpit';

import { characters } from '../../../characters';

// Refusals the person cannot change by sending the same message again.
const FINAL = new Set(['too_many_messages', 'validation_failed']);

// The contact form, on the public page and in the dashboard's task: the same
// fields and answers in both. It shows its own confirmation, with the
// reference, in place of the fields.
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
  selector: 'mf-contact-form',
  styleUrl: './contact-form.css',
  templateUrl: './contact-form.html',
})
export class ContactForm {
  private readonly api = inject(SupportService);
  private readonly i18n = inject(I18n);
  private readonly injector = inject(Injector);

  // The signed-in account's name and address, filled in and left editable.
  readonly prefill = input<{ name: string; email: string | null } | null>(null);
  // In the task, the confirmation offers Close.
  readonly inTask = input(false);
  readonly closed = output<void>();

  protected readonly topics = SUPPORT_TOPICS.map((code) => ({
    code,
    label: `shell.contact.topics.${code}`,
  }));
  protected readonly max = SUPPORT_MESSAGE_MAX;

  protected readonly form = new FormGroup({
    email: new FormControl('', {
      nonNullable: true,
      validators: [
        Validators.required,
        Validators.email,
        Validators.maxLength(SUPPORT_EMAIL_MAX),
      ],
    }),
    message: new FormControl('', {
      nonNullable: true,
      validators: [characters(SUPPORT_MESSAGE_MIN, SUPPORT_MESSAGE_MAX, true)],
    }),
    name: new FormControl('', {
      nonNullable: true,
      validators: [characters(1, SUPPORT_NAME_MAX, true)],
    }),
    topic: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    // The trap: no person sees it; a value means a robot filled the form.
    website: new FormControl('', { nonNullable: true }),
  });

  private readonly typed = toSignal(this.form.controls.message.valueChanges, {
    initialValue: '',
  });
  protected readonly count = computed(() => [...this.typed()].length);

  protected readonly save = taskSave({
    form: this.form,
    messages: 'shell.contact',
    send: ({ name = '', email = '', topic = '', message = '', website = '' }) =>
      this.api.supportMessagesControllerCreate({
        body: {
          email,
          language: this.i18n.language(),
          message,
          name,
          topic: topic as CreateSupportMessageDto['topic'],
          ...(website ? { website } : {}),
        },
      }),
  });

  protected readonly reference = computed(
    () => this.save.result()?.reference ?? '',
  );

  protected readonly retry = computed(() => {
    const problem = this.save.problem();
    return (
      this.save.state() === 'failed' &&
      !!problem &&
      problem.status !== 400 &&
      !FINAL.has(problem.code)
    );
  });

  private readonly confirmation =
    viewChild<ElementRef<HTMLElement>>('confirmation');
  private readonly closeButton =
    viewChild<ElementRef<HTMLButtonElement>>('close');

  constructor() {
    effect(() => {
      const account = this.prefill();
      if (!account) return;
      untracked(() =>
        this.form.patchValue({
          email: account.email ?? '',
          name: account.name,
        }),
      );
    });
    // The fields are gone: the focus moves to what replaced them.
    effect(() => {
      if (this.save.state() !== 'done') return;
      afterNextRender(
        () =>
          (
            this.closeButton()?.nativeElement ??
            this.confirmation()?.nativeElement
          )?.focus(),
        { injector: this.injector },
      );
    });
  }
}
