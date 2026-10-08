import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  type ElementRef,
  Injector,
  inject,
  input,
  viewChild,
} from '@angular/core';
import type { AbstractControl } from '@angular/forms';
import { TranslatePipe } from '@motor-fix/i18n';

import type { TaskSave } from './form';
import { OVERLAY_TASK } from '../task';

// Stryker disable next-line StringLiteral: component styles are compile-time metadata; a mutated string is no literal Angular can compile, and no test reads CSS.
const ERROR_TEXT = `
  :host {
    display: block;
    color: var(--mf-red-ink);
    font-size: var(--mf-size-small);
  }
  p {
    margin: 0;
  }
`;

// The message under a field. Give it an id and point the field's
// aria-describedby at it.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'mf-field-error',
  styles: ERROR_TEXT,
  template: `{{ message() }}`,
})
export class FieldError {
  readonly save = input.required<TaskSave<unknown>>();
  readonly control = input.required<AbstractControl>();
  protected readonly message = computed(
    () => this.save().fieldError(this.control()) ?? '',
  );
}

// The messages next to the main button after a failed save, announced as
// they appear, followed by what the task projects into it.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { role: 'alert' },
  selector: 'mf-task-error',
  styles: ERROR_TEXT,
  template: `@for (message of save().errors(); track $index) {<p>{{ message }}</p>}<ng-content />`,
})
export class TaskError {
  readonly save = input.required<TaskSave<unknown>>();
}

// The main button: busy and inert while the save is on its way. It stays
// focusable, so the focus does not jump while it waits.
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[attr.aria-busy]': 'busy() || null',
    '[attr.aria-disabled]': 'busy() || null',
    '[attr.data-disabled]': 'busy() || null',
  },
  imports: [TranslatePipe],
  selector: 'button[mfTaskSubmit]',
  styles: `
    .mf-task-spinner {
      flex: none;
      width: 1em;
      height: 1em;
      border: 2px solid currentColor;
      border-right-color: transparent;
      border-radius: 50%;
      animation: mf-task-spin 800ms linear infinite;
    }
    .mf-task-sending {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
    @keyframes mf-task-spin {
      to {
        transform: rotate(1turn);
      }
    }
  `,
  template: `
    @if (busy()) {
      <span class="mf-task-spinner" aria-hidden="true"></span>
      <span class="mf-task-sending">{{ 'shell.form.sending' | t }}</span>
    }
    <ng-content />
  `,
})
export class TaskSubmit {
  readonly save = input.required<TaskSave<unknown>>({ alias: 'mfTaskSubmit' });
  protected readonly busy = computed(() => this.save().state() === 'sending');
}

// The confirmation shown in place of the form after a success, with Done (named
// apart from the overlay's Close).
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslatePipe],
  selector: 'mf-task-done',
  styles: `
    :host {
      display: grid;
      justify-items: center;
      gap: var(--mf-space-4);
      padding-top: var(--mf-space-4);
      text-align: center;
    }
    .mf-task-check {
      display: inline-grid;
      place-items: center;
      width: 56px;
      height: 56px;
      border: 2px solid var(--mf-green);
      border-radius: 50%;
      color: var(--mf-green);
    }
    p {
      margin: 0;
      font-size: 18px;
      font-weight: 700;
      text-wrap: balance;
    }
    button {
      width: 100%;
      white-space: normal;
    }
  `,
  template: `
    <span class="mf-task-check" aria-hidden="true">
      <svg
        fill="none"
        height="26"
        stroke="currentColor"
        stroke-linecap="round"
        stroke-linejoin="round"
        stroke-width="2.6"
        viewBox="0 0 24 24"
        width="26"
      >
        <path d="m5 12.5 4.5 4.5L19 7.5" />
      </svg>
    </span>
    <p role="status">{{ message() | t }}</p>
    <button
      #close
      type="button"
      class="spartan-button spartan-button-variant-secondary"
      (click)="finish()"
    >
      {{ 'shell.form.done' | t }}
    </button>
  `,
})
export class TaskDone {
  readonly save = input.required<TaskSave<unknown>>();
  // An i18n key.
  readonly message = input.required<string>();
  private readonly task = inject(OVERLAY_TASK);
  private readonly closeButton =
    viewChild.required<ElementRef<HTMLButtonElement>>('close');

  constructor() {
    afterNextRender(() => this.closeButton().nativeElement.focus(), {
      injector: inject(Injector),
    });
  }

  protected finish() {
    this.task.close(this.save().result());
  }
}
