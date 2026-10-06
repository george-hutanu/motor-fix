import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { I18n } from '@motor-fix/i18n';
import { EMPTY, Observable, of } from 'rxjs';

import {
  FieldError,
  injectOverlayTask,
  type OverlayResult,
  Overlays,
  TaskError,
  TaskSubmit,
  taskSave,
  toProblem,
} from './index';

type Value = unknown;

let send: (value: Value, key: string) => Promise<string> | Observable<string>;
let current: AdversaryTask;

@Component({
  imports: [ReactiveFormsModule, FieldError, TaskError, TaskSubmit],
  template: `
    <form [formGroup]="form" (ngSubmit)="save.submit()">
      <input id="name" formControlName="name" aria-describedby="name-error" />
      <mf-field-error id="name-error" [save]="save" [control]="form.controls.name" />
      <input id="note" formControlName="note" aria-describedby="note-error" />
      <mf-field-error id="note-error" [save]="save" [control]="form.controls.note" />
      <div formGroupName="address">
        <input id="city" formControlName="city" aria-describedby="city-error" />
        <mf-field-error id="city-error" [save]="save" [control]="form.controls.address.controls.city" />
      </div>
      <mf-task-error [save]="save" />
      <button id="save" type="submit" [mfTaskSubmit]="save">Salvează</button>
    </form>
  `,
})
class AdversaryTask {
  private readonly task = injectOverlayTask<undefined, string>();
  readonly sent: { key: string; value: Value }[] = [];
  readonly done: string[] = [];
  readonly form = new FormGroup({
    address: new FormGroup({
      city: new FormControl('Cluj', {
        nonNullable: true,
        validators: [Validators.required],
      }),
    }),
    locked: new FormControl({ disabled: true, value: 'fixed' }),
    name: new FormControl('Ana', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    note: new FormControl('', {
      nonNullable: true,
      validators: [
        Validators.maxLength(5),
        Validators.minLength(2),
        Validators.pattern(/^\d*$/),
      ],
    }),
  });
  readonly save = taskSave({
    done: (result: string) => {
      this.done.push(result);
      this.task.close(result);
    },
    form: this.form,
    send: (value, key) => {
      this.sent.push({ key, value });
      return send(value, key);
    },
  });

  constructor() {
    current = this;
  }
}

@Component({ template: '' })
class Host {
  readonly overlays = inject(Overlays);
}

const problem = (status: number, body: unknown) =>
  new HttpErrorResponse({ error: body, status, url: '/api/sample' });

async function settle() {
  for (let i = 0; i < 4; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

const $ = <T extends Element = HTMLElement>(selector: string) =>
  document.querySelector<T>(`.cdk-overlay-container ${selector}`);
const text = (selector: string) => $(selector)?.textContent?.trim() ?? '';
const t = (key: string, params?: Record<string, number>) =>
  TestBed.inject(I18n).t(key, params);

let result: Promise<OverlayResult<string>>;

async function openTask() {
  const host = TestBed.createComponent(Host).componentInstance;
  result = host.overlays.open<string>(AdversaryTask, {
    shape: 'dialog',
    title: 'shell.brand',
  });
  await settle();
}

async function type(id: string, value: string) {
  const field = $<HTMLInputElement>(`#${id}`);
  if (!field) throw new Error(`no field #${id}`);
  field.value = value;
  field.dispatchEvent(new Event('input', { bubbles: true }));
  await settle();
}

async function press() {
  $<HTMLButtonElement>('#save')?.click();
  await settle();
}

beforeEach(() => {
  send = () => Promise.resolve('saved');
  globalThis.matchMedia = (query: string) =>
    ({
      addEventListener() {},
      addListener() {},
      matches: query.includes('min-width: 768px'),
      media: query,
      removeEventListener() {},
      removeListener() {},
    }) as unknown as MediaQueryList;
});

afterEach(() => {
  document.querySelector('.cdk-overlay-container')?.remove();
});

describe('a send that misbehaves', () => {
  it('uses the first value of an observable that emits twice and sends once', async () => {
    send = () =>
      new Observable<string>((subscriber) => {
        subscriber.next('first');
        subscriber.next('second');
        subscriber.complete();
      });
    await openTask();
    await press();

    expect(current.done).toEqual(['first']);
    expect(current.sent).toHaveLength(1);
    await expect(result).resolves.toBe('first');
  });

  it('fails with the general error when an observable completes without a value', async () => {
    send = () => EMPTY;
    await openTask();
    await press();

    expect(current.save.state()).toBe('failed');
    expect(current.save.problem()?.code).toBe('error');
    expect(current.done).toEqual([]);
    expect(text('mf-task-error')).toBe(t('shell.form.problem.error'));
  });

  it('fails with the general error when send throws synchronously, and a retry works', async () => {
    let boom = true;
    send = () => {
      if (boom) throw new Error('sync boom');
      return of('saved');
    };
    await openTask();
    await press();

    expect(current.save.state()).toBe('failed');
    expect(current.save.problem()?.code).toBe('error');
    expect($<HTMLButtonElement>('#save')?.getAttribute('aria-busy')).not.toBe(
      'true',
    );

    boom = false;
    await press();
    await expect(result).resolves.toBe('saved');
  });

  it('reads a rejection with undefined as the general error', async () => {
    send = () => Promise.reject(undefined);
    await openTask();
    await press();

    expect(current.save.problem()).toEqual({ code: 'error', status: 0 });
  });

  it('sends once for ten presses made in the same tick', async () => {
    await openTask();
    for (let i = 0; i < 10; i++) current.save.submit();
    await settle();

    expect(current.sent).toHaveLength(1);
  });

  it('sends once when Enter submits the form twice in a row', async () => {
    send = () => new Promise(() => {});
    await openTask();
    const form = $<HTMLFormElement>('form');
    form?.dispatchEvent(new Event('submit', { cancelable: true }));
    form?.dispatchEvent(new Event('submit', { cancelable: true }));
    await settle();

    expect(current.sent).toHaveLength(1);
  });
});

describe('field messages', () => {
  it('names the required length for maxlength and shows one message when several validators fail', async () => {
    await openTask();
    await type('note', 'abcdefg');
    await press();

    expect(text('#note-error')).toBe(
      t('shell.form.field.maxlength', { requiredLength: 5 }),
    );
  });

  it('names the required length for minlength before the pattern message', async () => {
    await openTask();
    await type('note', '7');
    await press();

    expect(text('#note-error')).toBe(
      t('shell.form.field.minlength', { requiredLength: 2 }),
    );
  });

  it('shows the pattern message when only the pattern fails', async () => {
    await openTask();
    await type('note', 'abc');
    await press();

    expect(text('#note-error')).toBe(t('shell.form.field.pattern'));
  });

  it('accepts a value exactly at the maxlength cap', async () => {
    await openTask();
    await type('note', '12345');
    await press();

    expect(text('#note-error')).toBe('');
    expect(current.sent).toHaveLength(1);
  });

  it('rejects a value one past the maxlength cap', async () => {
    await openTask();
    await type('note', '123456');
    await press();

    expect(current.sent).toEqual([]);
  });
});

describe('nested groups and unusual controls', () => {
  it('explains an invalid nested control, focuses it and sends nothing', async () => {
    await openTask();
    await type('city', '');
    await press();

    expect(current.sent).toEqual([]);
    expect(text('#city-error')).toBe(t('shell.form.field.required'));
    expect(document.activeElement?.id).toBe('city');
  });

  it('sends the value without the disabled control, as the form reports it', async () => {
    await openTask();
    await press();

    expect(current.sent[0].value).toEqual({
      address: { city: 'Cluj' },
      name: 'Ana',
      note: '',
    });
  });

  it('shows a server error for a dotted nested path somewhere instead of losing it', async () => {
    send = () =>
      Promise.reject(
        problem(400, {
          code: 'validation_failed',
          errors: [{ code: 'required', field: 'address.city' }],
        }),
      );
    await openTask();
    await press();

    const shown = `${text('#city-error')}|${text('mf-task-error')}`;
    expect(shown).toContain(t('shell.form.field.required'));
    expect(current.form.controls.address.controls.city.value).toBe('Cluj');
  });

  it('shows a server error naming a disabled control next to the button', async () => {
    send = () =>
      Promise.reject(
        problem(400, {
          code: 'validation_failed',
          errors: [{ code: 'required', field: 'locked' }],
        }),
      );
    await openTask();
    await press();

    expect(current.save.state()).toBe('failed');
    expect(text('mf-task-error')).toContain(t('shell.form.field.required'));
    expect(current.form.controls.locked.disabled).toBe(true);
  });

  it('shows one of two server errors for the same field under it', async () => {
    send = () =>
      Promise.reject(
        problem(400, {
          code: 'validation_failed',
          errors: [
            { code: 'required', field: 'name' },
            { code: 'invalid', field: 'name' },
          ],
        }),
      );
    await openTask();
    await press();

    expect([
      t('shell.form.field.required'),
      t('shell.form.field.invalid'),
    ]).toContain(text('#name-error'));
  });

  it('shows an unknown field error code as the general field message', async () => {
    send = () =>
      Promise.reject(
        problem(400, {
          code: 'validation_failed',
          errors: [{ code: 'never_heard_of_it', field: 'name' }],
        }),
      );
    await openTask();
    await press();

    expect(text('#name-error')).toBe(t('shell.form.field.invalid'));
  });
});

describe('retrying and keys', () => {
  it('keeps the same key across three failures', async () => {
    send = () => Promise.reject(problem(500, { code: 'internal_error' }));
    await openTask();
    await press();
    await press();
    await press();

    const keys = new Set(current.sent.map((s) => s.key));
    expect(current.sent).toHaveLength(3);
    expect(keys.size).toBe(1);
  });

  it('keeps the key when a value is edited and reverted', async () => {
    send = () => Promise.reject(problem(500, { code: 'internal_error' }));
    await openTask();
    await press();
    await type('name', 'Ana Maria');
    await type('name', 'Ana');
    await press();

    expect(current.sent[1].key).toBe(current.sent[0].key);
  });

  it('does not send after an invalid press that follows a failure, and keeps the key afterwards', async () => {
    let fail = true;
    send = () =>
      fail
        ? Promise.reject(problem(500, { code: 'internal_error' }))
        : Promise.resolve('saved');
    await openTask();
    await press();
    await type('name', '');
    await press();
    expect(current.sent).toHaveLength(1);

    await type('name', 'Ana');
    fail = false;
    await press();
    expect(current.sent).toHaveLength(2);
    expect(current.sent[1].key).toBe(current.sent[0].key);
  });

  it('clears a failed problem on the next successful send', async () => {
    let fail = true;
    send = () =>
      fail
        ? Promise.reject(problem(500, { code: 'internal_error' }))
        : Promise.resolve('saved');
    await openTask();
    await press();
    fail = false;
    await press();

    expect(current.save.problem()?.code).toBeUndefined();
    expect(current.save.state()).toBe('done');
  });
});

describe('toProblem with hostile input', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', 'boom'],
    ['a number', 500],
  ])('reads %s as the general error', (_, error) => {
    expect(toProblem(error)).toEqual({ code: 'error', status: 0 });
  });

  it('drops members the contract does not name', () => {
    const out = toProblem(
      problem(409, { code: 'conflict', secret: 'x', stack: 'y' }),
    );
    expect(out).not.toHaveProperty('secret');
    expect(out).not.toHaveProperty('stack');
    expect(out.code).toBe('conflict');
  });

  it('omits errors when the list has no entries', () => {
    const out = toProblem(
      problem(400, { code: 'validation_failed', errors: [] }),
    );
    expect(out).toEqual({ code: 'validation_failed', status: 400 });
  });

  it('drops the whole list when one entry is malformed', () => {
    const out = toProblem(
      problem(400, {
        code: 'validation_failed',
        errors: [{ code: 'a', field: 'b' }, { code: 'a' }],
      }),
    );
    expect(out).toEqual({ code: 'validation_failed', status: 400 });
  });

  it('treats an array body as not a problem', () => {
    expect(toProblem(problem(404, [{ code: 'x' }]))).toEqual({
      code: 'not_found',
      status: 404,
    });
  });

  it.each([
    [499, 'error'],
    [500, 'internal_error'],
    [504, 'internal_error'],
    [599, 'internal_error'],
    [600, 'error'],
  ])('maps a %i answer without a problem body to %s', (status, code) => {
    expect(toProblem(problem(status, '<html></html>'))).toEqual({
      code,
      status,
    });
  });

  it('treats an empty code as not a problem code', () => {
    expect(toProblem(problem(500, { code: '' })).code).toBe('internal_error');
  });

  it('keeps a 500 while offline as a server error', () => {
    const online = jest
      .spyOn(navigator, 'onLine', 'get')
      .mockReturnValue(false);
    try {
      expect(toProblem(problem(500, null)).code).toBe('internal_error');
    } finally {
      online.mockRestore();
    }
  });
});
