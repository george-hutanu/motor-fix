type Step = {
  n: number;
  label: string;
  mark: 'public.listing.optional' | 'public.listing.required' | null;
};

export const STEPS: readonly Step[] = [1, 2, 3, 4, 5, 6].map((n) => ({
  label: `public.listing.step${n}`,
  mark:
    n === 4
      ? 'public.listing.optional'
      : n === 6
        ? 'public.listing.required'
        : null,
  n,
}));

// The last step whose heading has reached the line; the end of the page
// belongs to the last step, whose short section may never reach it.
export function currentStep(
  tops: readonly number[],
  line: number,
  atEnd: boolean,
): number {
  if (atEnd) return STEPS.length;
  let step = 1;
  tops.forEach((top, i) => {
    if (top <= line) step = i + 1;
  });
  return step;
}
