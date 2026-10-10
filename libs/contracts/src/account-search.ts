// The admin's account search and filters, free of decorators for the web app.

export const ACCOUNT_ROLES = [
  'driver',
  'garage',
  'receptionist',
  'mechanic',
  'admin',
] as const;
export type AccountRole = (typeof ACCOUNT_ROLES)[number];

// `watch` is an open watch; until watches exist none matches.
export const ACCOUNT_STATES = ['active', 'watch', 'suspended'] as const;
export type AccountState = (typeof ACCOUNT_STATES)[number];

export const SEARCH_MIN = 2;
export const SEARCH_MAX = 80;

// The text as it is matched: composed (a base letter and a combining mark
// read as the one letter), trimmed, inner whitespace collapsed to one space.
export const settleSearch = (text: string) =>
  text.normalize('NFC').trim().replace(/\s+/g, ' ');

// The roles named in a list, comma-separated or repeated, each once and in
// the fixed order; the unknown ones apart.
export function readRoles(values: readonly string[]) {
  const named = values.flatMap((v) => v.split(',')).filter((v) => v !== '');
  return {
    roles: ACCOUNT_ROLES.filter((role) => named.includes(role)),
    unknown: named.filter(
      (v) => !(ACCOUNT_ROLES as readonly string[]).includes(v),
    ),
  };
}

export const isAccountState = (value: string): value is AccountState =>
  (ACCOUNT_STATES as readonly string[]).includes(value);
