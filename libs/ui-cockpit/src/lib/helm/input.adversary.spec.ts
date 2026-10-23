import { HttpErrorResponse } from '@angular/common/http';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  FormArray,
  FormControl,
  FormGroup,
  FormsModule,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { fieldRevealed, taskSave } from '@motor-fix/overlays';

import { HlmInput } from './input';

let answer: () => Promise<string>;

@Component({
  imports: [HlmInput, ReactiveFormsModule],
  template: `
    <form [formGroup]="form" (ngSubmit)="save.submit()" novalidate>
      <input hlmInput id="name" aria-label="n" formControlName="name" />
      <input hlmInput id="twin" aria-label="t" [formControl]="form.controls.name" />
      <div formGroupName="address">
        <input hlmInput id="city" aria-label="c" formControlName="city" />
      </div>
      <div formArrayName="tags">
        <input hlmInput id="tag0" aria-label="g" [formControlName]="0" />
      </div>
      <input hlmInput id="off" aria-label="o" formControlName="off" />
      <input hlmInput id="plate" aria-label="p" formControlName="plate" />
      @if (late()) {
        <input hlmInput id="late" aria-label="l" [formControl]="form.controls.name" />
      }
      <button id="save" type="submit">Salvează</button>
    </form>
  `,
})
class Rich {
  readonly late = signal(false);
  readonly form = new FormGroup({
    address: new FormGroup({
      city: new FormControl('', {
        nonNullable: true,
        validators: [Validators.required],
      }),
    }),
    name: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    off: new FormControl({ disabled: true, value: '' }, [Validators.required]),
    plate: new FormControl('B 01 ABC', { nonNullable: true }),
    tags: new FormArray([
      new FormControl('', {
        nonNullable: true,
        validators: [Validators.required],
      }),
    ]),
  });
  readonly save = taskSave({ form: this.form, send: () => answer() });
}

@Component({
  imports: [HlmInput, FormsModule, ReactiveFormsModule],
  template: `
    <input hlmInput id="a" aria-label="a" [formControl]="current()" />
    <input hlmInput id="free" aria-label="f" [(ngModel)]="text" />
    <button id="save" type="button" (click)="save.submit()">Salvează</button>
  `,
})
class Swap {
  readonly first = new FormControl('', {
    nonNullable: true,
    validators: [Validators.required],
  });
  readonly second = new FormControl('', {
    nonNullable: true,
    validators: [Validators.required],
  });
  readonly group = new FormGroup({ first: this.first });
  readonly current = signal<FormControl>(this.first);
  text = '';
  readonly save = taskSave({ form: this.group, send: () => answer() });
}

@Component({
  imports: [HlmInput],
  template: `
    <input hlmInput id="bool" [aria-invalid]="b()" />
    <input hlmInput id="str" [aria-invalid]="s()" />
    <input hlmInput id="falseAttr" aria-invalid="false" />
    <input hlmInput id="attrNull" [attr.aria-invalid]="null" />
    <input hlmInput id="given" [id]="'given-id'" />
    <input hlmInput id="plain" />
    <input hlmInput [id]="'ünï-ключ'" aria-label="u" />
  `,
})
class Own {
  readonly b = signal(false);
  readonly s = signal<string>('spelling');
}

const shared = new FormControl('', {
  nonNullable: true,
  validators: [Validators.required],
});

// A form that reveals the shared control with its press, then goes away.
@Component({
  imports: [HlmInput, ReactiveFormsModule],
  template: `
    <input hlmInput id="gone" aria-label="g" [formControl]="control" />
    <button id="save" type="button" (click)="save.submit()">Salvează</button>
  `,
})
class Pressed {
  control = shared;
  readonly save = taskSave({
    form: new FormGroup({ shared }),
    send: () => answer(),
  });
}

// A fresh input on the same control, outside any save.
@Component({
  imports: [HlmInput, ReactiveFormsModule],
  template:
    '<input hlmInput id="gone" aria-label="g" [formControl]="control" />',
})
class Gone {
  control = shared;
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
  return { component: fixture.componentInstance, field, fixture, page };
}

async function press(page: HTMLElement) {
  page.querySelector<HTMLButtonElement>('#save')?.click();
  await settle();
}

const invalid = (input: HTMLInputElement) => input.getAttribute('aria-invalid');

beforeEach(() => {
  answer = () => Promise.resolve('saved');
});

// @traces 495-FR-001
describe('kit input reveal rule under hostile control states', () => {
  it('announces leaves of nested groups and arrays after the press and no disabled field', async () => {
    const { field, page } = await render(Rich);
    expect(invalid(field('city'))).toBeNull();
    expect(invalid(field('tag0'))).toBeNull();
    await press(page);

    expect(invalid(field('city'))).toBe('true');
    expect(invalid(field('tag0'))).toBe('true');
    expect(invalid(field('off'))).toBeNull();
    expect(invalid(field('plate'))).toBeNull();
  });

  it('announces every input bound to the same revealed control', async () => {
    const { field, page } = await render(Rich);
    await press(page);

    expect(invalid(field('name'))).toBe('true');
    expect(invalid(field('twin'))).toBe('true');
  });

  it('announces at once an input created after the press for a revealed invalid control', async () => {
    const { component, field, page } = await render(Rich);
    await press(page);
    component.late.set(true);
    await settle();

    expect(invalid(field('late'))).toBe('true');
  });

  it('is unchanged by pressing twice', async () => {
    const { field, page } = await render(Rich);
    await press(page);
    await press(page);

    expect(invalid(field('name'))).toBe('true');
    expect(invalid(field('plate'))).toBeNull();
  });

  it('drops the announcement when the revealed control is disabled', async () => {
    const { component, field, page } = await render(Rich);
    await press(page);
    component.form.controls.name.disable();
    await settle();

    expect(invalid(field('name'))).toBeNull();
  });

  it('agrees with the message after a reset that leaves the control invalid', async () => {
    const { component, field, page } = await render(Rich);
    await press(page);
    component.form.reset();
    await settle();
    const shown =
      component.save.fieldError(component.form.controls.name) !== null;

    expect(invalid(field('name'))).toBe(shown ? 'true' : null);
  });

  it('agrees with the message when an error is set by hand after the press', async () => {
    const { component, field, page } = await render(Rich);
    await press(page);
    component.form.controls.name.setValue('x');
    component.form.controls.name.setErrors({ custom: true });
    await settle();
    const shown =
      component.save.fieldError(component.form.controls.name) !== null;

    expect(invalid(field('name'))).toBe(shown ? 'true' : null);
  });

  it('announces nothing after the revealed field is fixed and a later save succeeds', async () => {
    const { component, field, page } = await render(Rich);
    await press(page);
    component.form.patchValue({ address: { city: 'Cluj' }, name: 'Ana' });
    component.form.controls.tags.at(0).setValue('a');
    await settle();
    await press(page);
    component.form.patchValue({ name: '' });
    await settle();

    expect(component.save.state()).toBe('done');
    expect(invalid(field('name'))).toBeNull();
    expect(fieldRevealed(component.form.controls.name)).toBe(false);
  });

  it('announces a server error on a valid field and clears it when the save later succeeds', async () => {
    let fail = true;
    answer = () =>
      fail
        ? Promise.reject(
            new HttpErrorResponse({
              error: {
                code: 'validation_failed',
                errors: [{ code: 'plate_taken', field: 'plate' }],
              },
              status: 400,
            }),
          )
        : Promise.resolve('saved');
    const { component, field, page } = await render(Rich);
    component.form.patchValue({ address: { city: 'Cluj' }, name: 'Ana' });
    component.form.controls.tags.at(0).setValue('a');
    await press(page);
    expect(invalid(field('plate'))).toBe('true');

    fail = false;
    component.form.controls.plate.setValue('B 02 ABC');
    await settle();
    expect(invalid(field('plate'))).toBeNull();
    await press(page);
    expect(invalid(field('plate'))).toBeNull();
  });

  it('follows a control swapped under the same input', async () => {
    const { component, field, page } = await render(Swap);
    await press(page);
    expect(invalid(field('a'))).toBe('true');

    component.current.set(component.second);
    await settle();
    expect(invalid(field('a'))).toBeNull();

    component.current.set(component.first);
    await settle();
    expect(invalid(field('a'))).toBe('true');
  });

  it('sets nothing on an input with ngModel outside any save', async () => {
    const { field, page } = await render(Swap);
    await press(page);

    expect(invalid(field('free'))).toBeNull();
  });

  it('does not announce a fresh input on a control a destroyed form had revealed', async () => {
    const first = await render(Pressed);
    await press(first.page);
    expect(fieldRevealed(shared)).toBe(true);
    first.fixture.destroy();
    const second = await render(Gone);

    expect(invalid(second.field('gone'))).toBeNull();
    expect(fieldRevealed(shared)).toBe(false);
  });
});

// @traces 495-FR-003
describe('kit input aria-invalid input and host attributes', () => {
  it('writes nothing for boolean false and removes the attribute when it turns false again', async () => {
    const { component, field } = await render(Own);
    expect(invalid(field('bool'))).toBeNull();
    component.b.set(true);
    await settle();
    expect(invalid(field('bool'))).toBe('true');
    component.b.set(false);
    await settle();
    expect(invalid(field('bool'))).toBeNull();
  });

  it('writes a string value through as given', async () => {
    const { component, field } = await render(Own);
    expect(invalid(field('str'))).toBe('spelling');
    component.s.set('true');
    await settle();
    expect(invalid(field('str'))).toBe('true');
  });

  it('keeps a static aria-invalid false and does not add one for attr null', async () => {
    const { field } = await render(Own);

    expect(invalid(field('falseAttr'))).toBe('false');
    expect(invalid(field('attrNull'))).toBeNull();
    expect(invalid(field('plain'))).toBeNull();
  });

  it('takes the id input, and a unicode id', async () => {
    const { page } = await render(Own);

    expect(page.querySelector('#given-id')).not.toBeNull();
    expect(page.querySelector('[id="ünï-ключ"]')).not.toBeNull();
  });

  it('keeps data attributes of an input with no control absent', async () => {
    const { field } = await render(Own);
    const plain = field('plain');

    expect(plain.getAttribute('data-invalid')).toBeNull();
    expect(plain.getAttribute('data-touched')).toBeNull();
    expect(plain.getAttribute('data-dirty')).toBeNull();
    expect(plain.getAttribute('data-matches-spartan-invalid')).toBeNull();
  });
});
