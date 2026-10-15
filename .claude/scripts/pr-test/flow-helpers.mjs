// The helpers a QA flows file is handed, by the run (run.mjs flowArgs) and by
// `precheck.mjs --check` alike: the waits a flow most often gets wrong, done
// once. They take Playwright's own page and locators and import nothing from
// it: Playwright comes from the checkout under test (sweep.mjs).
import { SEEDED } from "./endpoints.mjs";

const WAIT_MS = 10000;

/** Resolves once `text` is visible; rejects naming the text and the wait. */
export async function waitForText(page, text, ms = WAIT_MS) {
  try {
    await page.getByText(text).first().waitFor({ state: "visible", timeout: ms });
  } catch {
    throw new Error(`"${text}" not visible within ${ms} ms`);
  }
}

/**
 * The content of an open sheet: the app's own overlay panel (@motor-fix/overlays, which carries the kit's class
 * and none of its data attributes) or a kit sheet that is not closing.
 */
export const SHEET_CONTENT = '.spartan-sheet-content:not([data-state="closed"]) > *';

/**
 * Clicks `trigger` (a locator or a selector) and resolves once the open sheet shows content. The sheet's own
 * box is a fixed overlay that can measure empty while it animates in, so only its content is waited for.
 */
export async function openSheet(page, trigger, ms = WAIT_MS) {
  const button = typeof trigger === "string" ? page.locator(trigger) : trigger;
  await button.click();
  try {
    await page.locator(SHEET_CONTENT).first().waitFor({ state: "visible", timeout: ms });
  } catch {
    throw new Error(`the sheet opened by ${typeof trigger === "string" ? trigger : "the trigger"} showed no content within ${ms} ms`);
  }
}

/** The button of the step labelled `label` that shows at this viewport: the phone and desktop step lists both render one. */
export const stepButton = (page, label) => page.getByRole("button", { name: label }).locator("visible=true").first();

/** The seeded accounts by role, the ones signIn and the API calls use. */
export const accounts = SEEDED;
