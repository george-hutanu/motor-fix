import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormArray, FormControl, FormGroup, Validators } from '@angular/forms';

import { fieldRevealed, taskSave } from '../index';

@Component({ template: '' })
class Sample {
  readonly form = new FormGroup({
    list: new FormArray([new FormControl('', Validators.required)]),
    name: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required],
    }),
  });
  readonly other = new FormGroup({ name: new FormControl('') });
  readonly save = taskSave({
    form: this.form,
    send: () => Promise.resolve('ok'),
  });
}

function sample() {
  const fixture = TestBed.createComponent(Sample);
  fixture.detectChanges();
  return fixture.componentInstance;
}

async function settle() {
  for (let i = 0; i < 3; i++) {
    TestBed.tick();
    await new Promise((resolve) => setTimeout(resolve));
  }
}

// @traces 495-FR-001
describe('fieldRevealed on unusual controls', () => {
  it('is false for a control no save has seen', () => {
    expect(fieldRevealed(new FormControl(''))).toBe(false);
    expect(fieldRevealed(new FormGroup({}))).toBe(false);
  });

  it('is false for a disabled invalid control after the press', async () => {
    const c = sample();
    c.form.controls.name.disable();
    c.save.submit();
    await settle();

    expect(fieldRevealed(c.form.controls.name)).toBe(false);
  });

  it('reveals invalid leaves inside an array after the press and not the group itself', async () => {
    const c = sample();
    c.save.submit();
    await settle();

    expect(fieldRevealed(c.form.controls.list.at(0))).toBe(true);
    expect(fieldRevealed(c.form.controls.name)).toBe(true);
    expect(fieldRevealed(c.other.controls.name)).toBe(false);
  });

  it('keeps the control revealed when read twice, and clears on success', async () => {
    const c = sample();
    c.save.submit();
    await settle();
    expect(fieldRevealed(c.form.controls.name)).toBe(true);
    expect(fieldRevealed(c.form.controls.name)).toBe(true);

    c.form.setValue({ list: ['a'], name: 'Ana' });
    c.save.submit();
    await settle();
    expect(c.save.state()).toBe('done');
    expect(fieldRevealed(c.form.controls.name)).toBe(false);
    expect(fieldRevealed(c.form.controls.list.at(0))).toBe(false);
  });
});
