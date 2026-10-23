import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { FieldError, Overlays, taskSave } from '@motor-fix/overlays';
import axe from 'axe-core';

import { HlmInput } from './input';
import { HlmLabel } from './label';

let answer: () => Promise<string>;

@Component({
  imports: [FieldError, HlmInput, HlmLabel, ReactiveFormsModule],
  template: `
    <form [formGroup]="form" (ngSubmit)="save.submit()" novalidate>
      <label hlmLabel for="name">Nume</label>
      <input hlmInput id="name" formControlName="name" aria-describedby="name-error" />
      <mf-field-error id="name-error" [save]="save" [control]="form.controls.name" />
      <label hlmLabel for="plate">Număr</label>
      <input hlmInput id="plate" formControlName="plate" aria-describedby="plate-error" />
      <mf-field-error id="plate-error" [save]="save" [control]="form.controls.plate" />
      <label hlmLabel for="twin">E-mail</label>
      <input
        hlmInput
        id="twin"
        formControlName="twin"
        [attr.aria-invalid]="save.fieldError(form.controls.twin) ? 'true' : null"
        aria-describedby="twin-error"
      />
      <mf-field-error id="twin-error" [save]="save" [control]="form.controls.twin" />
      <button id="save" type="submit">Salvează</button>
    </form>
  `,
})
class SavedForm {
  readonly form = new FormGroup({
    name: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(3)],
    }),
    plate: new FormControl('B 01 ABC', { nonNullable: true }),
    twin: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required],
    }),
  });
  readonly save = taskSave({ form: this.form, send: () => answer() });
}

@Component({
  imports: [HlmInput, ReactiveFormsModule],
  template: `
    <form [formGroup]="form" (ngSubmit)="save.submit()" novalidate>
      <input hlmInput id="wide" aria-label="Preț" formControlName="wide" [aria-invalid]="wide()" />
      <button id="save" type="submit">Salvează</button>
    </form>
  `,
})
class WideForm {
  readonly form = new FormGroup({
    wide: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required],
    }),
  });
  readonly wide = signal(false);
  readonly save = taskSave({ form: this.form, send: () => answer() });
}

@Component({
  imports: [HlmInput, ReactiveFormsModule],
  template: `
    <input hlmInput id="static" aria-invalid="true" />
    <input hlmInput id="bound" [attr.aria-invalid]="bad() ? 'true' : null" />
    <input
      hlmInput
      id="controlled"
      [formControl]="control"
      [attr.aria-invalid]="bad() ? 'true' : null"
    />
  `,
})
class OwnRule {
  readonly bad = signal(true);
  readonly control = new FormControl('', { validators: [Validators.required] });
}

@Component({
  imports: [HlmInput, ReactiveFormsModule],
  template: `<input hlmInput id="own" [formControl]="control" [aria-invalid]="bad()" />`,
})
class OwnInput {
  readonly bad = signal(true);
  readonly control = new FormControl('ok', {
    validators: [Validators.required],
  });
}

@Component({
  imports: [FieldError, HlmInput, HlmLabel, ReactiveFormsModule],
  template: `
    <form [formGroup]="form" (ngSubmit)="save.submit()" novalidate>
      <label hlmLabel for="task-name">Nume</label>
      <input hlmInput id="task-name" formControlName="name" aria-describedby="task-name-error" />
      <mf-field-error id="task-name-error" [save]="save" [control]="form.controls.name" />
      <button type="submit">Salvează</button>
    </form>
  `,
})
class FormTask {
  readonly form = new FormGroup({
    name: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required],
    }),
  });
  readonly save = taskSave({ form: this.form, send: () => answer() });
}

@Component({ template: '' })
class Opener {
  readonly overlays = inject(Overlays);
}

async function settle() {
  for (let i = 0; i < 4; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

async function render<T>(type: new () => T) {
  const fixture = TestBed.createComponent(type);
  fixture.detectChanges();
  await settle();
  const page = fixture.nativeElement as HTMLElement;
  const field = (id: string) =>
    page.querySelector(`#${id}`) as HTMLInputElement;
  return { component: fixture.componentInstance, field, page };
}

async function type(input: HTMLInputElement, value: string) {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await settle();
}

async function press(page: HTMLElement) {
  page.querySelector<HTMLButtonElement>('#save')?.click();
  await settle();
}

const invalid = (input: HTMLInputElement) => input.getAttribute('aria-invalid');

beforeEach(() => {
  answer = () => Promise.resolve('saved');
});

afterEach(() => {
  document.querySelector('.cdk-overlay-container')?.remove();
});

// @traces 495-FR-001
// @traces 495-FR-002
// @traces 495-FR-004
describe('kit input in a saved form', () => {
  it('announces nothing invalid when the form opens', async () => {
    const { field } = await render(SavedForm);

    expect(invalid(field('name'))).toBeNull();
    expect(invalid(field('twin'))).toBeNull();
  });

  it('announces nothing when the person only moves through the field', async () => {
    const { field } = await render(SavedForm);
    field('name').dispatchEvent(new Event('blur'));
    await settle();

    expect(invalid(field('name'))).toBeNull();
  });

  it('announces the field invalid with its message after the press', async () => {
    const { field, page } = await render(SavedForm);
    await press(page);

    expect(page.querySelector('#name-error')?.textContent?.trim()).not.toBe('');
    expect(invalid(field('name'))).toBe('true');
    expect(invalid(field('plate'))).toBeNull();
  });

  it('drops the announcement once the field is fixed', async () => {
    const { field, page } = await render(SavedForm);
    await press(page);
    await type(field('name'), 'Ana Pop');

    expect(invalid(field('name'))).toBeNull();
  });

  it('keeps it while a change leaves the field still invalid', async () => {
    const { field, page } = await render(SavedForm);
    await press(page);
    await type(field('name'), 'An');

    expect(invalid(field('name'))).toBe('true');
  });

  it('announces a server field error, and drops it on a valid change', async () => {
    answer = () =>
      Promise.reject(
        new HttpErrorResponse({
          error: {
            code: 'validation_failed',
            errors: [{ code: 'plate_taken', field: 'plate' }],
          },
          status: 400,
        }),
      );
    const { component, field, page } = await render(SavedForm);
    component.form.patchValue({ name: 'Ana Pop', twin: 'a' });
    await settle();
    await press(page);

    expect(invalid(field('plate'))).toBe('true');
    await type(field('plate'), 'B 02 ABC');
    expect(invalid(field('plate'))).toBeNull();
  });

  it('announces nothing after a successful save', async () => {
    const { component, field, page } = await render(SavedForm);
    await press(page);
    component.form.patchValue({ name: 'Ana Pop', twin: 'a' });
    await settle();
    await press(page);
    component.form.patchValue({ name: '' });
    await settle();

    expect(component.save.state()).toBe('done');
    expect(invalid(field('name'))).toBeNull();
  });

  it("agrees with a template that binds the save's own rule", async () => {
    const { field, page } = await render(SavedForm);
    expect(invalid(field('twin'))).toBeNull();
    await press(page);
    expect(invalid(field('twin'))).toBe('true');
    await type(field('twin'), 'ana@example.ro');
    expect(invalid(field('twin'))).toBeNull();
  });

  it("keeps the field's own wider rule while its control is valid", async () => {
    const { component, field, page } = await render(WideForm);
    await press(page);
    expect(invalid(field('wide'))).toBe('true');
    component.wide.set(true);
    await type(field('wide'), '10');

    expect(invalid(field('wide'))).toBe('true');
    component.wide.set(false);
    await settle();
    expect(invalid(field('wide'))).toBeNull();
  });

  it("does not reveal one save's field from another save's press", async () => {
    // TestBed keeps only the last root in the document, and a detached form
    // does not submit, so the pressed form renders last.
    const second = await render(SavedForm);
    const first = await render(SavedForm);
    await press(first.page);

    expect(invalid(first.field('name'))).toBe('true');
    expect(invalid(second.field('name'))).toBeNull();
  });

  it('paints the border and the data attributes as before', async () => {
    const { field, page } = await render(SavedForm);
    const name = field('name');
    expect(name.getAttribute('data-invalid')).toBe('true');
    expect(name.getAttribute('data-matches-spartan-invalid')).toBeNull();
    expect(name.getAttribute('data-touched')).toBeNull();
    expect(name.getAttribute('data-dirty')).toBeNull();

    await press(page);
    expect(name.getAttribute('data-matches-spartan-invalid')).toBe('true');
    expect(name.getAttribute('data-touched')).toBe('true');

    await type(name, 'Ana Pop');
    expect(name.getAttribute('data-dirty')).toBe('true');
    expect(name.getAttribute('data-invalid')).toBeNull();
    expect(name.getAttribute('data-matches-spartan-invalid')).toBeNull();
  });
});

// @traces 495-FR-003
describe("kit input and the field's own aria-invalid", () => {
  it('keeps an aria-invalid the template sets on the first render', async () => {
    const { field } = await render(OwnRule);

    expect(invalid(field('static'))).toBe('true');
    expect(invalid(field('bound'))).toBe('true');
    expect(invalid(field('controlled'))).toBe('true');
  });

  it("follows the template's own rule alone", async () => {
    const { component, field } = await render(OwnRule);
    component.bad.set(false);
    await settle();

    expect(invalid(field('bound'))).toBeNull();
    expect(invalid(field('controlled'))).toBeNull();

    component.bad.set(true);
    await settle();
    expect(invalid(field('bound'))).toBe('true');
    expect(invalid(field('controlled'))).toBe('true');
  });

  it('takes its own rule as an input, from the first render', async () => {
    const { component, field } = await render(OwnInput);
    expect(invalid(field('own'))).toBe('true');

    component.bad.set(false);
    await settle();
    expect(invalid(field('own'))).toBeNull();
  });
});

// @traces 495-FR-005
describe('a form dialog on open', () => {
  it('passes axe and announces no field invalid', async () => {
    const opener = TestBed.createComponent(Opener).componentInstance;
    void opener.overlays.open(FormTask, {
      shape: 'dialog',
      title: 'shell.brand',
    });
    await settle();

    const dialog = document.querySelector(
      '.cdk-overlay-container',
    ) as HTMLElement;
    expect(dialog.querySelector('#task-name')).not.toBeNull();
    expect(dialog.querySelectorAll('[aria-invalid="true"]')).toHaveLength(0);
    const { violations } = await axe.run(dialog, {
      resultTypes: ['violations'],
      // jsdom lays nothing out, so contrast cannot be measured here.
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(violations.map((v) => `${v.id} (${v.impact})`)).toEqual([]);
  });
});
