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

import { OVERLAY_TASK } from '../task';

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
  // The last failure, until the next press is answered.
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
  // The first of the keys that has a text, else none.
  const found = (keys: string[]) =>
    keys.map((k) => i18n.t(k)).find((said, i) => said !== keys[i]) ?? null;
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
    problem.set(null);
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
      // Any limit, the ones a later change adds too, says how long to wait;
      // a code with a text of its own keeps it.
      const limited = failure.status === 429 ? limitText(i18n, failure) : null;
      return [
        found(own('problem', failure.code)) ??
          (failure.code === 'rate_limited' ? limited : null) ??
          found([`shell.form.problem.${failure.code}`]) ??
          limited ??
          i18n.t('shell.form.problem.error'),
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
      // The last failure's line stays until this press is answered, so the
      // task does not change height while the retry is on its way.
      const invalid = leaves(form).filter((c) => c.invalid);
      if (invalid.length) {
        problem.set(null);
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
  const offline = globalThis.navigator?.onLine === false;
  if (status === 0) return { code: offline ? 'offline' : 'network', status };
  const answer = parsed(error.error);
  // The service worker answers a fetch it could not make with a bare 504.
  if (status === 504 && offline && !codeOf(answer))
    return { code: 'offline', status };
  const problem = fromBody(answer, status);
  // A refusal past a limit names its wait in Retry-After.
  const retryAfterSeconds = wholeFrom(
    Number(error.headers?.get('Retry-After') ?? Number.NaN),
    1,
  );
  return retryAfterSeconds === null
    ? problem
    : { ...problem, retryAfterSeconds };
}

/**
 * The line for a call refused past a limit: the wait it names, rounded up to
 * whole minutes, else a neutral "a little while".
 */
export function limitText(i18n: I18n, problem: Problem): string {
  const seconds = problem.retryAfterSeconds;
  return seconds === undefined
    ? i18n.t('shell.form.problem.rate_limited')
    : i18n.t('shell.form.problem.rate_limited_wait', {
        count: Math.ceil(seconds / 60),
      });
}

// A call that answers nothing on success reads its failure as text.
function parsed(answer: unknown): unknown {
  if (typeof answer !== 'string') return answer;
  try {
    return JSON.parse(answer);
  } catch {
    return null;
  }
}

// A problem's code: a non-empty string, else none.
function codeOf(answer: unknown): string | null {
  const code = (answer as { code?: unknown } | null | undefined)?.code;
  return typeof code === 'string' && code !== '' ? code : null;
}

function fromBody(answer: unknown, status: number): Problem {
  const body = (
    typeof answer === 'object' && answer !== null ? answer : {}
  ) as Record<string, unknown>;
  const code = codeOf(body);
  if (!code) return { code: codeForStatus(status), status };
  const errors = fieldProblems(body['errors']);
  const warnings = fieldProblems(body['warnings']);
  const attemptsLeft = wholeFrom(body['attemptsLeft'], 0);
  const retryAfterSeconds = wholeFrom(body['retryAfterSeconds'], 1);
  return {
    code,
    status,
    ...(attemptsLeft !== null && { attemptsLeft }),
    ...(retryAfterSeconds !== null && { retryAfterSeconds }),
    ...texts(body),
    ...(errors && { errors }),
    ...(warnings && { warnings }),
  };
}

// The problem's text members that are present: a detail, and who decided
// first and when on a refused decision.
function texts(body: Record<string, unknown>) {
  const found: Pick<Problem, 'detail' | 'decidedBy' | 'decidedAt'> = {};
  for (const key of ['detail', 'decidedBy', 'decidedAt'] as const) {
    const value = textFrom(body[key]);
    if (value) found[key] = value;
  }
  return found;
}

function textFrom(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

// A whole number at or above the floor, else none.
function wholeFrom(value: unknown, floor: number): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= floor
    ? value
    : null;
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
