import { HttpErrorResponse } from '@angular/common/http';
import { Component, effect } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormControl, FormGroup, Validators } from '@angular/forms';

import { setRevealed } from './reveal';
import { fieldRevealed, taskSave } from '../index';

let answer: () => Promise<string>;

@Component({ template: '' })
class Sample {
  readonly form = new FormGroup({
    name: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    plate: new FormControl('', { nonNullable: true }),
  });
  readonly save = taskSave({
    form: this.form,
    send: () => answer(),
  });
}

async function settle() {
  for (let i = 0; i < 3; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

function sample() {
  const fixture = TestBed.createComponent(Sample);
  fixture.detectChanges();
  return fixture.componentInstance;
}

beforeEach(() => {
  answer = () => Promise.resolve('saved');
});

// @traces 495-FR-001
describe('the reveal rule, per control', () => {
  it('reads not revealed for a control no save has pressed', () => {
    expect(fieldRevealed(new FormControl(''))).toBe(false);
  });

  it('wakes whoever reads it when it changes', () => {
    const control = new FormControl('');
    const seen: boolean[] = [];
    TestBed.runInInjectionContext(() =>
      effect(() => {
        seen.push(fieldRevealed(control));
      }),
    );
    TestBed.tick();
    setRevealed(control, true);
    TestBed.tick();
    setRevealed(control, false);
    TestBed.tick();

    expect(seen).toEqual([false, true, false]);
  });

  it('marks each invalid field on an invalid press, and only those', async () => {
    const task = sample();
    task.save.submit();
    await settle();

    expect(fieldRevealed(task.form.controls.name)).toBe(true);
    expect(fieldRevealed(task.form.controls.plate)).toBe(false);
  });

  it('marks the field a server error names', async () => {
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
    const task = sample();
    task.form.controls.name.setValue('Ana');
    task.save.submit();
    await settle();

    expect(fieldRevealed(task.form.controls.plate)).toBe(true);
    expect(fieldRevealed(task.form.controls.name)).toBe(false);
  });

  it('clears what was revealed once a save succeeds', async () => {
    const task = sample();
    task.save.submit();
    await settle();
    task.form.controls.name.setValue('Ana');
    task.save.submit();
    await settle();

    expect(task.save.state()).toBe('done');
    expect(fieldRevealed(task.form.controls.name)).toBe(false);
  });
});
