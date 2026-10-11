import { signal } from '@angular/core';
import type { FieldProblem } from '@motor-fix/contracts';
import {
  type ListingCheck,
  type ListingStep,
  stepOf,
} from '@motor-fix/contracts/listing-check';

import { textKey } from './listing-check-texts';

// What a field shows under it: the text's key, and whether it only tells.
export interface FieldMessage {
  key: string;
  warning: boolean;
}

export const NO_PROBLEMS: ListingCheck = { errors: [], warnings: [] };

// The problems one step shows.
export function forStep(check: ListingCheck, step: ListingStep): ListingCheck {
  const mine = (problem: FieldProblem) => stepOf(problem.field) === step;
  return {
    errors: check.errors.filter(mine),
    warnings: check.warnings.filter(mine),
  };
}

interface Showing {
  // The field holds a value: a restored wrong value shows before it is left.
  filled: boolean;
  // Sending was asked for: every field shows its error.
  all: boolean;
  // A mobile mechanic, whose place reads as the registered seat.
  mobile?: boolean;
}

// Which of a step's fields show their error: once
// left, at once when the value was there before the owner typed in it, and
// all of them when sending is asked for. After it shows, the text follows
// the value. A warning tells whatever the field's state.
export class FieldWatch {
  private readonly left = signal<ReadonlySet<string>>(new Set());
  private readonly typing = signal<ReadonlySet<string>>(new Set());

  type(field: string) {
    if (this.left().has(field) || this.typing().has(field)) return;
    this.typing.update((typing) => new Set([...typing, field]));
  }

  leave(field: string) {
    if (this.left().has(field)) return;
    this.left.update((left) => new Set([...left, field]));
  }

  shows(field: string, { all, filled }: Showing): boolean {
    return (
      all || this.left().has(field) || (filled && !this.typing().has(field))
    );
  }

  message(
    check: ListingCheck,
    field: string,
    showing: Showing,
  ): FieldMessage | null {
    const error = check.errors.find((problem) => problem.field === field);
    if (error)
      return this.shows(field, showing)
        ? { key: textKey(error, showing.mobile), warning: false }
        : null;
    const warning = check.warnings.find((problem) => problem.field === field);
    return warning
      ? { key: textKey(warning, showing.mobile), warning: true }
      : null;
  }
}
