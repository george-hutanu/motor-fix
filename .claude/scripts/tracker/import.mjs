// Copies the Notion backlog into the MotorFix GitHub Project, one way: an
// issue per story, feature and epic in the private motor-fix-specs (repos.mjs) that
// carries the whole page (every block, every comment, its files; a property
// only when no issue or Project field holds it), its Project fields, its
// relationships (story under its feature, feature under its epic, blocked
// by), set as each item is written, and a
// Closes line on an open story's PR. No Notion address is written: links to other stories
// and epics become #<issue> references. Pages are written while the rest are
// still being read; a page the import cannot carry in full is never written
// (listed as `incomplete`, exit 1). Every run replans from what GitHub holds,
// so an interrupted lap continues where it stopped.
//
//   node .claude/scripts/tracker/import.mjs [--dry-run] [--budget <n>] [--max-items <n>] [--refresh]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { isEntryPoint } from "../lib/entry.mjs";
import { NotionError, notionClient, notionToken } from "../lib/notion.mjs";
import { findProject, projectState } from "./bootstrap.mjs";
import { GitHubError, githubClient, MAX_PAGES } from "./github.mjs";
import * as specsRepo from "../specs-repo.mjs";
import { folderCache, folderStore, hasStoredFiles, pageLoader } from "./notion-content.mjs";
import { fileUrl, refsOf, renderPage, resolveRefs, withoutNotion } from "./notion-markdown.mjs";
import { readTracker } from "./notion-read.mjs";
import { reporter } from "./progress.mjs";
import { CODE_REPO, closesLine, ISSUE_REPO, OWNER, pullPath, specsClone } from "./repos.mjs";
import { assertProjectScope, projectToken, TokenError } from "./token.mjs";

// The template's empty closing line, cross-repository or the older same-repository form.
const PLACEHOLDER = new RegExp(`^Closes (?:${OWNER}/${ISSUE_REPO})?#[ \\t]*$`, "m");
const PULL = new RegExp(`^https://github\\.com/${OWNER}/${CODE_REPO}/pull/(\\d+)`);
const STATUSES = ["To do", "Planning", "Implementing", "Blocked", "QA", "Done"];
const EPIC_STATUS = { "To do": "To do", "In progress": "Implementing", Done: "Done" };
const PRIORITIES = ["Urgent", "Highest", "High", "Medium", "Low"];
// The field types set-fields writes; GitHub's own fields (CREATED, TITLE, …) take no value.
const WRITABLE = new Set(["SINGLE_SELECT", "DATE", "NUMBER", "TEXT"]);
// GitHub refusing a sub-issue because the parent already holds its limit.
const FULL_PARENT = /cannot have more than \d+ sub-issues/i;
const KINDS = ["create", "feature", "group", "adopt", "update", "add-item", "set-fields", "close", "reopen", "relink", "sub-issue", "move", "blocked-by", "pr-closes"];
const READERS = 4;
// A feature's key is its Notion page id, a group's names its epic (or NONE), work type and chunk: neither looks like a story's or an epic's.
const MARKER = /<!-- motorfix:((?:ST|EP)-\d+|FEATURE-[0-9a-f]{32}|GROUP-(?:EP-\d+|NONE)(?:-[a-z][a-z-]*-\d+)?) -->/;
// Set on an issue filed by hand and adopted: its title and labels stay the person's.
const ADOPTED = "<!-- motorfix:adopted -->";

/** GitHub takes 65,536 characters in an issue body; a longer page is kept whole in a file. */
export const BODY_LIMIT = 60_000;
const plainId = (id) => String(id).replaceAll("-", "").toLowerCase();
/** The number in ST-<n>, EP-<n> or a group's GROUP-EP-<n>-…; NaN for a feature or GROUP-NONE. */
const keyNumber = (key) => Number(/^(?:GROUP-)?(?:ST|EP)-(\d+)/.exec(key)?.[1]);
const featureKey = (id) => `FEATURE-${plainId(id)}`;
// A bare @name in a public issue title would notify that GitHub user.
const quiet = (title) => title.replace(/(^|\s)(@[\w-]+)/g, "$1`$2`");
const titled = (key, title) => {
  const one = (title ?? "").replace(/\s+/g, " ").trim();
  if (!one) return key;
  return new RegExp(`^${key}\\b`).test(one) ? quiet(one) : `${key} ${quiet(one)}`;
};
const lower = (names) => new Set(names.map((n) => n.toLowerCase()));
const dated = (fields, entries) => {
  for (const [name, value] of entries) if (value !== null && value !== undefined && value !== "") fields[name] = value;
  return fields;
};

/** A Project text field holds a line, not a page: longer values are cut (the body keeps them whole). */
export const TEXT_MAX = 1000;

/** A Notion property as plain data: text, a number, a checkbox, a date's { start, end }, or a list for a multi-select, relation or rollup. */
export function plainValue(prop) {
  if (!prop?.type) return null;
  const v = prop[prop.type];
  switch (prop.type) {
    case "title":
    case "rich_text":
      return (v ?? []).map((t) => t.plain_text ?? t.text?.content ?? "").join("").trim() || null;
    case "number":
      return typeof v === "number" ? v : null;
    case "url":
    case "email":
    case "phone_number":
      return v || null;
    case "select":
    case "status":
      return v?.name ?? null;
    case "multi_select":
      return (v ?? []).map((o) => o.name);
    case "relation":
      return (v ?? []).map((r) => r.id);
    case "checkbox":
      return v === true;
    case "date":
      return v?.start ? { start: v.start.slice(0, 10), end: v.end?.slice(0, 10) ?? null } : null;
    case "place":
      return v ? v.name || v.address || [v.lat, v.lon].filter((x) => x != null).join(", ") || null : null;
    case "rollup":
      if (v?.type === "number") return v.number;
      if (v?.type === "date") return plainValue({ type: "date", date: v.date });
      return (v?.array ?? []).flatMap((item) => plainValue(item) ?? []).filter((x) => x !== "" && x !== null);
    default:
      return null;
  }
}

// The Notion properties a native issue field (title, labels, assignee, milestone, state, parent, blocked by) or a Project field holds: kept out of the body.
const STORY_FIELDS = new Set(["ID", "Story", "Issue type", "Status", "Priority", "Epic", "Assignee", "Labels", "Role", "Fix version", "PR", "Feature", "Component", "Design", "Design boards", "Ready to work", "Started", "QA from", "Merged at", "Date", "Work", "Story points", "Session", "User story", "Took", "Place"]);
const EPIC_FIELDS = new Set(["ID", "Epic", "Status", "Priority", "Owner", "Release", "Track", "Timeline", "Features", "Design", "Design boards", "Goal", "Done when", "Weeks", "Story points", "Story count"]);
/** A property a field holds whole: one a text field would cut short keeps its section in the body too. */
const carriedBy = (names) => (name, prop) => {
  if (!names.has(name)) return false;
  const v = plainValue(prop);
  const text = Array.isArray(v) ? v.join(", ") : typeof v === "string" ? v : "";
  return text.replace(/\s+/g, " ").trim().length <= TEXT_MAX;
};

const DESIGN_INDEX = "docs/reference/design/index.json";
const DESIGN_HOME = "docs/reference/design/index.md";
const boardKey = (name) => String(name).replace(/^.*›\s*/, "").replace(/\s+/g, " ").trim().toLowerCase();
/** Old documentation paths the Diátaxis move retired. */
// A retired docs/ path counts only where it is a link: a Markdown link target,
// a URL or a "Docs:" line. A path named in prose is not a link to repair.
const OLD_DOC_PATH = /(?:\]\((?:[^)\s]*\/)?|https?:\/\/\S*?\/|^\s*Docs:\s*(?:\S*\/)?)(docs\/(?!(?:tutorials|how-to|reference|explanation)\/|index\.json\b)[\w.-]+)/;
const NOTION_URL = /https?:\/\/(?:[\w-]+\.)*notion\.(?:so|com|site)\b/i;
/** What in an issue body still points at Notion or an old docs/ path, one line each. */
export function staleLinks(body) {
  return String(body ?? "")
    .split("\n")
    .filter((line) => NOTION_URL.test(line) || OLD_DOC_PATH.test(line))
    .map((line) => `still links ${NOTION_URL.test(line) ? "a Notion URL" : `an old path (${OLD_DOC_PATH.exec(line)[1]})`}`);
}

/** A value for a Project text field: lists joined, one line, no Notion address, at most TEXT_MAX characters. */
const textOf = (value) => {
  if (value === null || value === undefined) return null;
  const list = Array.isArray(value) ? value : [value];
  const one = withoutNotion(list.map((x) => (typeof x === "object" ? x.start : String(x))).join(", "))
    .replace(/\s+/g, " ")
    .trim();
  if (!one) return null;
  return one.length > TEXT_MAX ? `${one.slice(0, TEXT_MAX - 1)}…` : one;
};
const firstOf = (value) => (Array.isArray(value) ? (value[0] ?? null) : value);
const numberOf = (value) => (typeof firstOf(value) === "number" ? firstOf(value) : null);
const dateOf = (value, end = false) => {
  const d = firstOf(value);
  return d && typeof d === "object" ? (end ? d.end : d.start) : null;
};

/**
 * Notion feature page id (no dashes) → its title, for every feature a story's
 * Feature or an epic's Features names, read before any page's content. A page
 * Notion will not give is left out (issuePlans names it by its id).
 */
export async function featureTitles(client, tracker) {
  const ids = new Map();
  for (const [records, name] of [
    [tracker.stories, "Feature"],
    [tracker.epics, "Features"],
  ])
    for (const r of records) for (const id of plainValue(r.properties?.[name]) ?? []) ids.set(plainId(id), id);
  const titles = new Map();
  const queue = [...ids];
  const reader = async () => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      const [plain, id] = next;
      try {
        const page = await client.request("GET", `/pages/${id}`);
        const title = plainValue(Object.values(page?.properties ?? {}).find((p) => p?.type === "title"));
        if (title) titles.set(plain, title.replace(/\s+/g, " ").trim());
      } catch (error) {
        if (!(error instanceof NotionError)) throw error;
      }
    }
  };
  await Promise.all(Array.from({ length: READERS }, reader));
  return titles;
}

/** What each story, feature and epic should be on GitHub, in import order, and what Notion held that could not be mapped. */
export function issuePlans(tracker, { subIssueMax = 100 } = {}) {
  const warnings = [];
  const seen = new Map();
  for (const r of [...tracker.stories, ...tracker.epics]) {
    if (seen.has(r.key)) throw new Error(`two Notion pages carry ${r.key}: ${seen.get(r.key)} and ${r.id}`);
    seen.set(r.key, r.id);
  }
  const epicByKey = new Map(tracker.epics.map((e) => [e.key, e]));
  const all = [...tracker.stories, ...tracker.epics];
  const keyById = new Map(all.map((r) => [plainId(r.id), r.key]));
  const titleById = new Map(all.map((r) => [plainId(r.id), `${r.key} ${r.title}`]));
  // Other pages' titles arrive as each page's content is read: looked up at render time.
  const otherTitle = (id) => {
    for (const [other, title] of tracker.titles ?? []) if (plainId(other) === plainId(id)) return title;
    return null;
  };
  const ctx = {
    keyOf: (id) => keyById.get(plainId(id)) ?? null,
    titleOf: (id) => titleById.get(plainId(id)) ?? otherTitle(id) ?? tracker.features?.get(plainId(id)) ?? null,
    userOf: (id) => tracker.users?.get(id) ?? null,
  };
  /** The URL of a feature's document in motor-fix-specs docs/ (ST-1018), or null. */
  const docLink = (id) => {
    const path = tracker.docs?.get(plainId(id));
    return path ? fileUrl(path) : null;
  };
  /** Design: where Notion names one, the mock's home in the specs repository once it is there, else Notion's value. */
  const designText = (r) => {
    const v = textOf(of(r, "Design"));
    return v && tracker.design?.size ? fileUrl(DESIGN_HOME) : v;
  };
  /**
   * Design boards: each named board's page in the specs repository, a board it
   * lacks by name. Notion joins "<canvas page>: <board>" names with " | "; a
   * board's own name may hold commas, so a comma splits only a name no board has.
   */
  const boardsText = (r) => {
    const v = of(r, "Design boards");
    if (!tracker.design?.size || v === null || v === undefined) return textOf(v);
    const board = (n) => tracker.design.get(boardKey(n));
    const names = (Array.isArray(v) ? v : [v])
      .flatMap((x) => String(x).split(/\s*[|;\n]\s*/))
      .filter(Boolean)
      .flatMap((n) => (board(n) || !n.includes(",") ? [n] : n.split(/\s*,\s*/).filter(Boolean)));
    return textOf(names.map((n) => (board(n) ? fileUrl(board(n)) : n)));
  };
  /** The body (with reference tokens), what could not be carried, and the file a too-long page is kept in. */
  const page = (r, head, carried) => {
    if (!r.content) return { body: head.join("\n"), gaps: ["the page's content was not read"], file: null };
    const rendered = renderPage({ properties: r.properties, content: r.content }, ctx, { head: [head.join("\n")], carried });
    const { body } = rendered;
    const gaps = [...rendered.gaps, ...staleLinks(body)];
    if (body.length <= BODY_LIMIT) return { body, gaps, file: null };
    const path = `tracker/${r.key}/issue.md`;
    const rest = body.slice(head.join("\n").length).trimStart();
    const cut = rest.lastIndexOf("\n", BODY_LIMIT - 1000);
    return {
      body: [head.join("\n"), `This page is longer than an issue holds: all of it is in [${path}](${fileUrl(path)}). The start:`, rest.slice(0, cut > 0 ? cut : BODY_LIMIT - 1000)].join("\n\n"),
      gaps,
      file: { path, text: `# ${titled(r.key, r.title)}\n\n${resolveRefs(rest, () => null)}\n` },
    };
  };
  /**
   * The page's body now when its content is in, else a `render()` the import
   * calls once the page has been read (body stays null until then).
   */
  const rendered = (r, head, fields) => {
    const carried = carriedBy(fields);
    const parts = { record: r, body: null, gaps: [], file: null };
    parts.render = function () {
      Object.assign(this, page(r, head, carried));
      return this;
    };
    return r.content ? { ...parts, ...page(r, head, carried) } : parts;
  };
  /** A property of the record, read whole when its content is in (Notion cuts long values short in a query). */
  const of = (r, name) => plainValue(r.content?.properties?.[name] ?? r.properties?.[name]);
  const features = (r, name = "Feature") => of(r, name) ?? [];
  /** The features' names, each with its document's link when there is one; null until every feature is named or linked. */
  const featureText = (r, name) => {
    const ids = features(r, name);
    const named = ids.map((id) => [ctx.titleOf(id), docLink(id)].filter(Boolean).join(" ")).filter(Boolean);
    return ids.length && named.length === ids.length ? textOf(named) : null;
  };
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
    const pr = s.pr?.match(PULL);
    if (s.pr && !pr) warnings.push(`${s.key} has a PR value that is not a motor-fix pull request URL; not published`);
    const featureIds = features(s);
    if (featureIds.length > 1) warnings.push(`${s.key} has ${featureIds.length} features (${featureIds.map((id) => ctx.titleOf(id) ?? featureKey(id)).join(", ")}); a sub-issue of the first`);
    return {
      key: s.key,
      title: titled(s.key, s.title),
      ...rendered(s, [`<!-- motorfix:${s.key} -->`, ...(pr ? [`PR: ${pr[0]}`] : [])], STORY_FIELDS),
      labels: [`type: ${type.toLowerCase()}`, ...(epic ? [epic] : []), ...s.labels.map((l) => `area: ${l}`), ...(s.role ? [`role: ${s.role}`] : [])],
      milestone: epicByKey.get(epic)?.release ?? null,
      assignee: s.assignee,
      state: status === "Done" ? "closed" : "open",
      // Under its first feature; a story with no feature sits under its epic.
      parent: featureIds.length ? featureKey(featureIds[0]) : (epic ?? null),
      epic: epic ?? null,
      blockers,
      pr: pr ? Number(pr[1]) : null,
      featureIds,
      type,
      get fields() {
        return dated({ Status: status }, [
          ["Priority", s.priority],
          ["Work type", type],
          ["Epic", epic],
          ["Started", s.started],
          ["QA from", s.qaFrom],
          ["Merged at", s.mergedAt],
          ["Story points", s.points],
          ["Planned start", s.plannedStart],
          ["Planned end", s.plannedEnd],
          ["Role", s.role],
          ["Release", firstOf(of(s, "Fix version")) ?? epicByKey.get(epic)?.release],
          ["Area", textOf(s.labels)],
          ["Component", textOf(of(s, "Component"))],
          ["Feature", featureText(s)],
          ["Design", designText(s)],
          ["Design boards", boardsText(s)],
          ["PR", pr ? pr[0] : null],
          ["Session", textOf(of(s, "Session"))],
          ["User story", textOf(of(s, "User story"))],
          ["Took", textOf(of(s, "Took"))],
          ["Place", textOf(of(s, "Place"))],
          ["Date", dateOf(of(s, "Date"))],
          ["Work start", dateOf(of(s, "Work"))],
          ["Work end", dateOf(of(s, "Work"), true)],
          ["Created in Notion", s.created],
        ]);
      },
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
      ...rendered(e, [`<!-- motorfix:${e.key} -->`], EPIC_FIELDS),
      labels: ["epic", ...(e.track ? [`track: ${e.track}`] : [])],
      milestone: e.release ?? null,
      assignee: e.assignee,
      state: status === "Done" ? "closed" : "open",
      parent: null,
      epic: null,
      blockers: linkable(e),
      pr: null,
      featureIds: features(e, "Features"),
      get fields() {
        return dated({ Status: status }, [
          ["Priority", e.priority],
          ["Work type", "Epic"],
          ["Epic", e.key],
          ["Planned start", e.plannedStart],
          ["Planned end", e.plannedEnd],
          ["Track", e.track],
          ["Release", e.release],
          ["Story points", numberOf(of(e, "Story points"))],
          ["Story count", numberOf(of(e, "Story count"))],
          ["Weeks", numberOf(of(e, "Weeks"))],
          ["Feature", featureText(e, "Features")],
          ["Design", designText(e)],
          ["Design boards", boardsText(e)],
          ["Goal", textOf(of(e, "Goal"))],
          ["Done when", textOf(of(e, "Done when"))],
          ["Created in Notion", e.created],
        ]);
      },
    };
  });

  // One issue per feature a story or an epic names, under the epic that holds most of its stories (an epic's Features counting as one), ties to the lowest EP.
  const votes = new Map();
  const vote = (id, epic) => {
    const plain = plainId(id);
    if (!votes.has(plain)) votes.set(plain, { id, epics: new Map(), stories: [] });
    if (epic) votes.get(plain).epics.set(epic, (votes.get(plain).epics.get(epic) ?? 0) + 1);
    return votes.get(plain);
  };
  for (const s of stories) for (const id of s.featureIds) vote(id, s.epic).stories.push(s);
  for (const e of epics) for (const id of e.featureIds) vote(id, e.key);
  const featurePlans = [...votes.values()].map(({ id, epics: counts, stories: named }) => {
    const key = featureKey(id);
    const [epic] = [...counts].sort(([a, n], [b, m]) => m - n || keyNumber(a) - keyNumber(b)).map(([k]) => k);
    let name = ctx.titleOf(id) ?? tracker.docTitles?.get(plainId(id)) ?? tracker.docs?.get(plainId(id))?.replace(/^.*\//, "").replace(/\.md$/, "");
    if (!name) {
      name = `Feature ${plainId(id).slice(0, 8)}`;
      warnings.push(`${key}: Notion gave no title for the feature page; titled ${name}`);
    }
    const link = docLink(id);
    if (!link) warnings.push(`${key}: no document in docs/index.json; its body has no Docs link`);
    const body = [`<!-- motorfix:${key} -->`, ...(link ? [`Docs: ${link}`] : [])].join("\n\n");
    const state = named.length ? (named.some((s) => s.state === "open") ? "open" : "closed") : (epics.find((e) => e.key === epic)?.state ?? "open");
    const fields = dated({}, [
      ["Work type", "Feature"],
      ["Epic", epic],
      ["Release", epicByKey.get(epic)?.release],
    ]);
    return {
      key,
      title: quiet(name.replace(/\s+/g, " ").trim()),
      record: { id, key },
      body,
      gaps: staleLinks(body),
      file: null,
      labels: ["type: feature", ...(epic ? [epic] : [])],
      milestone: null,
      // Its epic's owner, as every imported issue has someone on it.
      assignee: epicByKey.get(epic)?.assignee ?? null,
      state,
      parent: epic ?? null,
      epic: null,
      blockers: [],
      pr: null,
      featureIds: [],
      fields,
    };
  });

  const groupPlans = groupOverflow({ stories, features: featurePlans, epics, epicByKey, subIssueMax, warnings });

  const rank = (p) => {
    const i = PRIORITIES.indexOf(p.fields.Priority);
    return i === -1 ? PRIORITIES.length : i;
  };
  const byId = (a, b) => keyNumber(a.key) - keyNumber(b.key);
  const open = stories.filter((p) => p.state === "open").sort((a, b) => rank(a) - rank(b) || byId(a, b));
  const done = stories.filter((p) => p.state === "closed").sort(byId);
  const byTitle = (a, b) => a.title.localeCompare(b.title) || a.key.localeCompare(b.key);
  return { plans: [...open, ...epics.sort(byId), ...featurePlans.sort(byTitle), ...groupPlans, ...done], warnings };
}

// A group's name for the work type it holds.
const GROUP_NAMES = { Story: "Stories", Task: "Tasks", Bug: "Bugs", "Tech debt": "Tech debt", Decision: "Decisions" };
const TYPE_ORDER = Object.keys(GROUP_NAMES);
const typeSlug = (type) => type.toLowerCase().replace(/[^a-z]+/g, "-").replace(/^-+|-+$/g, "") || "other";

/**
 * GitHub holds at most `subIssueMax` sub-issues per issue. An epic whose
 * features and featureless stories would pass it keeps its features and holds
 * one group issue per work type (GROUP-EP-<n>-<type>-<chunk>) for those
 * stories, each at most `subIssueMax` stories by ID; an epic under the limit
 * is left as it is. Work with no epic sits under one "No epic" issue
 * (GROUP-NONE), itself split into type groups the same way when it would
 * pass the limit. Sets each moved story's parent; returns the group plans.
 */
function groupOverflow({ stories, features, epics, epicByKey, subIssueMax, warnings }) {
  const groups = [];
  const plan = ({ key, title, holds, epic, parent, children }) => {
    const p = {
      key,
      title: quiet(title),
      record: { id: key, key },
      body: `<!-- motorfix:${key} -->\n\n${holds}`,
      gaps: [],
      file: null,
      labels: ["type: group", ...(epic ? [epic] : [])],
      milestone: null,
      assignee: epicByKey.get(epic)?.assignee ?? OWNER,
      parent,
      epic: null,
      blockers: [],
      pr: null,
      featureIds: [],
      fields: dated({ "Work type": "Group" }, [
        ["Epic", epic],
        ["Release", epicByKey.get(epic)?.release],
      ]),
    };
    Object.defineProperty(p, "state", { enumerable: true, get: () => (children().length && children().every((c) => c.state === "closed") ? "closed" : "open") });
    groups.push(p);
    return p;
  };
  /** Moves `owner`'s featureless stories into type groups when its direct children would pass the limit. */
  const split = ({ owner, tag, label, epic, direct, featureCount, what }) => {
    if (featureCount + direct.length <= subIssueMax) return false;
    const byType = new Map();
    for (const s of [...direct].sort((a, b) => keyNumber(a.key) - keyNumber(b.key))) {
      if (!byType.has(s.type)) byType.set(s.type, []);
      byType.get(s.type).push(s);
    }
    const order = (t) => (TYPE_ORDER.includes(t) ? TYPE_ORDER.indexOf(t) : TYPE_ORDER.length);
    let made = 0;
    for (const type of [...byType.keys()].sort((a, b) => order(a) - order(b) || a.localeCompare(b))) {
      const list = byType.get(type);
      const name = GROUP_NAMES[type] ?? type;
      const chunks = Math.ceil(list.length / subIssueMax);
      for (let i = 0; i < chunks; i++) {
        const members = list.slice(i * subIssueMax, (i + 1) * subIssueMax);
        const part = chunks > 1 ? ` (${i + 1}/${chunks})` : "";
        const key = `GROUP-${tag}-${typeSlug(type)}-${i + 1}`;
        plan({
          key,
          title: `${label} · ${name}${part}`,
          holds: `${name} ${what}${chunks > 1 ? `, part ${i + 1} of ${chunks} by ID` : ""}: GitHub holds at most ${subIssueMax} sub-issues per issue.`,
          epic,
          parent: owner,
          children: () => members,
        });
        for (const s of members) s.parent = key;
        made++;
      }
    }
    if (featureCount + made > subIssueMax) warnings.push(`${label} needs ${featureCount + made} sub-issues (${featureCount} features, ${made} groups), over GitHub's ${subIssueMax}: the rest carry it by label and Epic field only`);
    return true;
  };

  for (const e of [...epics].sort((a, b) => keyNumber(a.key) - keyNumber(b.key))) {
    const direct = stories.filter((s) => s.parent === e.key);
    const featureCount = features.filter((f) => f.parent === e.key).length;
    split({ owner: e.key, tag: e.key, label: e.key, epic: e.key, direct, featureCount, what: `of ${e.key} with no feature` });
  }

  const loose = stories.filter((s) => s.parent === null);
  const looseFeatures = features.filter((f) => f.parent === null);
  if (loose.length || looseFeatures.length) {
    const NONE = "GROUP-NONE";
    const at = groups.length;
    plan({ key: NONE, title: "No epic", holds: "Every issue with no epic, and the features no epic holds.", epic: null, parent: null, children: () => [...loose, ...looseFeatures, ...groups.slice(at + 1)].filter((c) => c.parent === NONE) });
    for (const f of looseFeatures) f.parent = NONE;
    if (!split({ owner: NONE, tag: "NONE", label: "No epic", epic: null, direct: loose, featureCount: looseFeatures.length, what: "with no epic" })) for (const s of loose) s.parent = NONE;
  }
  return groups;
}

const ITEMS = `query Items($id: ID!, $after: String) { node(id: $id) { ... on ProjectV2 { items(first: 100, after: $after) { totalCount pageInfo { hasNextPage endCursor }
  nodes { id content { ... on Issue { number } } fieldValues(first: 50) { nodes {
    ... on ProjectV2ItemFieldTextValue { text field { ... on ProjectV2FieldCommon { name } } }
    ... on ProjectV2ItemFieldSingleSelectValue { name field { ... on ProjectV2FieldCommon { name } } }
    ... on ProjectV2ItemFieldDateValue { date field { ... on ProjectV2FieldCommon { name } } }
    ... on ProjectV2ItemFieldNumberValue { number field { ... on ProjectV2FieldCommon { name } } } } } } } } } }`;
// One request makes the issue, puts it in the Project and under its epic: three writes in one against GitHub's hourly content limit.
const CREATE_ISSUE =
  "mutation CreateIssue($input: CreateIssueInput!) { createIssue(input: $input) { issue { id databaseId number title body projectItems(first: 20) { nodes { id project { id } } } } } }";
const USER_ID = "query UserId($login: String!) { user(login: $login) { id } }";
const ADD_ITEM = "mutation AddItem($projectId: ID!, $contentId: ID!) { addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) { item { id } } }";

/** Every Project item: its id, issue number and field values by name. */
async function projectItems(github, id) {
  const items = [];
  for (let after = null, more = true, count = 0; more; ) {
    if (++count > MAX_PAGES) throw new GitHubError("pages", `the Project's items: more than ${MAX_PAGES} pages`);
    const page = (await github.graphql(ITEMS, { id, after })).node.items;
    for (const node of page.nodes) {
      const values = {};
      for (const v of node.fieldValues.nodes) if (v.field) values[v.field.name] = v.name ?? v.date ?? v.number ?? v.text;
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
    ["fields", absent(plans.flatMap((p) => [...Object.keys(p.fields), ...(p.featureIds?.length ? ["Feature"] : [])]), new Set(fieldNames.keys()))],
    // A field of the name that the import cannot write (one of GitHub's own, such as Created) is as good as missing.
    [
      "writable fields",
      [...new Set(plans.flatMap((p) => Object.keys(p.fields)))]
        .filter((name) => fieldNames.has(name) && !WRITABLE.has(fieldNames.get(name).dataType))
        .map((name) => `${name} (${fieldNames.get(name).dataType})`),
    ],
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

/** A promise with its resolve and reject; a rejection nobody awaits is not reported as unhandled. */
function deferred() {
  const d = {};
  d.promise = new Promise((resolve, reject) => Object.assign(d, { resolve, reject }));
  d.promise.catch(() => {});
  return d;
}

/**
 * Imports the tracker. Pages are read (by `load`, in import order) while the
 * pages already read are written: each page's create/adopt/update, add-item
 * and set-fields run as soon as it is read and carried whole, followed by its
 * sub-issue and blocked-by links to every issue that already exists; the steps
 * that need other issues (relink, close/reopen, pr-closes, and the links whose
 * other end came later) run once every page has had its turn. A page that cannot be carried whole is
 * never written: it is listed as `incomplete`, the others are still written,
 * and the run exits 1. `--dry-run` reads everything and writes nothing.
 */
export async function runImport({
  github,
  tracker,
  log = console.log,
  dryRun = false,
  budget = Infinity,
  maxItems = 1200,
  publish = async () => {},
  load = null,
  hasFiles = () => false,
  progress = () => {},
  lap = 1,
  subIssueMax = 100,
}) {
  const out = (kind, detail) => log(`${kind.padEnd(9)} ${detail}`);
  const { plans, warnings } = issuePlans(tracker, { subIssueMax });
  const total = plans.length;

  const { project, repositoryIds } = await findProject(github);
  if (!project) {
    out("failed", "run bootstrap first: no MotorFix Project");
    return 1;
  }
  const state = await projectState(github, project.id);
  const labelList = await github.pages("labels?per_page=100");
  const labels = new Set(labelList.map((l) => l.name));
  const labelId = new Map(labelList.map((l) => [l.name.toLowerCase(), l.node_id]));
  const milestoneList = await github.pages("milestones?state=all&per_page=100");
  const missing = missingSetup({ plans, labels, milestones: new Set(milestoneList.map((m) => m.title)), fields: state.fields });
  if (missing) {
    out("failed", `run bootstrap first: missing ${missing}`);
    return 1;
  }
  const milestoneNumber = new Map(milestoneList.map((m) => [m.title, m.number]));
  const milestoneId = new Map(milestoneList.map((m) => [m.title, m.node_id]));
  const userIds = new Map();
  const userId = async (login) => {
    if (!userIds.has(login)) userIds.set(login, (await github.graphql(USER_ID, { login })).user?.id ?? null);
    return userIds.get(login);
  };
  const fieldByName = new Map(state.fields.map((f) => [f.name, f]));

  const listed = (await github.pages("issues?state=all&per_page=100")).filter((i) => !i.pull_request);
  const byMarker = new Map();
  const byTitle = new Map();
  for (const issue of listed) {
    const marked = issue.body?.match(MARKER)?.[1];
    if (marked) byMarker.set(marked, issue);
    // A group's title starts with its epic's key ("EP-1 · Tasks"): only its marker names it.
    const titleKey = marked?.startsWith("GROUP-") ? null : issue.title.match(/^(?:ST|EP)-\d+\b/)?.[0];
    if (titleKey && !byTitle.has(titleKey)) byTitle.set(titleKey, issue);
  }
  const items = await projectItems(github, project.id);
  const itemOf = new Map(items.filter((it) => it.number !== null).map((it) => [it.number, it]));

  const issue = new Map();
  for (const plan of plans) {
    const found = byMarker.get(plan.key) ?? byTitle.get(plan.key);
    if (found) issue.set(plan.key, found);
  }
  const planned = new Set(plans.map((p) => p.key));
  const existing = new Set(issue.keys());
  const adopted = plans.filter((p) => existing.has(p.key) && !byMarker.has(p.key)).length;
  const incomplete = new Set();
  // Pages whose steps a transient failure ended this lap: linked only where their issue exists.
  const skipped = new Set();
  // The body as written: references resolved to the issues known now, a hand-filed issue's own text kept after ADOPTED.
  const written = new Map();
  const bodyOf = (plan, current) => {
    const own = resolveRefs(plan.body, (key) => issue.get(key)?.number ?? null);
    const at = current?.indexOf(ADOPTED) ?? -1;
    return at === -1 ? own : `${own}\n${ADOPTED}${withoutNotion(current.slice(at + ADOPTED.length))}`;
  };

  /** The steps that write the page itself; an unread page (body null) is planned without its body. */
  function pageSteps(plan) {
    const steps = [];
    const step = (kind, run) => steps.push({ kind, key: plan.key, run });
    const byMark = byMarker.get(plan.key);
    const found = existing.has(plan.key) ? issue.get(plan.key) : undefined;
    let item = found ? itemOf.get(found.number) : undefined;
    if (!found) {
      step(plan.key.startsWith("FEATURE-") ? "feature" : plan.key.startsWith("GROUP-") ? "group" : "create", async () => {
        const body = bodyOf(plan);
        const assignee = plan.assignee ? await userId(plan.assignee) : null;
        // Placed under its parent at create when the parent has room; the link steps report it when it has none.
        let parent = plan.parent && issue.has(plan.parent) && (await linksOf(subIssues, plan.parent, "sub_issues")).length < subIssueMax ? issue.get(plan.parent) : undefined;
        const create = async () =>
          (
            await github.graphql(CREATE_ISSUE, {
              input: {
                repositoryId: repositoryIds[ISSUE_REPO],
                title: plan.title,
                body,
                labelIds: plan.labels.map((l) => labelId.get(l.toLowerCase())),
                ...(plan.milestone ? { milestoneId: milestoneId.get(plan.milestone) } : {}),
                assigneeIds: assignee ? [assignee] : [],
                projectV2Ids: [project.id],
                ...(parent ? { parentIssueId: parent.node_id } : {}),
              },
            })
          ).createIssue.issue;
        let made;
        try {
          made = await create();
        } catch (error) {
          // The parent filled up since its sub-issues were listed: the issue is made beside it instead.
          if (!parent || !FULL_PARENT.test(error.message)) throw error;
          noRoom.set(plan.key, plan.parent);
          parent = undefined;
          made = await create();
        }
        issue.set(plan.key, {
          number: made.number,
          id: made.databaseId,
          node_id: made.id,
          title: made.title,
          body: made.body,
          state: "open",
          labels: plan.labels.map((name) => ({ name })),
          milestone: plan.milestone ? { title: plan.milestone } : null,
          assignees: assignee ? [{ login: plan.assignee }] : [],
        });
        written.set(plan.key, body);
        const placed = made.projectItems.nodes.find((n) => n.project.id === project.id);
        if (placed) item = { id: placed.id, values: {} };
        else {
          const added = await github.graphql(ADD_ITEM, { projectId: project.id, contentId: made.id }, { idempotent: true });
          item = { id: added.addProjectV2ItemById.item.id, values: {} };
        }
        if (parent) subIssues.get(plan.parent)?.push(made.databaseId);
        return `→ #${made.number}${parent ? ` under #${parent.number}` : ""}`;
      });
    } else {
      // A hand-filed issue keeps its title and labels; the import owns the rest.
      const byHand = !byMark || found.body?.includes(ADOPTED);
      const change = {};
      if (!byHand && found.title !== plan.title) change.title = plan.title;
      // The page as it is now, an older body (one with Notion links included) rewritten; a hand-filed issue keeps its own text below.
      const bodyChanged = byMark && plan.body !== null && found.body !== bodyOf(plan, found.body);
      const have = found.labels.map((l) => l.name);
      const haveLower = lower(have);
      if (!byHand && plan.labels.some((l) => !haveLower.has(l.toLowerCase()))) change.labels = [...have, ...plan.labels.filter((l) => !haveLower.has(l.toLowerCase()))];
      if ((found.milestone?.title ?? null) !== plan.milestone) change.milestone = plan.milestone ? milestoneNumber.get(plan.milestone) : null;
      if (plan.assignee && !found.assignees.some((a) => a.login === plan.assignee)) change.assignees = [plan.assignee];
      if (!byMark) {
        step("adopt", async () => {
          const body = bodyOf(plan, `${ADOPTED}${found.body ? `\n\n${found.body}` : ""}`);
          await github.rest("PATCH", `issues/${found.number}`, { body, ...change });
          written.set(plan.key, body);
          return `#${found.number}`;
        });
      } else if (Object.keys(change).length || bodyChanged) {
        step("update", async () => {
          const body = bodyOf(plan, found.body);
          const patch = body === found.body ? change : { ...change, body };
          await github.rest("PATCH", `issues/${found.number}`, patch);
          written.set(plan.key, patch.body ?? found.body);
          return `#${found.number} ${Object.keys(patch).join(", ")}`;
        });
      }
    }

    if (found && !item) {
      step("add-item", async () => {
        const made = await github.graphql(ADD_ITEM, { projectId: project.id, contentId: issue.get(plan.key).node_id }, { idempotent: true });
        item = { id: made.addProjectV2ItemById.item.id, values: {} };
      });
    }
    const differing = Object.entries(plan.fields).filter(([name, value]) => item?.values[name] !== value);
    if (differing.length) {
      step("set-fields", async () => {
        const variables = { projectId: project.id, itemId: item.id };
        differing.forEach(([name, value], i) => {
          const field = fieldByName.get(name);
          variables[`f${i}`] = field.id;
          variables[`v${i}`] =
            field.dataType === "SINGLE_SELECT"
              ? { singleSelectOptionId: field.options.find((o) => o.name === value).id }
              : field.dataType === "NUMBER"
                ? { number: value }
                : field.dataType === "TEXT"
                  ? { text: value }
                  : { date: value };
        });
        await github.graphql(setFieldsMutation(differing.length), variables, { idempotent: true });
        return differing.map(([name]) => name).join(", ");
      });
    }
    return steps;
  }

  // The links each issue has on GitHub, read once per issue and kept current as the run adds to them: parent key → sub-issue ids, key → blocked-by ids.
  const subIssues = new Map();
  const blockedBy = new Map();
  const linksOf = async (cache, key, path) => {
    if (!cache.has(key)) {
      const found = issue.get(key);
      cache.set(key, found ? (await github.pages(`issues/${found.number}/${path}`)).map((i) => i.id) : []);
    }
    return cache.get(key);
  };
  // GitHub holds at most subIssueMax sub-issues per parent: an issue past it carries its parent by label and field only (child key → parent key).
  const noRoom = new Map();
  // Links planned and not yet run, per parent: the children they bring in and take out, so a move frees its old parent's room before it runs.
  const pending = new Map();
  const pendingOf = (parent) => {
    if (!pending.has(parent)) pending.set(parent, { in: new Set(), out: new Set() });
    return pending.get(parent);
  };
  const planOf = new Map(plans.map((p) => [p.key, p]));
  const fullWarnings = () => {
    const full = new Map();
    for (const [child, parent] of noRoom) full.set(parent, (full.get(parent) ?? 0) + 1);
    return [...full].map(([parent, n]) =>
      parent.startsWith("FEATURE-")
        ? `${planOf.get(parent)?.title} (${parent}) holds ${subIssueMax} sub-issues, GitHub's limit: ${n} of its stories carry it by the Feature field only`
        : `${parent} holds ${subIssueMax} sub-issues, GitHub's limit: ${n} of its sub-issues carry it by label and Epic field only`,
    );
  };
  const subIssueStep = (child, parent, have, from) => ({
    kind: from ? "move" : "sub-issue",
    key: child,
    run: async () => {
      const number = issue.get(parent).number;
      const id = issue.get(child).id;
      try {
        // The child's create may have placed it under its parent already.
        if (have.includes(id)) return `under #${number} at create`;
        if (have.length >= subIssueMax) {
          noRoom.set(child, parent);
          return `left out of full #${number}`;
        }
        // An issue has one parent: replace_parent moves one the import put under its epic before it had features.
        try {
          await github.rest("POST", `issues/${number}/sub_issues`, { sub_issue_id: id, replace_parent: true }, { idempotent: true });
        } catch (error) {
          if (!FULL_PARENT.test(error.message)) throw error;
          noRoom.set(child, parent);
          return `left out of full #${number}`;
        }
        for (const [key, ids] of subIssues) if (key !== parent && ids.includes(id)) ids.splice(ids.indexOf(id), 1);
        have.push(id);
        noRoom.delete(child);
        return from ? `from #${issue.get(from).number} to #${number}` : `under #${number}`;
      } finally {
        pending.get(parent)?.in.delete(child);
        if (from) pending.get(from)?.out.delete(child);
      }
    },
  });
  /**
   * Plans the child's link under its parent: nothing when it is there, a move
   * when it sits under its epic (where the import put stories before
   * features), and nothing but a noRoom entry when the parent would be full.
   */
  const planLink = async (steps, child, parent) => {
    const have = await linksOf(subIssues, parent, "sub_issues");
    if (linked(have, child)) return;
    const epic = planOf.get(child)?.epic;
    const from = epic && epic !== parent && issue.has(epic) && issue.has(child) && (await linksOf(subIssues, epic, "sub_issues")).includes(issue.get(child).id) ? epic : null;
    const room = pendingOf(parent);
    if (have.length + room.in.size - room.out.size >= subIssueMax) {
      noRoom.set(child, parent);
      return;
    }
    room.in.add(child);
    if (from) pendingOf(from).out.add(child);
    steps.push(subIssueStep(child, parent, have, from));
  };
  const blockedByStep = (blocked, blocker, have) => ({
    kind: "blocked-by",
    key: blocked,
    run: async () => {
      const id = issue.get(blocker).id;
      await github.rest("POST", `issues/${issue.get(blocked).number}/dependencies/blocked_by`, { issue_id: id }, { idempotent: true });
      have.push(id);
      return blocker;
    },
  });
  const linked = (have, key) => issue.has(key) && have.includes(issue.get(key).id);

  /**
   * The item's relationships whose other end already has an issue, run right
   * after the item's own steps: its parent and the children that exist, its
   * blockers and the items it blocks (GitHub shows Blocking from those).
   */
  async function linkSteps(plan) {
    const steps = [];
    const self = plan.key;
    // Its children first: a story moving from its epic to this feature makes room for the feature under that epic.
    const families = [...plans.filter((c) => c.parent === self && issue.has(c.key)).map((c) => [c.key, self]), ...(plan.parent && issue.has(plan.parent) ? [[self, plan.parent]] : [])];
    for (const [child, parent] of families) await planLink(steps, child, parent);
    const pairs = [...plan.blockers.filter((b) => issue.has(b)).map((b) => [self, b]), ...plans.filter((d) => d.blockers.includes(self) && issue.has(d.key)).map((d) => [d.key, self])];
    for (const [blocked, blocker] of pairs) {
      const have = await linksOf(blockedBy, blocked, "dependencies/blocked_by");
      if (!linked(have, blocker)) steps.push(blockedByStep(blocked, blocker, have));
    }
    return steps;
  }

  /** The steps that need other issues: planned once every page has had its turn (and, for the plan line, before). */
  async function lateSteps(report) {
    const steps = [];
    const step = (kind, key, run) => steps.push({ kind, key, run });
    const ok = (key) => !incomplete.has(key) && !skipped.has(key) && plans.find((p) => p.key === key)?.body !== null;
    for (const plan of plans) {
      if (!ok(plan.key)) continue;
      const current = issue.get(plan.key)?.state ?? "open";
      if (current === plan.state) continue;
      const kind = plan.state === "closed" ? "close" : "reopen";
      step(kind, plan.key, async () => {
        const number = issue.get(plan.key).number;
        await github.rest("PATCH", `issues/${number}`, plan.state === "closed" ? { state: "closed", state_reason: "completed" } : { state: "open" });
        return `#${number}`;
      });
    }
    // A body naming an item this run creates is written again once that item has its number.
    for (const plan of plans) {
      if (!ok(plan.key) || !refsOf(plan.body).some((key) => planned.has(key) && !existing.has(key))) continue;
      step("relink", plan.key, async () => {
        const current = written.get(plan.key) ?? issue.get(plan.key).body;
        const body = bodyOf(plan, current);
        if (body === current) return "unchanged";
        const number = issue.get(plan.key).number;
        await github.rest("PATCH", `issues/${number}`, { body });
        written.set(plan.key, body);
        return `#${number}`;
      });
    }

    // What the items' own steps did not link: an end written after the other, or one a network error held back. An end that will not exist is not linked this run.
    const absent = (key) => (incomplete.has(key) || skipped.has(key)) && !issue.has(key);
    for (const plan of plans.filter((p) => p.parent)) {
      if (absent(plan.key) || absent(plan.parent)) continue;
      await planLink(steps, plan.key, plan.parent);
    }
    for (const plan of plans.filter((p) => p.blockers.length)) {
      if (absent(plan.key)) continue;
      const have = await linksOf(blockedBy, plan.key, "dependencies/blocked_by");
      for (const blocker of plan.blockers) if (!absent(blocker) && !linked(have, blocker)) steps.push(blockedByStep(plan.key, blocker, have));
    }
    for (const plan of plans.filter((p) => p.pr && p.state === "open")) {
      if (incomplete.has(plan.key) || absent(plan.key)) continue;
      let pull;
      try {
        pull = await github.rest("GET", pullPath(plan.pr));
      } catch (error) {
        if (!(error instanceof GitHubError && error.type === "404")) throw error;
        report(`${plan.key} names PR #${plan.pr}, which GitHub does not have; no Closes line`);
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
    return steps;
  }

  const counted = (steps) => {
    const counts = Object.fromEntries(KINDS.map((k) => [k, 0]));
    for (const s of steps) counts[s.kind]++;
    return counts;
  };
  const planLine = (counts, unread) =>
    out("plan", `${KINDS.map((k) => `${k} ${counts[k]}`).join(" · ")}${unread ? `; ${unread} pages still to read, their updates and relinks counted as they are read` : ""}`);
  const bodiesLine = () => {
    const ready = plans.filter((p) => p.body !== null);
    const files = ready.filter((p) => p.file).length;
    out("bodies", `${ready.length} pages, ${ready.reduce((n, p) => n + p.body.length, 0).toLocaleString("en-US")} characters; ${files} too long for an issue, kept whole under tracker/`);
  };

  // The reader: pages the cache answers first (at once), then the rest in import order; each page is ready to write as soon as it is read.
  const ready = plans.map(() => false);
  let readError = null;
  let wake = deferred();
  const woken = () => {
    const was = wake;
    wake = deferred();
    was.resolve();
  };
  let read = 0;
  let fetched = 0;
  let writtenPages = 0;
  let stopReading = false;
  const status = (extra = {}) => progress({ read, total, written: writtenPages, lap, ...extra });
  const order = [...plans.keys()];
  if (load?.cached) {
    const quick = (i) => plans[i].body !== null || plans[i].record.content || load.cached(plans[i].record);
    const first = new Set(order.filter(quick));
    order.splice(0, order.length, ...first, ...order.filter((i) => !first.has(i)));
  }
  // Pages are read READERS at a time (Notion answers each page's block tree in
  // many round trips); writes stay one at a time for GitHub's content limit.
  let cursor = 0;
  const reader = async () => {
    for (;;) {
      if (stopReading || readError || cursor >= order.length) return;
      const i = order[cursor++];
      const plan = plans[i];
      try {
        if (plan.body === null) {
          if (load && !plan.record.content && (await load(plan.record))) fetched++;
          plan.render();
        }
      } catch (error) {
        readError = error;
        woken();
        return;
      }
      read++;
      status({ key: plan.key, event: "read" });
      ready[i] = true;
      woken();
    }
  };
  const reading = Promise.all(Array.from({ length: READERS }, reader));
  /** The first page in import order that is read and not yet written, waiting for the reader when none is; null when all are done. */
  const taken = plans.map(() => false);
  const nextPage = async () => {
    for (;;) {
      const i = taken.findIndex((t, j) => !t && ready[j]);
      if (i !== -1) return i;
      if (taken.every(Boolean)) return null;
      if (readError) throw readError;
      await wake.promise;
    }
  };
  const stop = async () => {
    stopReading = true;
    await reading;
  };

  out("read", `notion: ${tracker.stories.length} stories, ${tracker.epics.length} epics (${tracker.skippedRows ?? 0} timeline rows without a story skipped)`);
  out("read", `github: ${listed.length} issues listed, ${byMarker.size} matched by marker, ${adopted} by title; project items ${items.length} of max ${maxItems}`);
  const lateWarnings = [];
  let expected = 0;
  if (!dryRun) {
    // What is known before the first write: every page's own steps (unread bodies not compared) and the linking steps.
    const unread = plans.filter((p) => p.body === null).length;
    const upfront = [...plans.flatMap(pageSteps), ...(await lateSteps((w) => lateWarnings.push(w)))];
    const counts = counted(upfront);
    // Those steps only count: the room they planned is planned again as each runs.
    pending.clear();
    noRoom.clear();
    planLine(counts, unread);
    for (const w of [...tracker.warnings, ...warnings, ...lateWarnings]) out("warn", w);
    if (!unread) bodiesLine();
    // A create puts its issue in the Project, so it adds an item as an add-item does.
    const adding = counts["add-item"] + counts.create + counts.feature + counts.group;
    if (items.length + adding > maxItems) {
      await stop();
      out("refused", `the Project would hold ${items.length + adding} items, over --max-items ${maxItems}`);
      return 2;
    }
    expected = upfront.length;
  }

  let ran = 0;
  let last = null;
  const stopped = async () => {
    await stop();
    out("stopped", `${last ? `after ${last}` : "before the first step"} (${ran} of ${Math.max(expected, ran).toLocaleString("en-US")} steps, budget ${budget} reached)`);
    out("continue", `node .claude/scripts/tracker/import.mjs --budget ${budget}`);
    return 3;
  };
  /**
   * Runs steps within the budget: true when all ran (or a transient failure
   * ended the page's steps), else the exit code. A network error, timeout or
   * 5xx that outlasted the client's retries ends that page's steps (`page`),
   * or that one step; the run goes on and ends with exit 3, since the next lap
   * replans from GitHub. Any other GitHub refusal stops the run (exit 1).
   */
  const runSteps = async (steps, { page = false } = {}) => {
    for (const [j, s] of steps.entries()) {
      if (ran >= budget) return stopped();
      status({ key: s.key, event: "step", step: j + 1, steps: steps.length, kind: s.kind });
      ran++;
      try {
        const detail = await s.run();
        out(s.kind, `${s.key}${detail ? ` ${detail}` : ""}`);
      } catch (error) {
        if (!(error instanceof GitHubError)) throw error;
        if (!error.transient) {
          await stop();
          out("failed", `${s.key} ${s.kind}: ${error.message}`);
          return 1;
        }
        transient.push(`${s.key} ${s.kind}`);
        out("retry", `${s.key} ${s.kind}: ${error.message}; ${page ? "the page's other steps wait for" : "tried again on"} the next lap`);
        if (page) {
          skipped.add(s.key);
          return true;
        }
        continue;
      }
      last = s.key;
    }
    return true;
  };
  const transient = [];

  const all = [];
  let parts = 0;
  for (let i = await nextPage(); i !== null; i = await nextPage()) {
    const plan = plans[i];
    taken[i] = true;
    if (plan.gaps.length) {
      incomplete.add(plan.key);
      parts += plan.gaps.length;
      for (const g of plan.gaps) out("incomplete", `${plan.key} ${g}`);
      continue;
    }
    const steps = pageSteps(plan);
    if (dryRun) {
      all.push(...steps);
      continue;
    }
    if (steps.length && (plan.file || hasFiles(plan.record))) await publish(plan.file ? [plan.file] : [], plan.key);
    const result = await runSteps([...steps, ...(await linkSteps(plan))], { page: true });
    if (result !== true) return result;
    if (!skipped.has(plan.key)) writtenPages++;
  }
  await reading;
  if (load) out("read", `notion: ${read} pages' content, ${fetched} read from Notion, the rest from the cache`);

  if (dryRun) {
    all.push(...(await lateSteps((w) => lateWarnings.push(w))));
    planLine(counted(all), 0);
    for (const w of [...tracker.warnings, ...warnings, ...lateWarnings, ...fullWarnings()]) out("warn", w);
    bodiesLine();
    if (parts) {
      out("failed", `${parts} part(s) of Notion pages would be left behind; nothing written`);
      return 1;
    }
    out("titles", `(${plans.length})`);
    for (const p of plans) log(`          ${p.title}`);
    return 0;
  }

  const seen = new Set(lateWarnings);
  const late = await lateSteps((w) => {
    if (!seen.has(w)) out("warn", w);
  });
  const result = await runSteps(late);
  if (result !== true) return result;
  if (transient.length) {
    out("stopped", `after network errors on ${transient.length} step(s) (${transient.slice(0, 3).join(", ")}${transient.length > 3 ? ", …" : ""}); the next lap replans them from GitHub`);
    out("continue", `node .claude/scripts/tracker/import.mjs${Number.isFinite(budget) ? ` --budget ${budget}` : ""}`);
    return 3;
  }
  if (parts) {
    out("failed", `${parts} part(s) of Notion pages left behind: ${incomplete.size} page(s) not written, the other ${plans.length - incomplete.size} written`);
    return 1;
  }
  for (const w of fullWarnings()) out("warn", w);
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

/**
 * Notion page id (no dashes) → repository path of its document, from the
 * docs/index.json in the specs repository ({ exported, files }); a page with
 * no file of its own maps to null and is left out.
 */
export function docsIndex(clone) {
  const file = join(clone, "docs", "index.json");
  if (!existsSync(file)) return new Map();
  const data = JSON.parse(readFileSync(file, "utf8"));
  const entries = Object.entries(data?.files ?? {});
  return new Map(
    entries
      .filter(([id, path]) => id && typeof path === "string" && existsSync(join(clone, path.startsWith("docs/") ? path : `docs/${path}`)))
      .map(([id, path]) => [plainId(id), path.startsWith("docs/") ? path : `docs/${path}`]),
  );
}

/**
 * Notion page id (no dashes) → its document's title: the front matter's
 * `title:`, else its first `# ` heading; a document with neither, or gone, is left out.
 */
export function docTitles(clone, docs) {
  const titles = new Map();
  for (const [id, path] of docs ?? []) {
    const file = join(clone, path);
    if (!existsSync(file)) continue;
    const text = readFileSync(file, "utf8");
    const front = /^---\n([\s\S]*?)\n---/.exec(text)?.[1];
    const raw = /^title:\s*(.+)$/m.exec(front ?? "")?.[1] ?? /^#\s+(.+)$/m.exec(text)?.[1];
    const title = raw?.trim().replace(/^(["'])(.*)\1$/, "$2").replace(/\s+/g, " ").trim();
    if (title) titles.set(id, title);
  }
  return titles;
}

/**
 * The mock's boards in the specs repository: lower-cased title, and
 * "<canvas page>: <title>" as Notion names it, → the board page's path, from
 * docs/reference/design/index.json; empty without it.
 */
export function designIndex(clone) {
  const file = join(clone, DESIGN_INDEX);
  if (!existsSync(file)) return new Map();
  const boards = JSON.parse(readFileSync(file, "utf8"));
  return new Map((Array.isArray(boards) ? boards : []).filter((b) => b.title && b.md && existsSync(join(clone, b.md))).flatMap((b) => [[boardKey(b.title), b.md], ...(b.canvasPage ? [[boardKey(`${b.canvasPage}: ${b.title}`), b.md]] : [])]));
}

/** The lap this run is, counted in the cache folder until a run ends `done`; a dry run is lap 0 and counts nothing. */
function nextLap(dir, dryRun, reset = false) {
  if (dryRun) return 0;
  const file = join(dir, "lap.json");
  let lap = 0;
  try {
    lap = JSON.parse(readFileSync(file, "utf8")).lap ?? 0;
  } catch {
    lap = 0;
  }
  const next = reset ? 0 : lap + 1;
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, JSON.stringify({ lap: next }));
  return next;
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
    const dryRun = argv.includes("--dry-run");
    const report = reporter({ writing: !dryRun });
    const github = githubClient({ token: projectToken(), log: report.log });
    report.log(`${"token".padEnd(9)} ${await assertProjectScope(github)}, project scope`);
    const root = fileURLToPath(new URL("../../../", import.meta.url));
    const clone = specsClone(root, specsRepo);
    if (!existsSync(join(clone, ".git"))) throw new NotionError("no clone", `no clone of ${ISSUE_REPO} at ${clone}: node .claude/scripts/specs-repo.mjs ensure`);
    const client = notionClient({ token: notion });
    const tracker = await readTracker(client);
    tracker.features = await featureTitles(client, tracker);
    tracker.docs = docsIndex(clone);
    tracker.docTitles = docTitles(clone, tracker.docs);
    tracker.design = designIndex(clone);
    const store = folderStore(clone);
    const cacheDir = join(homedir(), ".cache", "motorfix-tracker");
    const lap = nextLap(cacheDir, dryRun);
    const load = pageLoader(client, tracker, { cache: folderCache(join(cacheDir, "pages")), store, refresh: argv.includes("--refresh"), log: report.log });
    const publish = async (files) => {
      for (const f of files) store.write(f.path, f.text);
      const done = specsRepo.commit({ root, message: "docs(tracker): ST-1017 page files for the imported issues", paths: ["tracker"] });
      if (!done.ok) throw new GitHubError("specs", `could not push tracker/ to ${ISSUE_REPO}: ${done.error}`);
    };
    try {
      process.exitCode = await runImport({ github, tracker, dryRun, budget, maxItems, publish, load, hasFiles: hasStoredFiles, log: report.log, progress: report.progress, lap });
    } finally {
      report.end();
    }
    if (!dryRun && process.exitCode === 0) nextLap(cacheDir, dryRun, true);
  } catch (error) {
    if (!(error instanceof TokenError || error instanceof GitHubError || error instanceof NotionError)) throw error;
    console.error(error.message);
    process.exitCode = 1;
  }
}

if (isEntryPoint(import.meta.url)) await main();
