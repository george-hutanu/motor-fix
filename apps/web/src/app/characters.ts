import type { AbstractControl, ValidationErrors } from '@angular/forms';

// Between min and max characters, counted in code points as the server counts
// them, so an emoji is one; `trim` checks the value as it will be stored. The
// messages are the shared ones for these validators.
export const characters =
  (min: number, max: number, trim = false) =>
  (control: AbstractControl): ValidationErrors | null => {
    const value = String(control.value ?? '');
    const length = [...(trim ? value.trim() : value)].length;
    if (length === 0) return { required: true };
    if (length < min)
      return { minlength: { actualLength: length, requiredLength: min } };
    if (length > max)
      return { maxlength: { actualLength: length, requiredLength: max } };
    return null;
  };
