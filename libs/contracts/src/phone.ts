export const E164 = /^\+[1-9]\d{6,14}$/;

// A number as people write it in Romania: spaces, dots, dashes and brackets
// dropped, 00 read as +, and a leading 0 as the Romanian +40. Null when the
// result is not a possible E.164 number.
export function normalisePhone(input: string): string | null {
  const bare = input.replace(/[\s.()-]/g, '');
  const international = bare.startsWith('00')
    ? `+${bare.slice(2)}`
    : bare.startsWith('0')
      ? `+40${bare.slice(1)}`
      : bare;
  return E164.test(international) ? international : null;
}
