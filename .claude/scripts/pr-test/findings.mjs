// The PR tester's rules, in one place: how bad each thing it sees is, what a
// change asks it to boot and call, the verdict, and the report. Everything
// here is pure so the rules are tested without a browser, a server or GitHub.

export const SEVERITIES = ["blocker", "high", "medium", "low"];
const rank = (s) => SEVERITIES.indexOf(s);
const worst = (a, b) => (rank(a) <= rank(b) ? a : b);
const capAt = (severity, cap) => (rank(severity) < rank(cap) ? cap : severity);

export const isBlocking = (f) => f.severity === "blocker" || f.severity === "high";
export const verdict = (findings) => (findings.some(isBlocking) ? "failure" : "success");

const WEB = ["apps/web/", "libs/ui-cockpit/", "libs/i18n/", "libs/data-access/", "libs/media/"];
const WORKER = ["apps/worker/", "libs/domain/", "libs/contracts/"];

export const touchesWeb = (files) => files.some((f) => WEB.some((p) => f.startsWith(p)));

/** The api and the web app serve every sweep; the worker only when its code or shared server code moved. */
export const appsFor = (files) => ({ api: true, web: true, worker: files.some((f) => WORKER.some((p) => f.startsWith(p))) });

/** The measured layout rules a reviewer may not wave through; the others are reported at medium. */
const BLOCKING_LAYOUT = new Set(["min-text", "type-scale", "clipped", "grid"]);

function sweepSeverity(o) {
  switch (o.kind) {
    case "load":
    case "pageerror":
      return "blocker";
    case "console":
      return "high";
    case "request-failed":
      return o.offOrigin ? "low" : "high";
    case "http":
      if (o.offOrigin) return "low";
      return o.status >= 500 ? "high" : "medium";
    case "axe":
      return { critical: "high", serious: "high", moderate: "medium" }[o.impact] ?? "low";
    case "overflow":
      // Both phones, 390 px and 320 px (FR-011).
      return o.viewport === "mobile" || o.viewport === "small-phone" ? "high" : "medium";
    case "layout":
      return BLOCKING_LAYOUT.has(o.rule) ? "high" : "medium";
    default:
      return "medium";
  }
}

function sweepTitle(o) {
  switch (o.kind) {
    case "load":
      return `Page did not load: ${o.text}`;
    case "pageerror":
      return `Uncaught error: ${o.text}`;
    case "console":
      return `Console error: ${o.text}`;
    case "request-failed":
      return `Request failed: ${o.url} (${o.text})`;
    case "http":
      return `HTTP ${o.status}: ${o.url}`;
    case "axe":
      return `Accessibility (${o.impact}): ${o.rule}${o.help ? ` — ${o.help}` : ""}${o.nodes ? ` (${o.nodes} element${o.nodes === 1 ? "" : "s"})` : ""}`;
    case "overflow":
      return `Horizontal overflow: page is ${o.scrollWidth}px wide in a ${o.width}px viewport`;
    case "layout":
      return `Layout (${o.rule}): ${o.selector}${o.text ? ` "${o.text}"` : ""}${o.measured ? ` — measured ${o.measured}, expected ${o.expected}` : ""}`;
    default:
      return o.text ?? o.kind;
  }
}

/**
 * One observation from the browser as a finding. When the change touches no
 * web code the page is not what it changed, so what the sweep sees there is
 * reported as pre-existing and capped at medium — except a page that does not
 * load at all, which a harness or server change can cause.
 */
export function sweepFinding(o, { web }) {
  let severity = sweepSeverity(o);
  let preExisting = false;
  if (!web && o.kind !== "load") {
    preExisting = true;
    severity = capAt(severity, "medium");
  }
  return {
    severity,
    kind: o.kind,
    title: sweepTitle(o),
    route: o.route,
    viewport: o.viewport,
    scheme: o.scheme,
    lang: o.lang,
    steps: [
      `Open ${o.route} at the ${o.viewport} viewport (${o.size ?? "see VIEWPORTS"}), ${o.scheme} colour scheme, language ${o.lang}.`,
      o.kind === "axe"
        ? `Run axe-core on the page: rule ${o.rule}${o.target ? ` on ${o.target}` : ""}.`
        : o.kind === "layout"
          ? `Measure ${o.selector}: ${o.measured}, expected ${o.expected}.`
          : "Wait for the network to go idle.",
      `Observe: ${sweepTitle(o)}.`,
    ],
    evidence: o.screenshot,
    ...(o.kind === "layout" ? { rule: o.rule, selector: o.selector, measured: o.measured, expected: o.expected, text: o.text ?? "" } : {}),
    ...(preExisting ? { preExisting: true } : {}),
  };
}

/** The problem code a body carries, when it is JSON with one. */
function problemCode(body) {
  try {
    const code = JSON.parse(body)?.code;
    return typeof code === "string" ? code : null;
  } catch {
    return null;
  }
}

/**
 * A server error on a changed operation is high, unless the operation's
 * OpenAPI `responses` document that status with that very problem code as its
 * description (an upstream refusal the tester's environment cannot satisfy,
 * such as `502 whatsapp_failed` with sending off): then it is low, still in
 * the report but not blocking.
 */
export function endpointFinding({ method, path, status, body, responses }) {
  if (status < 500) return null;
  const code = problemCode(body);
  const documented = code !== null && responses?.[status]?.description === code;
  return {
    severity: documented ? "low" : "high",
    kind: "api",
    title: `${method} ${path} answered ${status}${documented ? ` ${code}, as its contract documents` : ""}`,
    ...(documented ? { documented: true } : {}),
    steps: [`${method} ${path} against the tester's API.`, `Observe: HTTP ${status}${body ? ` ${String(body).slice(0, 200)}` : ""}.`],
  };
}

export function testFinding({ name, command, code, tail }) {
  if (code === 0) return null;
  return {
    severity: "blocker",
    kind: "test",
    title: `${name} failed (exit ${code})`,
    steps: [`In the PR worktree: ${command}`, `Observe: ${String(tail ?? "").trim().split("\n").slice(-5).join(" / ")}`],
  };
}

/** A finding for a step that could not run: boot, health, install, build. */
export const stepFinding = (title, detail, severity = "blocker") => ({ severity, kind: "step", title, steps: [detail] });

/** A lap stopped by a signal: whatever it found so far is no verdict. */
export const cutOffFinding = (signal, phase) =>
  stepFinding(`Lap cut off by ${signal} during ${phase}`, "The run was stopped before it finished; its findings so far are in this report. Run the lap again.");

/**
 * What a readiness answer means for the review: nothing on 200; a note when
 * only storage is down and the lap started no object store (a limit of this
 * machine, not the change); a blocking finding otherwise.
 */
export function readinessOutcome({ name, status, body, storage, url }) {
  if (status === 200) return {};
  let failed = [];
  try {
    failed = Object.entries(JSON.parse(body).checks ?? {})
      .filter(([, v]) => v !== "ok")
      .map(([k]) => k);
  } catch {}
  if (!storage && failed.length === 1 && failed[0] === "storage")
    return { note: `${name} readiness: storage down, every other check ok. This lap had no object store (no Docker and no minio binary): a limit of this machine, not the change.` };
  return { finding: stepFinding(`${name} readiness failed: ${failed.join(", ") || status}`, `GET ${url} answered ${status}: ${String(body).slice(0, 300)}`) };
}

/** A layout finding is its route, rule and element: the value measured may move between laps. */
// Each part escapes its own "|", so no route or selector can pass for another rule's key.
const keyPart = (v) => String(v ?? "").replaceAll("\\", "\\\\").replaceAll("|", "\\|");
// An element as it stays from run to run: no generated id (a per-page counter such as brn-label-2) and no
// place among its siblings, both of which renumber when a change adds an element before it; its own text says which
// (so one element is one finding per language, each matched against the baseline's run in that language).
const GENERATED_ID = /#[\w\\-]*?[-_:]\d+(?![\w\\-])/g;
const stableSelector = (selector) => String(selector ?? "").replace(/:nth-of-type\(\d+\)/g, "").replace(GENERATED_ID, "");
export const layoutKey = (f) => `layout|${keyPart(f.route)}|${keyPart(f.rule)}|${keyPart(stableSelector(f.selector))}|${keyPart(f.text)}`;

/** What makes two findings the same one, across sources and laps. */
export const findingKey = (f) => f.key ?? (f.kind === "layout" ? layoutKey(f) : `${f.kind}|${f.title}|${f.route ?? ""}`);

/**
 * Layout findings the baseline run of `main` already reported are pre-existing: kept, capped at medium.
 * A baseline from a tester that measured no layout (`measured: false`) cannot tell main's from the PR's,
 * so every layout finding is treated as main's until a measured baseline exists.
 */
export function markPreExisting(findings, baseline, { measured = true } = {}) {
  const before = new Set(baseline.filter((f) => f.kind === "layout").map(layoutKey));
  return findings.map((f) =>
    f.kind === "layout" && (!measured || before.has(layoutKey(f))) ? { ...f, severity: capAt(f.severity, "medium"), preExisting: true } : f,
  );
}

export function mergeFindings(list) {
  const out = new Map();
  for (const f of list) {
    const key = findingKey(f);
    const seen = out.get(key);
    if (!seen) out.set(key, { ...f });
    else seen.severity = worst(seen.severity, f.severity);
  }
  return [...out.values()];
}

const cell = (s) => String(s ?? "").replaceAll("|", "\\|").replaceAll("\n", " ");

export function reportMarkdown({ pr, sha, verdict: v, findings, booted, screenshots = [], lap, notes = [] }) {
  const sorted = [...findings].sort((a, b) => rank(a.severity) - rank(b.severity));
  const count = (s) => findings.filter((f) => f.severity === s).length;
  const lines = [
    `**Agent review: ${v}** — PR #${pr} at \`${String(sha).slice(0, 7)}\`${lap ? `, lap ${lap}` : ""}`,
    "",
    `Blocking: ${count("blocker") + count("high")} (blocker ${count("blocker")}, high ${count("high")}) · medium ${count("medium")} · low ${count("low")}. Booted: ${booted.join(", ") || "nothing"}.`,
  ];
  for (const n of notes) lines.push(`- ${n}`);
  lines.push("");
  if (!sorted.length) lines.push("No findings.");
  else {
    lines.push("| # | Severity | Finding | Where | Evidence |", "| --- | --- | --- | --- | --- |");
    sorted.forEach((f, i) => {
      const where = [f.route, f.viewport, f.scheme, f.lang].filter(Boolean).join(" · ");
      const also = f.seenIn?.length > 1 ? ` (+${f.seenIn.length - 1} more)` : "";
      lines.push(`| ${i + 1} | ${f.severity}${f.preExisting ? " (pre-existing)" : ""} | ${cell(f.title)} | ${cell(where)}${also} | ${cell(f.evidence ?? "")} |`);
    });
    lines.push("", "### Reproduction");
    sorted.forEach((f, i) => lines.push(`${i + 1}. ${f.steps.map(cell).join(" → ")}`));
  }
  if (screenshots.length) lines.push("", `Screenshots: ${screenshots.length}, one per route × viewport × scheme × language.`);
  return `${lines.join("\n")}\n`;
}
