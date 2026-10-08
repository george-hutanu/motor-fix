// A figure read from a store's text: a count, size or age, so anything that
// is not a finite number of zero or more reads as 0.
export function figure(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}
