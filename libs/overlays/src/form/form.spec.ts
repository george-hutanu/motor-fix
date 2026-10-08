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

import {
  FieldError,
  injectOverlayTask,
  type OverlayResult,
  Overlays,
  TaskDone,
  TaskError,
  TaskSubmit,
  taskSave,
  toProblem,
} from '../index';

type Sent = { key: string; value: Partial<{ email: string; name: string }> };

let answer: () => Promise<string>;
let closeOnDone: boolean;
let current: SampleTask;

@Component({
  imports: [ReactiveFormsModule, FieldError, TaskDone, TaskError, TaskSubmit],
  template: `
    @if (save.state() === 'done') {
      <mf-task-done [save]="save" message="shell.brand" />
    } @else {
      <form [formGroup]="form" (ngSubmit)="save.submit()">
        <input id="name" formControlName="name" aria-describedby="name-error" />
        <mf-field-error id="name-error" [save]="save" [control]="form.controls.name" />
        <input id="email" formControlName="email" aria-describedby="email-error" />
        <mf-field-error id="email-error" [save]="save" [control]="form.controls.email" />
        <mf-task-error [save]="save" />
        <button id="save" type="submit" [mfTaskSubmit]="save">Salvează</button>
      </form>
    }
  `,
})
class SampleTask {
  private readonly task = injectOverlayTask<undefined, string>();
  readonly sent: Sent[] = [];
  readonly form = new FormGroup({
    email: new FormControl('', {
      nonNullable: true,
      validators: [Validators.email],
    }),
    name: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(3)],
    }),
  });
  readonly done: string[] = [];
  readonly save = taskSave({
    done: closeOnDone
      ? (result: string) => {
          this.done.push(result);
          this.task.close(result);
        }
      : undefined,
    form: this.form,
    send: (value, key) => {
      this.sent.push({ key, value });
      return answer();
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, reject, resolve };
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

let result: Promise<OverlayResult<string>>;

async function openTask(confirmDiscard?: boolean) {
  const host = TestBed.createComponent(Host).componentInstance;
  result = host.overlays.open<string>(SampleTask, {
    confirmDiscard,
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

const ro = (key: string, params?: Record<string, number>) =>
  TestBed.inject(I18n).t(key, params);

beforeEach(() => {
  answer = () => Promise.resolve('saved');
  closeOnDone = true;
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

describe('saving a task', () => {
  it('sends nothing while the person types', async () => {
    await openTask();
    await type('name', 'Ana Pop');
    await type('email', 'ana@example.ro');

    expect(current.sent).toEqual([]);
  });

  it('sends the value once, with an idempotency key, on the main button', async () => {
    await openTask();
    await type('name', 'Ana Pop');
    await press();

    expect(current.sent).toHaveLength(1);
    expect(current.sent[0].value).toEqual({ email: '', name: 'Ana Pop' });
    expect(current.sent[0].key).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('is busy while sending and sends nothing more on further presses', async () => {
    const pending = deferred<string>();
    answer = () => pending.promise;
    await openTask();
    await type('name', 'Ana Pop');
    await press();

    const button = $<HTMLButtonElement>('#save');
    expect(current.save.state()).toBe('sending');
    expect(button?.getAttribute('aria-busy')).toBe('true');
    expect(button?.getAttribute('aria-disabled')).toBe('true');
    expect(button?.textContent).toContain(ro('shell.form.sending'));

    await press();
    await press();
    $<HTMLFormElement>('form')?.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
    await settle();
    expect(current.sent).toHaveLength(1);

    pending.resolve('saved');
    await settle();
    await expect(result).resolves.toBe('saved');
  });

  it('closes with the result after success without asking about the changes', async () => {
    await openTask();
    await type('name', 'Ana Pop');
    await press();

    expect(current.done).toEqual(['saved']);
    await expect(result).resolves.toBe('saved');
    expect($('[role="alertdialog"]')).toBeNull();
  });

  it('shows the confirmation with Done when the task does not close itself', async () => {
    closeOnDone = false;
    await openTask();
    await type('name', 'Ana Pop');
    await press();

    expect($('form')).toBeNull();
    const status = $('mf-task-done [role="status"]');
    expect(status?.textContent?.trim()).toBe(ro('shell.brand'));
    const close = $<HTMLButtonElement>('mf-task-done button');
    expect(close?.textContent?.trim()).toBe(ro('shell.form.done'));
    expect(close?.textContent?.trim()).not.toBe(ro('shell.overlay.close'));
    expect(document.activeElement).toBe(close);

    close?.click();
    await settle();
    await expect(result).resolves.toBe('saved');
  });

  it('ignores an answer that arrives after the task was closed', async () => {
    const pending = deferred<string>();
    answer = () => pending.promise;
    await openTask(false);
    await type('name', 'Ana Pop');
    await press();
    const task = current;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    $<HTMLButtonElement>('.mf-overlay-close')?.click();
    await settle();
    await expect(result).resolves.toBe('cancelled');

    pending.resolve('saved');
    await settle();
    expect(task.done).toEqual([]);
  });
});

describe('validation', () => {
  it('shows the message under an empty required field, focuses it and sends nothing', async () => {
    await openTask();
    await press();

    expect(current.sent).toEqual([]);
    expect(current.save.state()).toBe('invalid');
    expect(text('#name-error')).toBe(ro('shell.form.field.required'));
    expect(text('#name-error')).toBe('Câmpul este obligatoriu.');
    expect(document.activeElement?.id).toBe('name');
  });

  it('names the length a short value needs', async () => {
    await openTask();
    await type('name', 'An');
    await press();

    expect(text('#name-error')).toBe('Scrie cel puțin 3 caractere.');
  });

  it('focuses the first invalid field in the form order', async () => {
    await openTask();
    await type('name', 'Ana Pop');
    await type('email', 'not an address');
    await press();

    expect(text('#name-error')).toBe('');
    expect(text('#email-error')).toBe(ro('shell.form.field.email'));
    expect(document.activeElement?.id).toBe('email');
  });

  it('speaks the person’s language', async () => {
    await TestBed.inject(I18n).use('en');
    await openTask();
    await press();

    expect(text('#name-error')).toBe('This field is required.');
  });

  it('re-checks a field that showed an error as it changes', async () => {
    await openTask();
    await press();
    await type('name', 'Ana Pop');

    expect(text('#name-error')).toBe('');
    expect(current.save.state()).toBe('idle');

    await type('name', '');
    expect(text('#name-error')).toBe(ro('shell.form.field.required'));
  });

  it('leaves a field that was valid at the press alone until the next press', async () => {
    await openTask();
    await type('name', 'Ana Pop');
    await type('email', 'nope');
    await press();
    await type('name', '');

    expect(text('#name-error')).toBe('');

    await press();
    expect(text('#name-error')).toBe(ro('shell.form.field.required'));
  });
});

describe('toProblem', () => {
  it('keeps a problem the API sent', () => {
    expect(
      toProblem(
        problem(400, {
          code: 'validation_failed',
          errors: [{ code: 'email_taken', field: 'email' }],
          status: 400,
          title: 'Bad Request',
          type: 'about:blank',
        }),
      ),
    ).toEqual({
      code: 'validation_failed',
      errors: [{ code: 'email_taken', field: 'email' }],
      status: 400,
    });
  });

  // A call that answers nothing on success reads its failure as text.
  it('reads a problem the API sent as text', () => {
    expect(
      toProblem(
        problem(410, JSON.stringify({ code: 'token_expired', status: 410 })),
      ),
    ).toEqual({ code: 'token_expired', status: 410 });
  });

  it('drops field errors that are not a list of field and code', () => {
    expect(
      toProblem(problem(400, { code: 'validation_failed', errors: 'email' })),
    ).toEqual({ code: 'validation_failed', status: 400 });
  });

  it('keeps the tries a refused code has left', () => {
    expect(
      toProblem(problem(401, { attemptsLeft: 2, code: 'code_invalid' })),
    ).toEqual({ attemptsLeft: 2, code: 'code_invalid', status: 401 });
  });

  it.each([-1, 1.5, '2', null])(
    'drops tries left that are not a whole number from 0 (%p)',
    (attemptsLeft) => {
      expect(
        toProblem(problem(401, { attemptsLeft, code: 'code_invalid' })),
      ).toEqual({ code: 'code_invalid', status: 401 });
    },
  );

  it('keeps how long a refused send must wait', () => {
    expect(
      toProblem(
        problem(429, { code: 'link_already_sent', retryAfterSeconds: 1200 }),
      ),
    ).toEqual({
      code: 'link_already_sent',
      retryAfterSeconds: 1200,
      status: 429,
    });
  });

  it.each([0, -5, 2.5, '60', null])(
    'drops a wait that is not a whole number of seconds above 0 (%p)',
    (retryAfterSeconds) => {
      expect(
        toProblem(
          problem(429, { code: 'link_already_sent', retryAfterSeconds }),
        ),
      ).toEqual({ code: 'link_already_sent', status: 429 });
    },
  );

  it('calls no answer at all a network failure', () => {
    expect(toProblem(problem(0, null))).toEqual({
      code: 'network',
      status: 0,
    });
  });

  it('calls no answer while the browser is offline an offline failure', () => {
    const online = jest
      .spyOn(navigator, 'onLine', 'get')
      .mockReturnValue(false);
    try {
      expect(toProblem(problem(0, null))).toEqual({
        code: 'offline',
        status: 0,
      });
    } finally {
      online.mockRestore();
    }
  });

  describe("the service worker's 504", () => {
    const offline = () =>
      jest.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);

    it.each([
      ['no body', null],
      ['an empty body', ''],
      ['a gateway page', '<html></html>'],
      ['an empty code', { code: '' }],
    ])('reads a 504 with %s while offline as offline', (_, body) => {
      const online = offline();
      try {
        expect(toProblem(problem(504, body))).toEqual({
          code: 'offline',
          status: 504,
        });
      } finally {
        online.mockRestore();
      }
    });

    it('keeps a 504 with no body while online as a server error', () => {
      expect(toProblem(problem(504, null))).toEqual({
        code: 'internal_error',
        status: 504,
      });
    });

    it('keeps the code of a 504 problem while offline', () => {
      const online = offline();
      try {
        expect(
          toProblem(problem(504, { code: 'token_expired', detail: 'late' })),
        ).toEqual({ code: 'token_expired', detail: 'late', status: 504 });
      } finally {
        online.mockRestore();
      }
    });

    it('keeps a 500 with no body while offline as a server error', () => {
      const online = offline();
      try {
        expect(toProblem(problem(500, null))).toEqual({
          code: 'internal_error',
          status: 500,
        });
      } finally {
        online.mockRestore();
      }
    });
  });

  it.each([
    [502, '<html>Bad gateway</html>', 'internal_error'],
    [409, { message: 'taken' }, 'conflict'],
    [503, null, 'service_unavailable'],
    [401, { code: 7 }, 'error'],
  ])(
    'gives a %i answer that is not a problem the code for its status',
    (status, body, code) => {
      expect(toProblem(problem(status, body))).toEqual({ code, status });
    },
  );

  it('calls anything else a general error', () => {
    expect(toProblem(new Error('boom'))).toEqual({ code: 'error', status: 0 });
  });
});

describe('failures', () => {
  it.each([
    ['conflict', 409],
    ['internal_error', 500],
    ['maintenance', 503],
    ['sign_in_required', 401],
  ])(
    'keeps the task and the text and shows the %s message next to the button',
    async (code, status) => {
      answer = () => Promise.reject(problem(status, { code, status }));
      await openTask();
      await type('name', 'Ana Pop');
      await press();

      expect(current.save.state()).toBe('failed');
      expect(current.save.problem()?.code).toBe(code);
      expect($('mf-task-error')?.getAttribute('role')).toBe('alert');
      expect(text('mf-task-error')).toBe(ro(`shell.form.problem.${code}`));
      expect($<HTMLInputElement>('#name')?.value).toBe('Ana Pop');
      expect($('form')).not.toBeNull();
    },
  );

  it('shows the general message for a code with no message of its own', async () => {
    answer = () => Promise.reject(problem(400, { code: 'brand_new_code' }));
    await openTask();
    await type('name', 'Ana Pop');
    await press();

    expect(text('mf-task-error')).toBe('Ceva nu a mers. Încearcă din nou.');
  });

  it('shows the network message when nothing answers', async () => {
    answer = () => Promise.reject(problem(0, null));
    await openTask();
    await type('name', 'Ana Pop');
    await press();

    expect(text('mf-task-error')).toBe(ro('shell.form.problem.network'));
    expect($<HTMLInputElement>('#name')?.value).toBe('Ana Pop');
  });

  it('puts field errors under their fields, focuses the first and clears one as it changes', async () => {
    answer = () =>
      Promise.reject(
        problem(400, {
          code: 'validation_failed',
          errors: [
            { code: 'email_taken', field: 'email' },
            { code: 'required', field: 'name' },
          ],
        }),
      );
    await openTask();
    await type('name', 'Ana Pop');
    await type('email', 'ana@example.ro');
    await press();

    expect(text('#name-error')).toBe(ro('shell.form.field.required'));
    expect(text('#email-error')).toBe(ro('shell.form.field.invalid'));
    expect(text('mf-task-error')).toBe(
      ro('shell.form.problem.validation_failed'),
    );
    expect(document.activeElement?.id).toBe('name');

    await type('email', 'ana@example.com');
    expect(text('#email-error')).toBe('');
    expect(text('#name-error')).toBe(ro('shell.form.field.required'));
  });

  it('shows a field error for a field the form does not have next to the button', async () => {
    answer = () =>
      Promise.reject(
        problem(400, {
          code: 'validation_failed',
          errors: [{ code: 'required', field: 'phone' }],
        }),
      );
    await openTask();
    await type('name', 'Ana Pop');
    await press();

    expect(text('mf-task-error')).toContain(
      ro('shell.form.problem.validation_failed'),
    );
    expect(text('mf-task-error')).toContain(ro('shell.form.field.required'));
  });

  it('still asks before closing after a failure', async () => {
    answer = () => Promise.reject(problem(500, { code: 'internal_error' }));
    await openTask();
    await type('name', 'Ana Pop');
    await press();
    $<HTMLButtonElement>('.mf-overlay-close')?.click();
    await settle();

    expect($('[role="alertdialog"]')).not.toBeNull();
  });
});

describe('retrying', () => {
  it('sends again with the same key for the same values', async () => {
    let fail = true;
    answer = () =>
      fail
        ? Promise.reject(problem(500, { code: 'internal_error' }))
        : Promise.resolve('saved');
    await openTask();
    await type('name', 'Ana Pop');
    await press();
    fail = false;
    await press();

    expect(current.sent).toHaveLength(2);
    expect(current.sent[1].key).toBe(current.sent[0].key);
    await expect(result).resolves.toBe('saved');
  });

  it('uses a new key once the values changed', async () => {
    answer = () => Promise.reject(problem(500, { code: 'internal_error' }));
    await openTask();
    await type('name', 'Ana Pop');
    await press();
    await type('name', 'Ana Popa');
    await press();

    expect(current.sent).toHaveLength(2);
    expect(current.sent[1].key).not.toBe(current.sent[0].key);
  });

  it('keeps the error line while the retry is sending and drops it on success', async () => {
    const retry = deferred<string>();
    answer = () => Promise.reject(problem(500, { code: 'internal_error' }));
    await openTask();
    await type('name', 'Ana Pop');
    await press();
    answer = () => retry.promise;
    await press();

    expect(current.save.state()).toBe('sending');
    expect(text('mf-task-error')).toBe(ro('shell.form.problem.internal_error'));

    retry.resolve('saved');
    await settle();
    expect(current.save.problem()).toBeNull();
    expect(current.save.errors()).toEqual([]);
  });

  it('puts the new failure in place of the old one on the answer', async () => {
    const retry = deferred<string>();
    answer = () => Promise.reject(problem(500, { code: 'internal_error' }));
    await openTask();
    await type('name', 'Ana Pop');
    await press();
    answer = () => retry.promise;
    await press();
    retry.reject(problem(409, { code: 'conflict' }));
    await settle();

    expect(text('mf-task-error')).toBe(ro('shell.form.problem.conflict'));
  });

  it('drops the error line when the press finds an invalid field', async () => {
    answer = () => Promise.reject(problem(500, { code: 'internal_error' }));
    await openTask();
    await type('name', 'Ana Pop');
    await press();
    await type('name', '');
    await press();

    expect(current.save.state()).toBe('invalid');
    expect(current.save.problem()).toBeNull();
    expect(text('mf-task-error')).toBe('');
    expect(current.sent).toHaveLength(1);
  });

  it('uses a new key after a success', async () => {
    closeOnDone = false;
    await openTask();
    await type('name', 'Ana Pop');
    await press();
    current.save.submit();
    await settle();

    expect(current.sent).toHaveLength(2);
    expect(current.sent[1].key).not.toBe(current.sent[0].key);
  });
});
