// The viewport sweep: every route at desktop, tablet and phone sizes, light
// and dark, Romanian and English, with one browser and one page at a time.
// Records console errors, uncaught errors, failed requests and error
// responses, axe violations and horizontal overflow, and a screenshot of each
// combination. Playwright and axe-core come from this checkout, not the PR's,
// so a PR from before either existed can still be swept.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { mergeFindings, sweepFinding } from "./findings.mjs";

export const VIEWPORTS = {
  desktop: { width: 1440, height: 900, isMobile: false, hasTouch: false, deviceScaleFactor: 1 },
  tablet: { width: 834, height: 1194, isMobile: false, hasTouch: true, deviceScaleFactor: 2 },
  mobile: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 3 },
};
const LOCALES = { ro: "ro-RO", en: "en-GB" };

const slug = (route) => route.replace(/^\/+|\/+$/g, "").replace(/[^a-z0-9]+/gi, "-") || "home";

export function matrix({ routes, schemes = ["light", "dark"], langs = ["ro", "en"] }) {
  return routes.flatMap((route) =>
    Object.keys(VIEWPORTS).flatMap((viewport) =>
      schemes.flatMap((scheme) =>
        langs.map((lang) => ({ route, viewport, scheme, lang, shot: `${slug(route)}-${viewport}-${scheme}-${lang}.png` })),
      ),
    ),
  );
}

const keyOf = (o) => `${o.kind}|${o.route}|${o.rule ?? o.text ?? ""}|${o.kind === "http" ? `${o.url}|${o.status}` : (o.url ?? "")}`;

/** Observations to findings, one per problem, listing every combination it was seen in. */
export function toFindings(observations, { web, origins }) {
  const own = new Set(origins);
  const tagged = observations.map((o) => {
    let offOrigin = false;
    if (o.url) {
      try {
        offOrigin = !own.has(new URL(o.url).origin);
      } catch {
        offOrigin = false;
      }
    }
    const size = VIEWPORTS[o.viewport] ? `${VIEWPORTS[o.viewport].width}×${VIEWPORTS[o.viewport].height}` : undefined;
    return { ...sweepFinding({ ...o, offOrigin, size }, { web }), key: keyOf(o), seenIn: [`${o.viewport} ${o.scheme} ${o.lang}`] };
  });
  const merged = mergeFindings(tagged);
  for (const f of merged) f.seenIn = tagged.filter((t) => t.key === f.key).flatMap((t) => t.seenIn);
  return merged.map(({ key, ...f }) => f);
}

/** Drive the running web app through the matrix; returns observations and screenshot paths. */
export async function runSweep({ baseURL, routes, outDir, schemes, langs, langKey = "mf.lang", repoRoot }) {
  const require = createRequire(join(repoRoot, "package.json"));
  const { chromium } = require("@playwright/test");
  const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
  const observations = [];
  const screenshots = [];
  const browser = await chromium.launch();
  try {
    for (const run of matrix({ routes, schemes, langs })) {
      const vp = VIEWPORTS[run.viewport];
      const context = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        isMobile: vp.isMobile,
        hasTouch: vp.hasTouch,
        deviceScaleFactor: vp.deviceScaleFactor,
        colorScheme: run.scheme,
        locale: LOCALES[run.lang],
      });
      await context.addInitScript(
        ([key, value]) => {
          try {
            localStorage.setItem(key, value);
          } catch {}
        },
        [langKey, run.lang],
      );
      const page = await context.newPage();
      const screenshot = join(outDir, run.shot);
      const seen = (o) => observations.push({ ...run, screenshot, ...o });
      page.on("console", (m) => m.type() === "error" && seen({ kind: "console", text: m.text().slice(0, 300) }));
      page.on("pageerror", (e) => seen({ kind: "pageerror", text: String(e.message).slice(0, 300) }));
      page.on("requestfailed", (r) => {
        const text = r.failure()?.errorText ?? "failed";
        if (!/ERR_ABORTED/.test(text)) seen({ kind: "request-failed", url: r.url(), text });
      });
      page.on("response", (r) => r.status() >= 400 && seen({ kind: "http", url: r.url(), status: r.status() }));
      try {
        const res = await page.goto(new URL(run.route, baseURL).href, { waitUntil: "networkidle", timeout: 30000 });
        if (!res || res.status() >= 400) seen({ kind: "load", text: `HTTP ${res?.status() ?? "no response"}` });
        await page.waitForTimeout(300);
        await page.evaluate(axeSource);
        const axe = await page.evaluate(() => globalThis.axe.run(document, { resultTypes: ["violations"] }));
        for (const v of axe.violations)
          seen({ kind: "axe", impact: v.impact ?? "minor", rule: v.id, help: v.help, nodes: v.nodes.length, target: v.nodes[0]?.target?.join(" ") });
        const box = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, width: window.innerWidth }));
        if (box.scrollWidth > box.width + 1) seen({ kind: "overflow", ...box });
        await page.screenshot({ path: screenshot, fullPage: true });
        screenshots.push(screenshot);
      } catch (error) {
        seen({ kind: "load", text: String(error.message).split("\n")[0].slice(0, 300) });
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
  return { observations, screenshots };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (n, d) => {
    const i = process.argv.indexOf(`--${n}`);
    return i === -1 ? d : process.argv[i + 1];
  };
  const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
  const baseURL = arg("base");
  const result = await runSweep({ baseURL, routes: arg("routes", "/").split(","), outDir: arg("out", "."), repoRoot });
  const findings = toFindings(result.observations, { web: process.argv.includes("--web"), origins: [new URL(baseURL).origin] });
  console.log(JSON.stringify({ findings, screenshots: result.screenshots }, null, 2));
}
