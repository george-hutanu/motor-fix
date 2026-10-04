import { HttpErrorResponse } from '@angular/common/http';
import {
  afterNextRender,
  computed,
  DestroyRef,
  ElementRef,
  Injector,
  inject,
  type Signal,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { AbstractControl } from '@angular/forms';
import {
  codeForStatus,
  type FieldProblem,
  fieldProblems,
  type Problem,
} from '@motor-fix/contracts/problem';
import { I18n } from '@motor-fix/i18n';
import { firstValueFrom, isObservable, type Observable } from 'rxjs';

import { OVERLAY_TASK } from './task';

export type TaskSaveState = 'idle' | 'invalid' | 'sending' | 'done' | 'failed';

export interface TaskSaveOptions<F extends AbstractControl, R> {
  form: F;
  // Saves the value. Put the key in an `Idempotency-Key` header: it stays the
  // same while the person retries the same values. No endpoint reads it yet;
  // each saving endpoint does once it exists.
  send: (
    value: F['value'],
    idempotencyKey: string,
  ) => Promise<R> | Observable<R>;
  // After a success, e.g. `(result) => task.close(result)`. Without it the
  // task shows <mf-task-done> while `state()` is 'done'.
  done?: (result: R) => void;
  // An i18n key prefix for the task's own messages, looked up before the
  // shared ones: `<messages>.problem.<code>` and `<messages>.field.<code>`.
  messages?: string;
}

export interface TaskSave<R = unknown> {
  readonly state: Signal<TaskSaveState>;
  // The last failure, until the next press.
  readonly problem: Signal<Problem | null>;
  readonly result: Signal<R | undefined>;
  // The main button: validate, then send once.
  submit(): void;
  // The message under a field, or null while it shows none.
  fieldError(control: AbstractControl): string | null;
  // The messages next to the main button after a failure.
  errors(): string[];
}

const FIELD_ERRORS = [
  'server',
  'required',
  'email',
  'minlength',
  'maxlength',
  'pattern',
];

const INVALID_FIELD =
  'input.ng-invalid, select.ng-invalid, textarea.ng-invalid';

// The form behaviour every small task shares. Call it in the task component's
// field initialiser, and wire `(ngSubmit)="save.submit()"` on the form.
export function taskSave<F extends AbstractControl, R>(
  options: TaskSaveOptions<F, R>,
): TaskSave<R> {
  const { form, send, done, messages } = options;
  const host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  const injector = inject(Injector);
  const i18n = inject(I18n);
  const task = inject(OVERLAY_TASK, { optional: true });
  let destroyed = false;
  inject(DestroyRef).onDestroy(() => {
    destroyed = true;
  });

  const changes = signal(0);
  const touch = () => changes.update((n) => n + 1);
  form.events.pipe(takeUntilDestroyed()).subscribe(touch);

  const phase = signal<TaskSaveState>('idle');
  const problem = signal<Problem | null>(null);
  const result = signal<R | undefined>(undefined);
  const revealed = new Set<AbstractControl>();
  let key: string | null = null;
  let keyFor = '';

  const state = computed(() => {
    changes();
    return phase() === 'invalid' && form.valid ? 'idle' : phase();
  });

  const text = (keys: string[], params?: Record<string, number>) => {
    for (const k of keys) {
      const found = i18n.t(k, params);
      if (found !== k) return found;
    }
    return keys.at(-1) ?? '';
  };
  const own = (kind: 'field' | 'problem', code: string) =>
    messages ? [`${messages}.${kind}.${code}`] : [];
  const fieldText = (code: string, params?: Record<string, number>) =>
    text(
      [
        ...own('field', code),
        `shell.form.field.${code}`,
        'shell.form.field.invalid',
      ],
      params,
    );

  const focusFirstInvalid = () =>
    afterNextRender(
      () => host.querySelector<HTMLElement>(INVALID_FIELD)?.focus(),
      { injector },
    );

  const reveal = (controls: AbstractControl[]) => {
    for (const control of controls) {
      revealed.add(control);
      control.markAsTouched();
    }
    touch();
  };

  const succeed = (value: R) => {
    if (destroyed) return;
    key = null;
    revealed.clear();
    result.set(value);
    phase.set('done');
    task?.markUnchanged();
    done?.(value);
  };

  const fail = (error: unknown) => {
    if (destroyed) return;
    const failure = toProblem(error);
    problem.set(failure);
    phase.set('failed');
    const fields = (failure.errors ?? []).flatMap(({ code, field }) => {
      const control = editable(form.get(field));
      if (!control) return [];
      control.setErrors({ ...control.errors, server: code });
      return [control];
    });
    reveal(fields);
    if (fields.length) focusFirstInvalid();
  };

  return {
    errors() {
      const failure = problem();
      if (!failure) return [];
      const unknownFields = (failure.errors ?? []).filter(
        ({ field }: FieldProblem) => !editable(form.get(field)),
      );
      return [
        text([
          ...own('problem', failure.code),
          `shell.form.problem.${failure.code}`,
          'shell.form.problem.error',
        ]),
        ...unknownFields.map(({ code }) => fieldText(code)),
      ];
    },
    fieldError(control) {
      changes();
      const errors = control.errors;
      if (!errors || !revealed.has(control)) return null;
      const name = FIELD_ERRORS.find((n) => n in errors);
      if (name === 'server') return fieldText(String(errors['server']));
      if (name === 'minlength' || name === 'maxlength')
        return fieldText(name, {
          requiredLength: errors[name].requiredLength,
        });
      return fieldText(name ?? 'invalid');
    },
    problem: problem.asReadonly(),
    result: result.asReadonly(),
    state,
    submit() {
      if (phase() === 'sending') return;
      problem.set(null);
      const invalid = leaves(form).filter((c) => c.invalid);
      if (invalid.length) {
        phase.set('invalid');
        reveal(invalid);
        focusFirstInvalid();
        return;
      }
      const value = form.value;
      const serialised = JSON.stringify(value);
      if (key === null || serialised !== keyFor) {
        // randomUUID needs a secure context: HTTPS, or localhost in development.
        key = crypto.randomUUID();
        keyFor = serialised;
      }
      phase.set('sending');
      sending(() => send(value, key as string)).then(succeed, fail);
    },
  };
}

// Any error a save can end with, as the API's problem shape.
export function toProblem(error: unknown): Problem {
  if (!(error instanceof HttpErrorResponse))
    return { code: 'error', status: 0 };
  const { status } = error;
  if (status === 0)
    return {
      code: globalThis.navigator?.onLine === false ? 'offline' : 'network',
      status,
    };
  return fromBody(error.error, status);
}

function fromBody(answer: unknown, status: number): Problem {
  const body = (
    typeof answer === 'object' && answer !== null ? answer : {}
  ) as Record<string, unknown>;
  if (typeof body['code'] !== 'string' || body['code'] === '')
    return { code: codeForStatus(status), status };
  const errors = fieldProblems(body['errors']);
  const detail = typeof body['detail'] === 'string' ? body['detail'] : null;
  return {
    code: body['code'],
    status,
    ...(detail && { detail }),
    ...(errors && { errors }),
  };
}

// The send's answer as a promise; a send that throws fails the same way.
function sending<R>(start: () => Promise<R> | Observable<R>): Promise<R> {
  try {
    const answer = start();
    return isObservable(answer) ? firstValueFrom(answer) : answer;
  } catch (error) {
    return Promise.reject(error);
  }
}

// A control the person can still fix; a disabled one shows no message.
function editable(control: AbstractControl | null): AbstractControl | null {
  return control?.enabled ? control : null;
}

function leaves(control: AbstractControl): AbstractControl[] {
  const children = (control as { controls?: unknown }).controls;
  if (!children || typeof children !== 'object') return [control];
  return Object.values(children as Record<string, AbstractControl>).flatMap(
    leaves,
  );
}
