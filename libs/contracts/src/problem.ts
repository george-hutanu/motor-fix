// An error as the API sends it: RFC 9457 problem details with a stable,
// lower snake case `code` the front end translates.
export interface Problem {
  code: string;
  status: number;
  detail?: string;
  // Errors that belong to one field; `field` is the form control's name.
  errors?: FieldProblem[];
  // A wrong sign-in code (`code_invalid`): the tries the code has left.
  attemptsLeft?: number;
  // A refusal that lifts with time: the seconds until it does, also sent as
  // the Retry-After header.
  retryAfterSeconds?: number;
  title?: string;
  type?: string;
}

export interface FieldProblem {
  code: string;
  field: string;
}

// A list of field errors, or undefined when any entry is not one: half a list
// would hide the rest of what the person has to fix.
export function fieldProblems(value: unknown): FieldProblem[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const list: FieldProblem[] = [];
  for (const entry of value) {
    if (
      typeof entry !== 'object' ||
      entry === null ||
      typeof entry.code !== 'string' ||
      typeof entry.field !== 'string'
    )
      return undefined;
    list.push({ code: entry.code, field: entry.field });
  }
  return list;
}

const CODE_BY_STATUS: Record<number, string> = {
  400: 'validation_failed',
  404: 'not_found',
  409: 'conflict',
  503: 'service_unavailable',
};

// The code of an error that carries none of its own.
export function codeForStatus(status: number): string {
  if (Object.hasOwn(CODE_BY_STATUS, status)) return CODE_BY_STATUS[status];
  return status >= 500 && status < 600 ? 'internal_error' : 'error';
}
