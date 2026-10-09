// Copies the Notion backlog into the MotorFix GitHub Project, one way: an
// issue per story and epic in the private motor-fix-specs (repos.mjs), its
// Project fields, sub-issues, dependencies and
// a Closes line on an open story's PR. Every run replans from what GitHub
// holds, so an interrupted lap continues where it stopped.
//
//   node .claude/scripts/tracker/import.mjs [--dry-run] [--budget <n>] [--max-items <n>]
import { fileURLToPath } from "node:url";

import { isEntryPoint } from "../lib/entry.mjs";
import { NotionError, notionClient, notionToken } from "../lib/notion.mjs";
import { findProject, projectState } from "./bootstrap.mjs";
import { GitHubError, githubClient, MAX_PAGES } from "./github.mjs";
import { CODE_REPO, closesLine, ISSUE_REPO, OWNER, pullPath } from "./repos.mjs";
import { readTracker } from "./notion-read.mjs";
import { assertProjectScope, projectToken, TokenError } from "./token.mjs";

// The template's empty closing line, cross-repository or the older same-repository form.
const PLACEHOLDER = new RegExp(`^Closes (?:${OWNER}/${ISSUE_REPO})?#[ \\t]*$`, "m");
const PULL = new RegExp(`^https://github\\.com/${OWNER}/${CODE_REPO}/pull/(\\d+)`);
const STATUSES = ["To do", "Planning", "Implementing", "Blocked", "QA", "Done"];
const EPIC_STATUS = { "To do": "To do", "In progress": "Implementing", Done: "Done" };
const PRIORITIES = ["Urgent", "Highest", "High", "Medium", "Low"];
const KINDS = ["create", "adopt", "update", "add-item", "set-fields", "close", "reopen", "sub-issue", "blocked-by", "pr-closes"];
const MARKER = /<!-- motorfix:((?:ST|EP)-\d+) -->/;
// Set on an issue filed by hand and adopted: its title and labels stay the person's.
const ADOPTED = "<!-- motorfix:adopted -->";

const notionUrl = (id) => `https://app.notion.com/p/${id.replaceAll("-", "")}`;
const keyNumber = (key) => Number(key.split("-")[1]);
// A bare @name in a public issue title would notify that GitHub user.
const quiet = (title) => title.replace(/(^|\s)(@[\w-]+)/g, "$1`$2`");
const titled = (key, title) => {
  const one = (title ?? "").replace(/\s+/g, " ").trim();
  if (!one) return key;
  return new RegExp(`^${key}\\b`).test(one) ? quiet(one) : `${key} ${quiet(one)}`;
};
const lower = (names) => new Set(names.map((n) => n.toLowerCase()));
const dated = (fields, entries) => {
  for (const [name, value] of entries) if (value !== null && value !== undefined) fields[name] = value;
  return fields;
};

/** What each story and epic should be on GitHub, in import order, and what Notion held that could not be mapped. */
export function issuePlans(tracker) {
  const warnings = [];
  const seen = new Map();
  for (const r of [...tracker.stories, ...tracker.epics]) {
    if (seen.has(r.key)) throw new Error(`two Notion pages carry ${r.key}: ${seen.get(r.key)} and ${r.id}`);
    seen.set(r.key, r.id);
  }
  const epicByKey = new Map(tracker.epics.map((e) => [e.key, e]));
  const statusOf = new Map(tracker.stories.map((s) => [s.key, s.status]));
  /** The blockers that are imported items other than the item itself; the rest are warned and dropped. */
  const linkable = (r) =>
    r.blockers.filter((b) => {
      if (b !== r.key && seen.has(b)) return true;
      warnings.push(`${r.key} is blocked by ${b}, ${b === r.key ? "itself" : "which is not imported"}; not linked`);
      return false;
    });

  const stories = tracker.stories.map((s) => {
    const [named, ...others] = s.epics;
    if (others.length) warnings.push(`${s.key} has ${s.epics.length} epics (${s.epics.join(", ")}); imported under ${named}`);
    const epic = named && epicByKey.has(named) ? named : undefined;
    if (named && !epic) warnings.push(`${s.key} is under ${named}, which is not imported; no parent, EP label or Epic field`);
    let status = s.status;
    if (!STATUSES.includes(status)) {
      warnings.push(`${s.key} has Status "${status}", not a tracker status; imported as To do`);
      status = "To do";
    }
    let type = s.type;
    if (!type?.trim()) {
      warnings.push(`${s.key} has no Issue type; imported as Story`);
      type = "Story";
    }
    const blockers = linkable(s);
    const ready = status === "To do" && blockers.every((b) => statusOf.get(b) === "Done");
    const pr = s.pr?.match(PULL);
    if (s.pr && !pr) warnings.push(`${s.key} has a PR value that is not a motor-fix pull request URL; not published`);
    return {
      key: s.key,
      title: titled(s.key, s.title),
      body: [`<!-- motorfix:${s.key} -->`, `Notion: ${notionUrl(s.id)}`, ...(s.feature ? [`Feature: ${notionUrl(s.feature)}`] : []), ...(pr ? [`PR: ${pr[0]}`] : [])].join("\n"),
      labels: [`type: ${type.toLowerCase()}`, ...(epic ? [epic] : []), ...s.labels.map((l) => `area: ${l}`), ...(s.role ? [`role: ${s.role}`] : [])],
      milestone: epicByKey.get(epic)?.release ?? null,
      assignee: s.assignee,
      state: status === "Done" ? "closed" : "open",
      parent: epic ?? null,
      blockers,
      pr: pr ? Number(pr[1]) : null,
      fields: dated({ Status: status }, [
        ["Priority", s.priority],
        ["Work type", type],
        ["Epic", epic],
        ["Ready to work", ready ? "Yes" : "No"],
        ["Started", s.started],
        ["QA from", s.qaFrom],
        ["Merged at", s.mergedAt],
        ["Story points", s.points],
        ["Planned start", s.plannedStart],
        ["Planned end", s.plannedEnd],
      ]),
    };
  });

  const epics = tracker.epics.map((e) => {
    let status = EPIC_STATUS[e.status];
    if (!status) {
      warnings.push(`${e.key} has Status "${e.status}", not an epic status; imported as To do`);
      status = "To do";
    }
    return {
      key: e.key,
      title: titled(e.key, e.title),
      body: `<!-- motorfix:${e.key} -->\nNotion: ${notionUrl(e.id)}`,
      labels: ["epic", ...(e.track ? [`track: ${e.track}`] : [])],
      milestone: e.release ?? null,
      assignee: e.assignee,
      state: status === "Done" ? "closed" : "open",
      parent: null,
      blockers: linkable(e),
      pr: null,
      fields: dated({ Status: status }, [
        ["Priority", e.priority],
        ["Work type", "Epic"],
        ["Epic", e.key],
        ["Planned start", e.plannedStart],
        ["Planned end", e.plannedEnd],
      ]),
    };
  });

  const rank = (p) => {
    const i = PRIORITIES.indexOf(p.fields.Priority);
    return i === -1 ? PRIORITIES.length : i;
  };
  const byId = (a, b) => keyNumber(a.key) - keyNumber(b.key);
  const open = stories.filter((p) => p.state === "open").sort((a, b) => rank(a) - rank(b) || byId(a, b));
  const done = stories.filter((p) => p.state === "closed").sort(byId);
  return { plans: [...open, ...epics.sort(byId), ...done], warnings };
}

const ITEMS = `query Items($id: ID!, $after: String) { node(id: $id) { ... on ProjectV2 { items(first: 100, after: $after) { totalCount pageInfo { hasNextPage endCursor }
  nodes { id content { ... on Issue { number } } fieldValues(first: 30) { nodes {
    ... on ProjectV2ItemFieldSingleSelectValue { name field { ... on ProjectV2FieldCommon { name } } }
    ... on ProjectV2ItemFieldDateValue { date field { ... on ProjectV2FieldCommon { name } } }
    ... on ProjectV2ItemFieldNumberValue { number field { ... on ProjectV2FieldCommon { name } } } } } } } } } }`;
const ADD_ITEM = "mutation AddItem($projectId: ID!, $contentId: ID!) { addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) { item { id } } }";

/** Every Project item: its id, issue number and field values by name. */
async function projectItems(github, id) {
  const items = [];
  for (let after = null, more = true, count = 0; more; ) {
    if (++count > MAX_PAGES) throw new GitHubError("pages", `the Project's items: more than ${MAX_PAGES} pages`);
    const page = (await github.graphql(ITEMS, { id, after })).node.items;
    for (const node of page.nodes) {
      const values = {};
      for (const v of node.fieldValues.nodes) if (v.field) values[v.field.name] = v.name ?? v.date ?? v.number;
      items.push({ id: node.id, number: node.content?.number ?? null, values });
    }
    more = page.pageInfo.hasNextPage;
    after = page.pageInfo.endCursor;
  }
  return items;
}

/** One aliased mutation that sets every listed field of an item. */
function setFieldsMutation(count) {
  const vars = Array.from({ length: count }, (_, i) => `, $f${i}: ID!, $v${i}: ProjectV2FieldValue!`).join("");
  const sets = Array.from(
    { length: count },
    (_, i) => `f${i}: updateProjectV2ItemFieldValue(input: { projectId: $projectId, itemId: $itemId, fieldId: $f${i}, value: $v${i} }) { projectV2Item { id } }`,
  ).join(" ");
  return `mutation SetFields($projectId: ID!, $itemId: ID!${vars}) { ${sets} }`;
}

/** What is missing for the import to run, or null. */
function missingSetup({ plans, labels, milestones, fields }) {
  const absent = (list, have) => [...new Set(list)].filter((x) => !have.has(x));
  const fieldNames = new Map(fields.map((f) => [f.name, f]));
  // GitHub label names are case-insensitive: an "ep-1" label serves "EP-1".
  const labelNames = lower([...labels]);
  const parts = [
    ["labels", [...new Set(plans.flatMap((p) => p.labels))].filter((x) => !labelNames.has(x.toLowerCase()))],
    ["milestones", absent(plans.map((p) => p.milestone).filter(Boolean), milestones)],
    ["fields", absent(plans.flatMap((p) => Object.keys(p.fields)), new Set(fieldNames.keys()))],
    [
      "options",
      absent(
        plans.flatMap((p) =>
          Object.entries(p.fields)
            .filter(([name]) => fieldNames.get(name)?.options)
            .map(([name, value]) => `${name}: ${value}`),
        ),
        new Set(fields.flatMap((f) => (f.options ?? []).map((o) => `${f.name}: ${o.name}`))),
      ),
    ],
  ].filter(([, list]) => list.length);
  return parts.length ? parts.map(([what, list]) => `${what} ${list.slice(0, 5).join(", ")}${list.length > 5 ? ", …" : ""}`).join("; ") : null;
}

export async function runImport({ github, tracker, log = console.log, dryRun = false, budget = Infinity, maxItems = 1200 }) {
  const out = (kind, detail) => log(`${kind.padEnd(9)} ${detail}`);
  const { plans, warnings } = issuePlans(tracker);

  const { project } = await findProject(github);
  if (!project) {
    out("failed", "run bootstrap first: no MotorFix Project");
    return 1;
  }
  const state = await projectState(github, project.id);
  const labels = new Set((await github.pages("labels?per_page=100")).map((l) => l.name));
  const milestoneList = await github.pages("milestones?state=all&per_page=100");
  const missing = missingSetup({ plans, labels, milestones: new Set(milestoneList.map((m) => m.title)), fields: state.fields });
  if (missing) {
    out("failed", `run bootstrap first: missing ${missing}`);
    return 1;
  }
  const milestoneNumber = new Map(milestoneList.map((m) => [m.title, m.number]));
  const fieldByName = new Map(state.fields.map((f) => [f.name, f]));

  const listed = (await github.pages("issues?state=all&per_page=100")).filter((i) => !i.pull_request);
  const byMarker = new Map();
  const byTitle = new Map();
  for (const issue of listed) {
    const marked = issue.body?.match(MARKER)?.[1];
    if (marked) byMarker.set(marked, issue);
    const titleKey = issue.title.match(/^(?:ST|EP)-\d+\b/)?.[0];
    if (titleKey && !byTitle.has(titleKey)) byTitle.set(titleKey, issue);
  }
  const items = await projectItems(github, project.id);
  const itemOf = new Map(items.filter((it) => it.number !== null).map((it) => [it.number, it]));

  const issue = new Map();
  const steps = [];
  const step = (kind, key, run) => steps.push({ kind, key, run });
  let adopted = 0;

  for (const plan of plans) {
    const byMark = byMarker.get(plan.key);
    const found = byMark ?? byTitle.get(plan.key);
    if (found) issue.set(plan.key, found);
    if (!found) {
      step("create", plan.key, async () => {
        const made = await github.rest("POST", "issues", {
          title: plan.title,
          body: plan.body,
          labels: plan.labels,
          ...(plan.milestone ? { milestone: milestoneNumber.get(plan.milestone) } : {}),
          assignees: plan.assignee ? [plan.assignee] : [],
        });
        issue.set(plan.key, made);
        return `→ #${made.number}`;
      });
    } else {
      // A hand-filed issue keeps its title and labels; the import owns the rest.
      const byHand = !byMark || found.body?.includes(ADOPTED);
      const change = {};
      if (!byHand && found.title !== plan.title) change.title = plan.title;
      // A story that later gains a PR or a Feature gets its line in the body.
      if (!byHand && found.body !== plan.body) change.body = plan.body;
      const have = found.labels.map((l) => l.name);
      const haveLower = lower(have);
      if (!byHand && plan.labels.some((l) => !haveLower.has(l.toLowerCase()))) change.labels = [...have, ...plan.labels.filter((l) => !haveLower.has(l.toLowerCase()))];
      if ((found.milestone?.title ?? null) !== plan.milestone) change.milestone = plan.milestone ? milestoneNumber.get(plan.milestone) : null;
      if (plan.assignee && !found.assignees.some((a) => a.login === plan.assignee)) change.assignees = [plan.assignee];
      if (!byMark) {
        adopted++;
        const body = [plan.body, ADOPTED, ...(found.body ? ["", found.body] : [])].join("\n");
        step("adopt", plan.key, async () => {
          await github.rest("PATCH", `issues/${found.number}`, { body, ...change });
          return `#${found.number}`;
        });
      } else if (Object.keys(change).length) {
        step("update", plan.key, async () => {
          await github.rest("PATCH", `issues/${found.number}`, change);
          return `#${found.number} ${Object.keys(change).join(", ")}`;
        });
      }
    }

    let item = found ? itemOf.get(found.number) : undefined;
    if (!item) {
      step("add-item", plan.key, async () => {
        const made = await github.graphql(ADD_ITEM, { projectId: project.id, contentId: issue.get(plan.key).node_id });
        item = { id: made.addProjectV2ItemById.item.id, values: {} };
      });
    }
    const differing = Object.entries(plan.fields).filter(([name, value]) => item?.values[name] !== value);
    if (differing.length) {
      step("set-fields", plan.key, async () => {
        const variables = { projectId: project.id, itemId: item.id };
        differing.forEach(([name, value], i) => {
          const field = fieldByName.get(name);
          variables[`f${i}`] = field.id;
          variables[`v${i}`] =
            field.dataType === "SINGLE_SELECT"
              ? { singleSelectOptionId: field.options.find((o) => o.name === value).id }
              : field.dataType === "NUMBER"
                ? { number: value }
                : { date: value };
        });
        await github.graphql(setFieldsMutation(differing.length), variables);
        return differing.map(([name]) => name).join(", ");
      });
    }
    const current = found?.state ?? "open";
    if (current !== plan.state) {
      const kind = plan.state === "closed" ? "close" : "reopen";
      step(kind, plan.key, async () => {
        const number = issue.get(plan.key).number;
        await github.rest("PATCH", `issues/${number}`, plan.state === "closed" ? { state: "closed", state_reason: "completed" } : { state: "open" });
        return `#${number}`;
      });
    }
  }

  const linked = async (key, path) => {
    const found = issue.get(key);
    return found ? (await github.pages(`issues/${found.number}/${path}`)).map((i) => i.id) : [];
  };
  const children = new Map();
  for (const plan of plans.filter((p) => p.parent)) {
    if (!children.has(plan.parent)) children.set(plan.parent, await linked(plan.parent, "sub_issues"));
    if (issue.has(plan.key) && children.get(plan.parent).includes(issue.get(plan.key).id)) continue;
    step("sub-issue", plan.key, async () => {
      const parent = issue.get(plan.parent).number;
      await github.rest("POST", `issues/${parent}/sub_issues`, { sub_issue_id: issue.get(plan.key).id });
      return `under #${parent}`;
    });
  }
  for (const plan of plans.filter((p) => p.blockers.length)) {
    const have = await linked(plan.key, "dependencies/blocked_by");
    for (const blocker of plan.blockers) {
      if (issue.has(blocker) && have.includes(issue.get(blocker).id)) continue;
      step("blocked-by", plan.key, async () => {
        await github.rest("POST", `issues/${issue.get(plan.key).number}/dependencies/blocked_by`, { issue_id: issue.get(blocker).id });
        return blocker;
      });
    }
  }
  for (const plan of plans.filter((p) => p.pr && p.state === "open")) {
    let pull;
    try {
      pull = await github.rest("GET", pullPath(plan.pr));
    } catch (error) {
      if (!(error instanceof GitHubError && error.type === "404")) throw error;
      warnings.push(`${plan.key} names PR #${plan.pr}, which GitHub does not have; no Closes line`);
      continue;
    }
    const number = issue.get(plan.key)?.number;
    if (pull.state !== "open" || (number && new RegExp(`^${closesLine(number)}\\b`, "m").test(pull.body ?? ""))) continue;
    step("pr-closes", plan.key, async () => {
      // The only text the import writes into the public code repository.
      const line = closesLine(issue.get(plan.key).number);
      const body = pull.body ?? "";
      const next = PLACEHOLDER.test(body) ? body.replace(PLACEHOLDER, line) : `${body}${body ? "\n" : ""}${line}`;
      await github.rest("PATCH", pullPath(plan.pr), { body: next });
      return `PR #${plan.pr}`;
    });
  }

  const counts = Object.fromEntries(KINDS.map((k) => [k, 0]));
  for (const s of steps) counts[s.kind]++;
  out("read", `notion: ${tracker.stories.length} stories, ${tracker.epics.length} epics (${tracker.skippedRows ?? 0} timeline rows without a story skipped)`);
  out("read", `github: ${listed.length} issues listed, ${byMarker.size} matched by marker, ${adopted} by title; project items ${items.length} of max ${maxItems}`);
  out("plan", KINDS.map((k) => `${k} ${counts[k]}`).join(" · "));
  for (const w of [...tracker.warnings, ...warnings]) out("warn", w);
  if (dryRun) {
    out("titles", `(${plans.length}, the only Notion text that becomes public)`);
    for (const p of plans) log(`          ${p.title}`);
    return 0;
  }
  if (items.length + counts["add-item"] > maxItems) {
    out("refused", `the Project would hold ${items.length + counts["add-item"]} items, over --max-items ${maxItems}`);
    return 2;
  }

  let ran = 0;
  for (const s of steps) {
    if (ran === budget) {
      out("stopped", `${ran ? `after ${steps[ran - 1].key}` : "before the first step"} (${ran} of ${steps.length.toLocaleString("en-US")} steps, budget ${budget} reached)`);
      out("continue", `node .claude/scripts/tracker/import.mjs --budget ${budget}`);
      return 3;
    }
    try {
      const detail = await s.run();
      out(s.kind, `${s.key}${detail ? ` ${detail}` : ""}`);
    } catch (error) {
      if (!(error instanceof GitHubError)) throw error;
      out("failed", `${s.key} ${s.kind}: ${error.message}`);
      return 1;
    }
    ran++;
  }
  // Warnings are reported above and never change the exit: every step ran.
  out("done", `${plans.length} items; 0 steps left; ${github.stats.content} content requests`);
  return 0;
}

/** A whole-number flag's value, `fallback` when absent, NaN when malformed. */
function flag(argv, name, fallback) {
  const i = argv.indexOf(name);
  if (i === -1) return fallback;
  const n = Number(argv[i + 1]);
  return Number.isInteger(n) && n > 0 ? n : Number.NaN;
}

async function main(argv = process.argv.slice(2)) {
  const budget = flag(argv, "--budget", Infinity);
  const maxItems = flag(argv, "--max-items", 1200);
  if (Number.isNaN(budget) || Number.isNaN(maxItems)) {
    console.error("--budget and --max-items take a whole number above 0");
    process.exitCode = 1;
    return;
  }
  try {
    const notion = notionToken(fileURLToPath(new URL("../../../", import.meta.url)));
    if (!notion) throw new NotionError("no token", "No Notion token: set NOTION_TOKEN or put it in .env");
    const github = githubClient({ token: projectToken(), log: console.log });
    console.log(`${"token".padEnd(9)} ${await assertProjectScope(github)}, project scope`);
    const tracker = await readTracker(notionClient({ token: notion }));
    process.exitCode = await runImport({ github, tracker, dryRun: argv.includes("--dry-run"), budget, maxItems });
  } catch (error) {
    if (!(error instanceof TokenError || error instanceof GitHubError || error instanceof NotionError)) throw error;
    console.error(error.message);
    process.exitCode = 1;
  }
}

if (isEntryPoint(import.meta.url)) await main();
