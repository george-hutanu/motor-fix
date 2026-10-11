// The name a screen reader reads: the text, without what is hidden from it.
export const spoken = (el: Element | null | undefined) => {
  const copy = el?.cloneNode(true) as Element | undefined;
  for (const hidden of copy?.querySelectorAll('[aria-hidden="true"]') ?? []) {
    hidden.remove();
  }
  return copy?.textContent?.replace(/\s+/g, ' ').trim();
};
