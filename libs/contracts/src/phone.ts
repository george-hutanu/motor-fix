export const E164 = /^\+[1-9]\d{6,14}$/;

// A number as people write it in Romania: spaces, dots, dashes and brackets
// dropped, 00 read as +, and a leading 0 as the Romanian +40, also after a
// +40 already typed (no Romanian number has a 0 there). No length check, so a
// part of a number ("0722") is rewritten too, for the admin's search.
export function rewritePhone(input: string): string {
  const bare = input.replace(/[\s.()-]/g, '').replace(/^\+400(?=[1-9])/, '0');
  return bare.startsWith('00')
    ? `+${bare.slice(2)}`
    : bare.startsWith('0')
      ? `+40${bare.slice(1)}`
      : bare;
}

// The rewritten number, or null when it is not a possible E.164 number.
export function normalisePhone(input: string): string | null {
  const international = rewritePhone(input);
  return E164.test(international) ? international : null;
}
