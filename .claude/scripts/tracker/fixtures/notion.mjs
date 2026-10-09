// A small Notion backlog for the tracker specs, in the API's page shape, and a
// fetch that serves it the way the Notion API does. The property names and
// types are those of the stories, epics and build-timeline data sources.

export const STORIES_DS = "326eee3c-abec-41d9-9f96-eb3bd545a802";
export const EPICS_DS = "ca8cf981-a8f2-4cb6-9c9a-ac1a3df0edac";
export const OWNER = "aaaaaaaa-0000-0000-0000-000000000001";
export const SECRET = "PRIVATE PAGE TEXT";

const pid = (kind, n) => `${kind}0000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
export const storyId = (n) => pid("5", n);
export const epicId = (n) => pid("e", n);
const rowId = (n) => pid("7", n);

const title = (v) => ({ type: "title", title: [{ plain_text: v }] });
const rich = (v) => ({ type: "rich_text", rich_text: v ? [{ plain_text: v }] : [] });
const select = (v) => ({ type: "select", select: v ? { name: v } : null });
const relation = (ids) => ({ type: "relation", relation: ids.map((id) => ({ id })) });
const date = (start, end = null) => ({ type: "date", date: start ? { start, end, time_zone: null } : null });
const people = (ids) => ({ type: "people", people: ids.map((id) => ({ object: "user", id })) });

function story(n, s) {
  return {
    object: "page",
    id: storyId(n),
    properties: {
      Story: title(s.title),
      ID: { type: "unique_id", unique_id: { prefix: "ST", number: n } },
      "Issue type": select(s.type),
      Status: select(s.status),
      Priority: select(s.priority ?? null),
      Epic: relation((s.epics ?? []).map(epicId)),
      Feature: relation(s.feature ? [s.feature] : []),
      "Ready to work": { type: "checkbox", checkbox: false },
      Started: date(s.started ?? null),
      "QA from": date(s.qaFrom ?? null),
      "Merged at": date(s.mergedAt ?? null),
      "Story points": { type: "number", number: s.points ?? null },
      PR: { type: "url", url: s.pr ?? null },
      Assignee: people(s.assignee ? [s.assignee] : []),
      Labels: { type: "multi_select", multi_select: (s.labels ?? []).map((name) => ({ name })) },
      Role: select(s.role ?? null),
      "User story": rich(SECRET),
      Took: rich(SECRET),
    },
  };
}

function epic(n, e) {
  return {
    object: "page",
    id: epicId(n),
    properties: {
      Epic: title(e.title),
      ID: { type: "unique_id", unique_id: { prefix: "EP", number: n } },
      Status: select(e.status),
      Priority: select(e.priority),
      Release: select(e.release),
      Track: select(e.track),
      Timeline: date(e.start ?? null, e.end ?? null),
      "Blocked by": relation((e.blockedBy ?? []).map(epicId)),
      Owner: people([OWNER]),
      Goal: rich(SECRET),
      "Done when": rich(SECRET),
    },
  };
}

function row(n, r) {
  return {
    object: "page",
    id: rowId(n),
    properties: {
      Item: title(r.item),
      ST: rich(r.st ?? ""),
      Story: relation(r.story ? [storyId(r.story)] : []),
      "Blocked by": relation((r.blockedBy ?? []).map(rowId)),
      Start: date(r.start ?? null),
      End: date(r.end ?? null),
      "Build status": select("Not started"),
    },
  };
}

const PR = "https://github.com/george-hutanu/motor-fix/pull/";

export const STORIES = [
  story(1, { title: "Driver signs in", type: "Story", status: "To do", priority: "Medium", epics: [1], labels: ["front end"], role: "Driver", assignee: OWNER, points: 3, feature: "f0000000-0000-0000-0000-000000000001" }),
  story(2, { title: "Garage edits opening hours", type: "Task", status: "Implementing", priority: "Urgent", epics: [2], labels: ["backend"], role: "Garage", started: "2026-10-01T09:00:00.000+03:00", pr: `${PR}50`, assignee: "bbbbbbbb-0000-0000-0000-000000000009" }),
  story(3, { title: "ST-3 Fix the sign-in loop", type: "Bug", status: "Done", priority: "High", epics: [1], qaFrom: "2026-09-20", mergedAt: "2026-09-21", pr: `${PR}40` }),
  story(4, { title: "Ask @alice about the logs", type: "Tech debt", status: "To do", priority: "Low" }),
  story(5, { title: "Pick a map provider", type: "Decision", status: "Blocked", priority: "Highest", epics: [1, 2] }),
  story(6, { title: "Odd status", type: "Story", status: "In review", epics: [17] }),
  story(7, { title: "Driver signs out", type: "Story", status: "To do", priority: "High", epics: [1] }),
  story(8, { title: "Driver resets a password", type: "Story", status: "To do", priority: "Medium", epics: [1] }),
];

export const EPICS = [
  epic(1, { title: "Foundations", status: "In progress", priority: "Highest", release: "1 - Launch", track: "Platform", start: "2026-10-12", end: "2026-12-04" }),
  epic(2, { title: "Garage side", status: "To do", priority: "High", release: "2 - Soon after", track: "Garage side", start: "2026-12-07", end: "2027-03-05", blockedBy: [1] }),
  epic(3, { title: "Old launch", status: "Done", priority: "Medium", release: "3 - Later", track: "Driver side", start: "2026-01-05", end: "2026-02-06" }),
  epic(17, { title: "Observability", status: "In progress", priority: "High", release: "1 - Launch", track: "Platform" }),
];

const TIMELINES = {
  1: {
    id: "d0000000-0000-0000-0000-000000000001",
    rows: [
      row(1, { item: "Sign in", story: 1, start: "2026-10-12", end: "2026-10-16" }),
      row(3, { item: "Sign-in loop", st: "ST-3" }),
      row(7, { item: "Sign out", story: 7, blockedBy: [1] }),
      row(8, { item: "Reset", story: 8, blockedBy: [3, 99] }),
      row(99, { item: "Repo scaffold" }),
    ],
  },
  2: { id: "d0000000-0000-0000-0000-000000000002", rows: [row(2, { item: "Hours", story: 2 })] },
  3: { id: "d0000000-0000-0000-0000-000000000003", rows: [] },
};

const EPIC_TITLES = { 1: "Foundations", 2: "Garage side", 3: "Old launch", 17: "Observability" };

/** A fetch that answers the Notion API from the backlog above, and every request it saw. */
export function fakeNotion({ failOn, users } = {}) {
  const requests = [];
  const ok = (data) => new Response(JSON.stringify(data), { status: 200, headers: { "content-type": "application/json" } });
  const list = (results) => ok({ object: "list", results, has_more: false, next_cursor: null });
  async function fetchImpl(url, init = {}) {
    const path = new URL(url).pathname.replace(/^\/v1/, "");
    const method = init.method ?? "GET";
    const body = init.body ? JSON.parse(init.body) : {};
    requests.push({ method, path, body });
    if (failOn && path.includes(failOn)) return new Response(JSON.stringify({ code: "object_not_found", message: "gone" }), { status: 404 });
    const ds = path.match(/^\/data_sources\/([^/]+)\/query$/)?.[1];
    if (ds === STORIES_DS) return list(STORIES);
    if (ds === EPICS_DS) return list(EPICS);
    const timeline = Object.values(TIMELINES).find((t) => t.id === ds);
    if (timeline) return list(timeline.rows);
    if (path === "/search") {
      const found = Object.entries(TIMELINES)
        .map(([n, t]) => ({ object: "data_source", id: t.id, title: [{ plain_text: `${EPIC_TITLES[n]} (EP-${n}) — build timeline` }] }))
        .filter((d) => d.title[0].plain_text.includes(body.query));
      return list(found);
    }
    if (path === "/users") {
      return list(
        users ?? [
          { object: "user", id: OWNER, type: "person", name: "George" },
          { object: "user", id: "cccccccc-0000-0000-0000-000000000001", type: "bot", name: "Integration" },
        ],
      );
    }
    return new Response(JSON.stringify({ code: "object_not_found", message: "no fake" }), { status: 404 });
  }
  return { fetchImpl, requests };
}
