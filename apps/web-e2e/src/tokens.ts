import type { Page } from '@playwright/test';

// The value of one of the theme's custom properties, as the page computes it
// in the scheme it is showing now.
export const token = (page: Page, name: string) =>
  page.evaluate(
    (n) =>
      getComputedStyle(document.documentElement).getPropertyValue(n).trim(),
    name,
  );

// A six-digit hex colour as the browser reports it in computed styles.
export const rgb = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) =>
    Number.parseInt(hex.slice(i, i + 2), 16),
  );
  return `rgb(${r}, ${g}, ${b})`;
};
