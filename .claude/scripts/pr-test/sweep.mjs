// The viewport sweep: every route at desktop, tablet and two phone sizes, light
// and dark, Romanian and English, with one browser and one page at a time.
// Records console errors, uncaught errors, failed requests and error
// responses, axe violations, horizontal overflow and the measured layout
// checks (layout.mjs), and a screenshot of each combination. Playwright and axe-core come from this checkout, not the PR's,
// so a PR from before either existed can still be swept.
//
// A route is `path[?query][@role][:status]`: `/de:404` must answer 404, and
// that 404 is no finding; `/app/driver@driver` is opened with a real session
// of the seeded driver, signed in afresh for each browser context and set to
// the language under test; `/:lang/garages?brand=dacia` opens with its query. A
// leading `/:lang` segment, and only there, becomes `/ro` or `/en` per
// language (the public frame mounts under `:lang`). routeProblem refuses, before
// any run, what the PR QA workflow's own check refuses, any other `:`, and a
// route under /app/ with no role (it would sweep the sign-in screen). Given the
// checkout's router (routerTable: the `path:` literals of app.routes.ts and
// dashboard/views.ts), it also refuses a route the router does not serve, and a
// public page written without its `/:lang` prefix; a route that expects an
// error status (`:404`) is meant to miss and is not looked up.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { SEEDED } from "./endpoints.mjs";
import { coverageKey, layoutKey, mergeFindings, sweepFinding } from "./findings.mjs";
import { measureLayout } from "./layout.mjs";
import { isEntryPoint } from "../lib/entry.mjs";

export const VIEWPORTS = {
  desktop: { width: 1440, height: 900, isMobile: false, hasTouch: false, deviceScaleFactor: 1 },
  tablet: { width: 834, height: 1194, isMobile: false, hasTouch: true, deviceScaleFactor: 2 },
  mobile: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 3 },
  // The narrowest phone the specs promise no horizontal scrolling at.
  "small-phone": { width: 320, height: 568, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
};
// Every shot is of the whole page, its transitions and animations run to their end first: a dial's
// needle caught halfway is a pixel change the PR never made.
export const SHOT_OPTIONS = { animations: "disabled", fullPage: true };
// Chromium's own headless mode, not the headless shell, which leaves a WebGL map blank under a sticky bar that
// reaches past the viewport (the results map at 390 x 844 with the consent bar asking) where a browser draws it whole.
export const LAUNCH_OPTIONS = { channel: "chromium" };
// A machine with only the shell installed (a --local run on a laptop) still sweeps, and says which browser it used.
export async function launchBrowser(chromium, log = console.warn) {
  try {
    return await chromium.launch(LAUNCH_OPTIONS);
  } catch (error) {
    if (!/Executable doesn't exist/.test(String(error?.message))) throw error;
    log("sweep: Chromium is not installed, so the headless shell runs instead; a WebGL map may show blank under a sticky bar");
    return chromium.launch();
  }
}
// What a page marks as moving with today's date (a 12-month chart): painted one flat colour in the shot, so the visual diff never reads it as a change.
export const VOLATILE = "[data-qa-volatile]";
export const shotOptions = (page, path) => ({ ...SHOT_OPTIONS, path, mask: [page.locator(VOLATILE)], maskColor: "#808080" });
const LOCALES = { ro: "ro-RO", en: "en-GB" };
// Where the language switch keeps the chosen language (libs/i18n/src/switch.ts).
const LANG_KEY = "mf.lang";
// The role this browser last saw signed in (the web app's Session, `mf-role`).
const ROLE_KEY = "mf-role";
// Home shows one of five copy voices, shuffled per load (apps/web/src/index.html); the sweep pins the first,
// as an admin's pin would, so a shot never differs from the baseline's by the voice the shuffle drew.
const VOICES_KEY = "mf-copy-voices";
const PINNED_VOICES = JSON.stringify({ enabled: [1, 2, 3, 4, 5], pinned: 1 });

// A path of letters, digits, '-' and '/' slugs as itself; anything else (a query, `/:lang`, an escape) or a
// long one also gets a short hash of the whole, so two routes that differ only there never share a file.
const SLUG_MAX = 80;
const slug = (route) => {
  const plain = route.replace(/^\/+|\/+$/g, "").replace(/[^a-z0-9]+/gi, "-") || "home";
  if (/^[a-z0-9/-]*$/i.test(route) && plain.length <= SLUG_MAX) return plain;
  return `${plain.slice(0, SLUG_MAX)}-${createHash("sha256").update(route).digest("hex").slice(0, 8)}`;
};

/**
 * The characters the PR QA workflow lets through its routes input, the same
 * text as its bash `[[ =~ ]]` (`&` escaped there, where a bare one is a syntax
 * error); pr-qa-workflow.spec.mjs holds the two equal.
 */
export const ROUTE_PATTERN = new RegExp("^/[A-Za-z0-9/_.,@:?=\\&%-]*$");
const LANG = /^\/:lang(?=$|[/?@:])/;
const SHAPE = /^([^@:]*)(?:@([a-z]+))?(?::(\d{3}))?$/;

export function parseRoute(spec) {
  const lang = LANG.test(spec);
  const rest = lang ? spec.replace(LANG, "") : spec;
  const [, path, role, status] = SHAPE.exec(rest) ?? [null, rest];
  return { path: (lang ? "/:lang" : "") + path || "/", role: role ?? null, expect: status ? Number(status) : null, lang };
}

/**
 * The routes the web app serves, read from the checkout's source without
 * booting Angular: each a list of segments, `:x` matching any one segment
 * (`:lang` only the literal `/:lang` the sweep fills in), a trailing `**` any
 * rest. app.routes.ts gives the top level and the language node's children
 * (keys are sorted, so a parent's `children` come before its `path`);
 * dashboard/views.ts gives `/app/<area>/<view>` for every released view, which
 * owns its sub-paths. Null when the checkout has no app.routes.ts.
 */
export function routerTable(root) {
  const app = join(root, "apps", "web", "src", "app");
  if (!existsSync(join(app, "app.routes.ts"))) return null;
  const text = readFileSync(join(app, "app.routes.ts"), "utf8").replace(/^\s*\/\/.*$/gm, "");
  const lists = {};
  const token = /\(\[([^\]]*)\] as const\)\.map\(\((\w+)\)|path:\s*(?:'([^']*)'|`([^`]*)`|(\w+))|placeholder\('([^']*)'|matcher:|\[|\]/g;
  const patterns = [];
  const children = [];
  let depth = 0;
  for (const m of text.matchAll(token)) {
    if (m[2]) lists[m[2]] = [...m[1].matchAll(/'([^']*)'/g)].map((x) => x[1]);
    else if (m[0] === "[") depth++;
    else if (m[0] === "]") depth--;
    else {
      const raw = m[3] ?? m[6] ?? (m[0] === "matcher:" ? "" : null);
      const paths = raw !== null ? [raw] : m[4] !== undefined ? expand(m[4], lists) : lists[m[5]] ?? [];
      if (depth === 2) children.push(...paths);
      else if (depth === 1)
        for (const top of paths) {
          if (top === "**") continue;
          const kids = children.splice(0);
          for (const kid of kids.length ? kids : [""]) patterns.push(segments(`${top}/${kid}`));
        }
    }
  }
  const views = join(app, "dashboard", "views.ts");
  if (existsSync(views)) {
    const dashboards = readFileSync(views, "utf8").split(/^export const DASHBOARDS\b/m)[1]?.split(/^};/m)[0] ?? "";
    for (const [, area, body] of dashboards.matchAll(/^ {2}(\w+): \{([\s\S]*?)(?=^ {2}\w+: \{|$(?![\s\S]))/gm)) {
      const released = [];
      for (const v of (body.split(/\bviews: \[/)[1] ?? "").matchAll(/path: '([^']*)'|garageView\('([^']*)'|unreleased: true/g)) {
        if (v[0] === "unreleased: true") released.pop();
        else released.push(v[1] ?? v[2]);
      }
      for (const view of released) if (view) patterns.push(["app", area, view, "**"]);
    }
  }
  return patterns;
}

const segments = (path) => path.split("/").filter(Boolean);
const expand = (template, lists) => {
  const name = template.match(/\$\{(\w+)\}/)?.[1];
  return name ? (lists[name] ?? []).map((value) => template.replace(`\${${name}}`, value)) : [template];
};
const matches = (pattern, route) => {
  for (let i = 0; i < pattern.length; i++) {
    if (pattern[i] === "**") return true;
    if (i >= route.length) return false;
    if (pattern[i] === ":lang" ? route[i] !== ":lang" : !pattern[i].startsWith(":") && pattern[i] !== route[i]) return false;
  }
  return pattern.length === route.length;
};
const served = (table, path) => table.some((pattern) => matches(pattern, segments(path.split("?")[0])));

/**
 * Why the run cannot sweep a route, in one line naming it, or null when it can.
 * With the checkout's routerTable, a route the router does not serve is refused too.
 */
export function routeProblem(route, table = null) {
  if (!ROUTE_PATTERN.test(route) || route.includes(",")) return `${route}: not a route the PR QA workflow accepts (path[?query][@role][:status], letters, digits and /_.@:?=&%- only)`;
  const rest = route.replace(LANG, "");
  if (!SHAPE.test(rest)) return `${route}: a ':' belongs only in a leading /:lang segment or a trailing :<status>`;
  const { path, role, expect } = parseRoute(route);
  if (role && !Object.hasOwn(SEEDED, role)) return `${route}: no seeded account has the role ${role} (${Object.keys(SEEDED).join(", ")})`;
  if (path.startsWith("/app/") && !role) return `${route}: a route under /app/ needs @role, or the sweep opens the sign-in screen`;
  if (!table || expect >= 400 || served(table, path)) return null;
  const local = `/:lang${path === "/" ? "" : path}`;
  if (served(table, local)) return `${route}: a public page is served under the language node; write ${local}${route.slice(path.length)}`;
  return `${route}: not a route of app.routes.ts or dashboard/views.ts`;
}

export function matrix({ routes, schemes = ["light", "dark"], langs = ["ro", "en"] }) {
  return routes.flatMap((route) => {
    const { path, role, expect, lang: perLang } = parseRoute(route);
    const name = `${slug(path)}${role ? `-as-${role}` : ""}${expect ? `-${expect}` : ""}`;
    return Object.keys(VIEWPORTS).flatMap((viewport) =>
      schemes.flatMap((scheme) =>
        langs.map((lang) => ({
          route,
          path,
          href: perLang ? path.replace(LANG, `/${lang}`) : path,
          role,
          expect,
          viewport,
          scheme,
          lang,
          shot: `${name}-${viewport}-${scheme}-${lang}.png`,
        })),
      ),
    );
  });
}

/** What is wrong with a page's own answer, or null: any error status, unless the route expects exactly that one. */
export function loadProblem(status, expect) {
  if (status == null) return "HTTP no response";
  if (expect) return status === expect ? null : `HTTP ${status}, expected ${expect}`;
  return status >= 400 ? `HTTP ${status}` : null;
}

const pathOf = (url) => {
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch {
    return null;
  }
};

/** Without the error response, and the console line it logs, that a route's expected status causes. */
export const dropExpected = (observations) =>
  observations.filter(
    (o) =>
      !o.expect ||
      !(
        (o.kind === "http" && o.status === o.expect && pathOf(o.url) === (o.href ?? o.path)) ||
        (o.kind === "console" && String(o.text).includes(`status of ${o.expect}`))
      ),
  );

/**
 * The cookies a context opens a run with: a fresh session of its role (refresh tokens rotate, so never shared)
 * in the run's language, else none. flowSignIn passes the language a flow asks for (`ro` when it names none).
 */
export async function contextCookies(run, { session, baseURL }) {
  if (!run.role) return [];
  if (!session) throw new Error(`no session for @${run.role}: the sweep was given no way to sign in`);
  return [sessionCookie({ refresh: await session(run.role, run.lang), baseURL })];
}

/**
 * Every page of the context starts in `lang`, as if the language switch had chosen it, and, signed in, with the
 * role hint a browser that signed in through the app holds (the public pages ask the session only then).
 */
export const keepBrowser = (context, { lang, role }) =>
  context.addInitScript(
    (entries) => {
      try {
        for (const [key, value] of entries) localStorage.setItem(key, value);
      } catch {}
    },
    [[LANG_KEY, lang], ...(role ? [[ROLE_KEY, role]] : [])],
  );

// The QA flows' `signIn(context, role[, lang])`: the cookie a `path@role` route gets, for a browser context
// the flow opened itself, and its pages in that language. The account's language is set every time (Romanian
// unless asked), since the sweep before the flows leaves it at whichever language it swept last, and the
// stored choice too, since a restored session does not re-read the account's.
export const flowSignIn =
  ({ session, baseURL }) =>
  async (context, role, lang = "ro") => {
    if (!role) throw new Error("signIn(context, role) needs a role, one of the seeded accounts'");
    await context.addCookies(await contextCookies({ role, lang }, { session, baseURL }));
    await keepBrowser(context, { lang, role });
  };

/** The refresh cookie the API sets at sign-in, for the web origin, which forwards /api/ to the API. */
export const sessionCookie = ({ refresh, baseURL }) => ({
  name: "mf_refresh",
  value: refresh,
  domain: new URL(baseURL).hostname,
  path: "/api/v1/auth",
  httpOnly: true,
  secure: false,
  sameSite: "Strict",
});

const keyOf = (o) =>
  o.kind === "layout" ? layoutKey(o) : `${o.kind}|${o.route}|${o.rule ?? o.text ?? ""}|${o.kind === "http" ? `${o.url}|${o.status}` : (o.url ?? "")}`;

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

/**
 * Drive the running web app through the matrix; returns observations and
 * screenshot paths. `session(role, lang)` signs a seeded account of that role in,
 * sets its language, and returns its refresh token, for routes marked `@role`.
 */
// A signed-in screen holds its live stream open, so the network never idles:
// the page must load, then gets a bounded wait for its first calls to settle.
const SETTLE_MS = 5000;
export async function openPage(page, url) {
  const res = await page.goto(url, { waitUntil: "load", timeout: 30000 });
  await page.waitForLoadState("networkidle", { timeout: SETTLE_MS }).catch(() => {});
  return res;
}

// A canvas chart (Chart.js) animates in script, which SHOT_OPTIONS' animations: "disabled" cannot stop:
// wait, bounded, until no canvas changes across STABLE_FRAMES frames `interval` ms apart and none is
// still blank (Chart.js draws its first frame only once the canvas is sized). Three frames, not two:
// an easing tail can repeat one frame before the bars reach their height. A page with no canvas
// returns at once; one that cannot be read, or never settles, is shot as it is (false).
export const CANVAS_SETTLE_MS = 3000;
const STABLE_FRAMES = 3;
export async function settleCanvases(page, { timeout = CANVAS_SETTLE_MS, interval = 100 } = {}) {
  const frame = () =>
    page.evaluate(() => {
      let blank = false;
      const sig = [...document.querySelectorAll("canvas")]
        .map((canvas) => {
          try {
            const url = canvas.toDataURL();
            const empty = document.createElement("canvas");
            empty.width = canvas.width;
            empty.height = canvas.height;
            if (url === empty.toDataURL()) blank = true;
            return url;
          } catch {
            return "";
          }
        })
        .join("|");
      return { sig, blank };
    });
  try {
    const deadline = Date.now() + timeout;
    let last = await frame();
    if (!last.sig) return true;
    let same = 1;
    while (Date.now() < deadline) {
      await page.waitForTimeout(interval);
      const next = await frame();
      same = next.sig === last.sig && !next.blank ? same + 1 : 1;
      if (same >= STABLE_FRAMES) return true;
      last = next;
    }
  } catch {}
  return false;
}

// The web fonts load after the page does, so a shot taken before they arrive renders its text in the
// fallback and differs from the baseline's on a page nobody changed: wait, bounded, for
// document.fonts.ready. A page that cannot be read, or whose fonts never settle, is shot as it is (false).
export const FONT_SETTLE_MS = 5000;
export async function settleFonts(page, { timeout = FONT_SETTLE_MS } = {}) {
  let timer;
  const late = new Promise((resolve) => {
    timer = setTimeout(() => resolve(false), timeout);
  });
  try {
    return await Promise.race([page.evaluate(async () => { await document.fonts.ready; }).then(() => true, () => false), late]);
  } finally {
    clearTimeout(timer);
  }
}

// One sweep page's browser context. Reduced motion stills the charts' entry
// animation, so a shot never catches a bar mid-flight and differs from the
// baseline's on a page nobody changed (settleCanvases stays as the fallback).
export const contextOptions = (run) => {
  const vp = VIEWPORTS[run.viewport];
  return {
    viewport: { width: vp.width, height: vp.height },
    isMobile: vp.isMobile,
    hasTouch: vp.hasTouch,
    deviceScaleFactor: vp.deviceScaleFactor,
    colorScheme: run.scheme,
    locale: LOCALES[run.lang],
    reducedMotion: "reduce",
  };
};

// One run's browser context: its viewport, scheme and language, the role hint when it is signed in, Home's
// copy voice pinned, and maps reading the app's own empty style, so no tile is fetched from outside.
export async function openContext(browser, run) {
  const context = await browser.newContext(contextOptions(run));
  await keepBrowser(context, run);
  await context.addInitScript(
    ([key, value]) => {
      try {
        localStorage.setItem(key, value);
      } catch {}
    },
    [VOICES_KEY, PINNED_VOICES],
  );
  await context.addInitScript(() => {
    globalThis.__MF_MAP_STYLE = "/map/empty-style.json";
  });
  return context;
}

export async function runSweep({ baseURL, routes, outDir, schemes, langs, repoRoot, session }) {
  const require = createRequire(join(repoRoot, "package.json"));
  const { chromium } = require("@playwright/test");
  const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
  const observations = [];
  const screenshots = [];
  // route|viewport|scheme|lang -> the layout rules measured there in full (layout.mjs), saved as the report's layoutCoverage.
  const coverage = {};
  const browser = await launchBrowser(chromium);
  try {
    for (const run of matrix({ routes, schemes, langs })) {
      const vp = VIEWPORTS[run.viewport];
      const context = await openContext(browser, run);
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
        await context.addCookies(await contextCookies(run, { session, baseURL }));
        const res = await openPage(page, new URL(run.href, baseURL).href);
        const problem = loadProblem(res?.status(), run.expect);
        if (problem) seen({ kind: "load", text: problem });
        await page.waitForTimeout(300);
        await page.evaluate(axeSource);
        const axe = await page.evaluate(() => globalThis.axe.run(document, { resultTypes: ["violations"] }));
        for (const v of axe.violations)
          seen({ kind: "axe", impact: v.impact ?? "minor", rule: v.id, help: v.help, nodes: v.nodes.length, target: v.nodes[0]?.target?.join(" ") });
        const box = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, width: window.innerWidth }));
        if (box.scrollWidth > box.width + 1) seen({ kind: "overflow", ...box });
        // The screenshot first: measuring focuses controls for the focus-ring check, which would show in it.
        await settleFonts(page);
        await settleCanvases(page);
        await page.screenshot(shotOptions(page, screenshot));
        screenshots.push(screenshot);
        if (!problem) {
          const layout = await page.evaluate(measureLayout, { phone: vp.isMobile, tapTargets: vp.hasTouch, focus: run.viewport === "desktop" });
          for (const o of layout.observations) seen(o);
          coverage[coverageKey(run)] = layout.rules;
        }
      } catch (error) {
        seen({ kind: "load", text: String(error.message).split("\n")[0].slice(0, 300) });
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
  return { observations: dropExpected(observations), screenshots, coverage };
}

if (isEntryPoint(import.meta.url)) {
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
