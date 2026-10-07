// Personal values a log line, span or error message may carry: e-mails,
// Romanian phone numbers (+40, 0040 or 0, with spaces, dots or dashes) and
// Romanian plates. Each becomes `***` before anything leaves the process.
const PATTERNS = [
  /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g,
  /(?<![\w+])(?:\+40|0040|0)[\s.-]?[237](?:[\s.-]?\d){8}(?!\d)/g,
  /\b[A-Z]{1,2}[\s-]?\d{2,3}[\s-]?[A-Z]{3}\b/gi,
];

export function scrub(text: string): string {
  return PATTERNS.reduce(
    (masked, pattern) => masked.replace(pattern, '***'),
    text,
  );
}

export function scrubDeep<T>(value: T): T {
  if (typeof value === 'string') return scrub(value) as T;
  if (Array.isArray(value)) return value.map(scrubDeep) as T;
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, inner]) => [key, scrubDeep(inner)]),
    ) as T;
  }
  return value;
}
