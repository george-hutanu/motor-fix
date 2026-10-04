import { HttpErrorResponse } from '@angular/common/http';
import { Component, signal } from '@angular/core';
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { TranslatePipe } from '@motor-fix/i18n';
import {
  FieldError,
  injectOverlayTask,
  TaskDone,
  TaskError,
  TaskSubmit,
  taskSave,
} from '@motor-fix/overlays';

import { HlmButton } from './helm/button';
import { HlmInput } from './helm/input';
import { HlmLabel } from './helm/label';

export interface SampleFormData {
  // Called once per request the fake server receives.
  sent(): void;
  // Called when it saves, before it answers: the page behind is up to date
  // by the time the task closes.
  saved(plate: string): void;
}

const ANSWERS = [
  ['ok', 'cockpit.form.answers.ok'],
  ['field', 'cockpit.form.answers.field'],
  ['conflict', 'cockpit.form.answers.conflict'],
  ['server', 'cockpit.form.answers.server'],
  ['network', 'cockpit.form.answers.network'],
] as const;
type Answer = (typeof ANSWERS)[number][0];

// What the API's problem filter would answer, after a short wait.
const PROBLEMS: Record<Exclude<Answer, 'ok'>, HttpErrorResponse> = {
  conflict: new HttpErrorResponse({
    error: { code: 'conflict', status: 409 },
    status: 409,
  }),
  field: new HttpErrorResponse({
    error: {
      code: 'validation_failed',
      errors: [{ code: 'plate_taken', field: 'plate' }],
      status: 400,
    },
    status: 400,
  }),
  network: new HttpErrorResponse({ status: 0 }),
  server: new HttpErrorResponse({
    error: { code: 'internal_error', status: 500 },
    status: 500,
  }),
};

const WAIT = 800;

let ids = 0;

// The catalogue's sample form: every state of the shared saving behaviour,
// with a fake server whose answer can be chosen.
@Component({
  imports: [
    FieldError,
    HlmButton,
    HlmInput,
    HlmLabel,
    ReactiveFormsModule,
    TaskDone,
    TaskError,
    TaskSubmit,
    TranslatePipe,
  ],
  selector: 'mf-cockpit-sample-form-task',
  styles: `
    form,
    .field {
      display: grid;
    }
    form {
      gap: var(--mf-space-4);
    }
    .field {
      gap: var(--mf-space-2);
    }
    p {
      margin: 0;
    }
    select.spartan-input {
      padding-right: var(--mf-space-3);
    }
    .actions {
      display: grid;
      gap: var(--mf-space-3);
    }
    .actions button {
      white-space: normal;
    }
  `,
  template: `
    @if (save.state() === 'done') {
      <mf-task-done [save]="save" message="cockpit.form.saved" />
    } @else {
      <form [formGroup]="form" (ngSubmit)="save.submit()" novalidate>
        <p>{{ 'cockpit.form.intro' | t }}</p>
        <div class="field">
          <label hlmLabel [for]="id + '-plate'">{{ 'cockpit.form.plate' | t }}</label>
          <input
            hlmInput
            [id]="id + '-plate'"
            formControlName="plate"
            autocomplete="off"
            [attr.aria-describedby]="id + '-plate-error'"
          />
          <mf-field-error
            [id]="id + '-plate-error'"
            [save]="save"
            [control]="form.controls.plate"
          />
        </div>
        <div class="field">
          <label hlmLabel [for]="id + '-answer'">{{ 'cockpit.form.answer' | t }}</label>
          <select
            class="spartan-input"
            [id]="id + '-answer'"
            (change)="answer.set($any($event.target).value)"
          >
            @for (option of answers; track option[0]) {
              <option [value]="option[0]">{{ option[1] | t }}</option>
            }
          </select>
        </div>
        <div class="field">
          <label hlmLabel [for]="id + '-ending'">{{ 'cockpit.form.ending' | t }}</label>
          <select
            class="spartan-input"
            [id]="id + '-ending'"
            (change)="confirm.set($any($event.target).value === 'confirm')"
          >
            <option value="close">{{ 'cockpit.form.endings.close' | t }}</option>
            <option value="confirm">{{ 'cockpit.form.endings.confirm' | t }}</option>
          </select>
        </div>
        <div class="actions">
          <mf-task-error [save]="save" />
          <button hlmBtn type="submit" [mfTaskSubmit]="save">
            {{ 'cockpit.form.save' | t }}
          </button>
        </div>
      </form>
    }
  `,
})
export class CockpitSampleFormTask {
  private readonly task = injectOverlayTask<SampleFormData, string>();
  protected readonly id = `mf-sample-form-${++ids}`;
  protected readonly answers = ANSWERS;
  protected readonly answer = signal<Answer>('ok');
  protected readonly confirm = signal(false);
  protected readonly form = new FormGroup({
    plate: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(12)],
    }),
  });
  protected readonly save = taskSave({
    done: (plate: string) => {
      if (!this.confirm()) this.task.close(plate);
    },
    form: this.form,
    messages: 'cockpit.form.messages',
    send: ({ plate }) => this.serve(plate),
  });

  private serve(plate = ''): Promise<string> {
    this.task.data.sent();
    const answer = this.answer();
    return new Promise((resolve, reject) =>
      setTimeout(() => {
        if (answer !== 'ok') return reject(PROBLEMS[answer]);
        this.task.data.saved(plate);
        resolve(plate);
      }, WAIT),
    );
  }
}
