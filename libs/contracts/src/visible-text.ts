import {
  JOB_NAME_MAX,
  PROPOSED_JOB_NAME_MIN,
  REJECTION_REASON_MAX,
  REJECTION_REASON_MIN,
} from './price-range';

// Text one person types for another to read. It holds no control character
// (NUL, a bell, a C1 code), save the line breaks and tabs of a text that may
// run over lines, and only what shows counts toward its length: trimmed,
// format characters such as a zero-width space left out, an emoji one.
// The API's body rules and the dialogs both judge with it.
export interface VisibleTextRule {
  min: number;
  max: number;
  lines?: boolean;
}

export const CATALOGUE_JOB_NAME: VisibleTextRule = {
  max: JOB_NAME_MAX,
  min: PROPOSED_JOB_NAME_MIN,
};

export const REJECTION_REASON: VisibleTextRule = {
  lines: true,
  max: REJECTION_REASON_MAX,
  min: REJECTION_REASON_MIN,
};

const CONTROL = /\p{Cc}/u;
const CONTROL_BUT_LINES = /[^\P{Cc}\t\n\r]/u;
const FORMAT = /\p{Cf}/gu;

export const visibleLength = (value: string): number =>
  [...value.trim().replace(FORMAT, '')].length;

export type VisibleTextProblem = 'control' | 'required' | 'min' | 'max';

export function visibleTextProblem(
  value: string,
  rule: VisibleTextRule,
): VisibleTextProblem | null {
  if ((rule.lines ? CONTROL_BUT_LINES : CONTROL).test(value)) return 'control';
  const length = visibleLength(value);
  if (length === 0) return 'required';
  if (length < rule.min) return 'min';
  return length > rule.max ? 'max' : null;
}
