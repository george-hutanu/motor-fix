import { signal, type WritableSignal } from '@angular/core';
import type { AbstractControl } from '@angular/forms';

// Whether a save has revealed a control: its press found the field invalid,
// or the server named it. A field announces itself invalid only once
// revealed, so the kit's input reads it here, by control, as a signal.
const revealed = new WeakMap<AbstractControl, WritableSignal<boolean>>();

function flag(control: AbstractControl) {
  let found = revealed.get(control);
  if (!found) {
    found = signal(false);
    revealed.set(control, found);
  }
  return found;
}

export function fieldRevealed(control: AbstractControl): boolean {
  return flag(control)();
}

export function setRevealed(control: AbstractControl, on: boolean) {
  flag(control).set(on);
}
