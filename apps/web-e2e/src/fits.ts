import type { Page } from '@playwright/test';

// What a phone-width screen shows wrong: the page wider than the window, the
// visible texts cut by their box, and those set under 12 px.
export const fits = (page: Page) =>
  page.evaluate(() => {
    const texts = [...document.body.querySelectorAll('*:not(script, style)')]
      .filter(
        (el) =>
          el.getClientRects().length > 0 &&
          getComputedStyle(el).visibility !== 'hidden' &&
          // Text kept for screen readers only, clipped to 1 px, is never seen.
          !(function readOnly(node: Element | null): boolean {
            if (!node) return false;
            const box = node.getBoundingClientRect();
            return (
              (box.width <= 1 &&
                box.height <= 1 &&
                getComputedStyle(node).overflow === 'hidden') ||
              readOnly(node.parentElement)
            );
          })(el) &&
          [...el.childNodes].some(
            (n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim(),
          ),
      )
      .map((el) => ({
        cut:
          getComputedStyle(el).display !== 'inline' &&
          el.getBoundingClientRect().width > 1 &&
          el.scrollWidth > el.clientWidth + 1,
        label: `${el.tagName} "${el.textContent?.trim()}"`,
        size: Number.parseFloat(getComputedStyle(el).fontSize),
      }));
    return {
      cut: texts.filter((t) => t.cut).map((t) => t.label),
      small: texts.filter((t) => t.size < 12).map((t) => t.label),
      width: document.documentElement.scrollWidth,
    };
  });
