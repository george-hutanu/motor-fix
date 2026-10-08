// Personal values a log line, span or error message may carry: e-mails,
// Romanian phone numbers (+40, 0040 or 0, with spaces, dots or dashes) and
// Romanian plates. Each becomes `***` before anything leaves the process.
// The e-mail pattern starts only where a local part starts (the
// lookbehind), so a long run with no domain is read once, not once per
// character.
const PATTERNS = [
  /(?<![\p{L}\p{N}_.+-])[\p{L}\p{N}_.+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/gu,
  /(?<![\w+])(?:\+40|0040|0)[\s.-]?[237](?:[\s.-]?\d){8}(?!\d)/g,
  /\b[A-Z]{1,2}[\s-]?\d{2,3}[\s-]?[A-Z]{3}\b/gi,
];

export function scrub(text: string): string {
  return PATTERNS.reduce(
    (masked, pattern) => masked.replace(pattern, '***'),
    text,
  );
}

// `mask` replaces `scrub` for every string, for a caller that masks more.
export function scrubDeep<T>(value: T, mask = scrub): T {
  return deep(value, new WeakSet(), mask) as T;
}

// Plain objects and arrays are copied with their strings masked; any other
// object (a Date, a Buffer) is kept as it is, and a cycle ends in a marker.
function deep(
  value: unknown,
  seen: WeakSet<object>,
  mask: (text: string) => string,
): unknown {
  if (typeof value === 'string') return mask(value);
  if (value === null || typeof value !== 'object') return value;
  const plain = Array.isArray(value) || isPlainObject(value);
  if (!plain) return value;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  const copy = Array.isArray(value)
    ? value.map((inner) => deep(inner, seen, mask))
    : Object.fromEntries(
        Object.entries(value).map(([key, inner]) => [
          key,
          deep(inner, seen, mask),
        ]),
      );
  seen.delete(value);
  return copy;
}

function isPlainObject(value: object): boolean {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
