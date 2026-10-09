// Reads the backlog the GitHub import needs from Notion: stories, epics and
// the epics' build-timeline rows, from their properties. Each item keeps its
// raw properties and last edit; notion-content.mjs reads the page bodies.
import { readProp } from "../lib/notion.mjs";
import { STORIES } from "../notion-sync.mjs";

const EPICS = "ca8cf981-a8f2-4cb6-9c9a-ac1a3df0edac";
const OWNER_LOGIN = "george-hutanu";

const day = (value) => value?.start?.slice(0, 10) ?? null;
const names = (value) => (value ?? []).map((v) => v.name);
const people = (value) => (value ?? []).map((p) => p.id);

export async function readTracker(client) {
  const warnings = [];
  const everyone = (await client.request("GET", "/users")).results;
  const users = new Map(everyone.map((u) => [u.id, u.name ?? null]));
  const persons = everyone.filter((u) => u.type === "person");
  const ownerId = persons.length === 1 ? persons[0].id : null;
  const unassigned = [];
  const assignee = (key, ids) => {
    if (!ids.length) return null;
    if (ids[0] === ownerId) return OWNER_LOGIN;
    unassigned.push(key);
    return null;
  };

  const epicPages = await client.query(EPICS);
  const epicKey = new Map(epicPages.map((p) => [p.id, readProp(p, "ID")]));
  const epics = epicPages.map((p) => {
    const key = readProp(p, "ID");
    const timeline = readProp(p, "Timeline");
    if (!timeline?.start) warnings.push(`${key} has no Timeline; no planned dates`);
    return {
      id: p.id,
      key,
      properties: p.properties,
      lastEdited: p.last_edited_time ?? null,
      title: readProp(p, "Epic").trim(),
      status: readProp(p, "Status"),
      priority: readProp(p, "Priority"),
      release: readProp(p, "Release"),
      track: readProp(p, "Track"),
      plannedStart: day(timeline),
      plannedEnd: timeline?.end?.slice(0, 10) ?? null,
      blockers: (readProp(p, "Blocked by") ?? []).map((id) => epicKey.get(id)).filter(Boolean),
      assignee: assignee(key, people(readProp(p, "Owner"))),
    };
  });

  const stories = (await client.query(STORIES)).map((p) => {
    const key = readProp(p, "ID");
    return {
      id: p.id,
      key,
      properties: p.properties,
      lastEdited: p.last_edited_time ?? null,
      title: readProp(p, "Story").trim(),
      type: readProp(p, "Issue type"),
      status: readProp(p, "Status"),
      priority: readProp(p, "Priority"),
      epics: (readProp(p, "Epic") ?? []).map((id) => epicKey.get(id)).filter(Boolean),
      feature: readProp(p, "Feature")?.[0] ?? null,
      started: day(readProp(p, "Started")),
      qaFrom: day(readProp(p, "QA from")),
      mergedAt: day(readProp(p, "Merged at")),
      points: readProp(p, "Story points"),
      pr: readProp(p, "PR"),
      assignee: assignee(key, people(readProp(p, "Assignee"))),
      labels: names(readProp(p, "Labels")),
      role: readProp(p, "Role"),
      blockers: [],
      plannedStart: null,
      plannedEnd: null,
    };
  });
  const storyById = new Map(stories.map((s) => [s.id, s]));
  const storyByKey = new Map(stories.map((s) => [s.key, s]));

  let skippedRows = 0;
  for (const epic of epics) {
    const suffix = `(${epic.key}) — build timeline`;
    const found = await client.request("POST", "/search", { query: suffix, filter: { property: "object", value: "data_source" } });
    const source = found.results.find((d) => (d.title ?? []).map((t) => t.plain_text).join("").endsWith(suffix));
    if (!source) continue;
    const rows = await client.query(source.id);
    const storyOf = new Map(
      rows.map((r) => [r.id, storyById.get(readProp(r, "Story")?.[0]) ?? storyByKey.get(readProp(r, "ST")?.trim()) ?? null]),
    );
    for (const row of rows) {
      const story = storyOf.get(row.id);
      if (!story) {
        skippedRows++;
        continue;
      }
      story.plannedStart = day(readProp(row, "Start"));
      story.plannedEnd = day(readProp(row, "End"));
      for (const id of readProp(row, "Blocked by") ?? []) {
        const blocker = storyOf.get(id);
        if (blocker) story.blockers.push(blocker.key);
        else {
          const item = rows.find((r) => r.id === id);
          warnings.push(`${story.key} is blocked by timeline row "${item ? readProp(item, "Item") : id}", which has no story; not linked`);
        }
      }
    }
  }
  if (unassigned.length) {
    const reason = ownerId ? "is not the owner" : `cannot be matched: the workspace has ${persons.length ? "more than one person" : "no person"}`;
    warnings.push(`${unassigned.length} item(s) left unassigned: the assignee ${reason} (first: ${unassigned[0]})`);
  }
  return { stories, epics, warnings, skippedRows, users };
}
