import type { AbstractControl, ValidationErrors } from '@angular/forms';
import {
  type VisibleTextRule,
  visibleLength,
  visibleTextProblem,
} from '@motor-fix/contracts/visible-text';

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

// The rule the API judges a text with that one person writes for another:
// a control character fails as a format, and only what shows counts.
export const visibleText =
  (rule: VisibleTextRule) =>
  (control: AbstractControl): ValidationErrors | null => {
    const value = String(control.value ?? '');
    const problem = visibleTextProblem(value, rule);
    const actualLength = visibleLength(value);
    switch (problem) {
      case 'control':
        return { pattern: true };
      case 'required':
        return { required: true };
      case 'min':
        return { minlength: { actualLength, requiredLength: rule.min } };
      case 'max':
        return { maxlength: { actualLength, requiredLength: rule.max } };
      default:
        return null;
    }
  };
