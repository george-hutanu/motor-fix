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

// A tapped step whose heading the page cannot bring up to the line (the short
// sections at its end) stays current while that heading is on screen; once
// the scroll reaches it or a later step, or takes it off screen, it follows.
// The scroll position a jump to a heading ends at: the heading at the top,
// short of its scroll margin, within the range the page can scroll.
export function jumpTarget(
  top: number,
  margin: number,
  scrollY: number,
  scrollHeight: number,
  innerHeight: number,
): number {
  const end = Math.max(0, scrollHeight - innerHeight);
  return Math.min(end, Math.max(0, scrollY + top - margin));
}

export function keepsTapped(
  spied: number,
  tapped: number,
  top: number,
  bottom: number,
): boolean {
  return spied < tapped && top < bottom;
}
