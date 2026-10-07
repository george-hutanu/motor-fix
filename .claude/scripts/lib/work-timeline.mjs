// The owner's "Work timeline": one row per task in the database on the page
// "Live work timeline" (Delivery › Plans), and the same timing on the story
// page itself. Each lifecycle step of notion-sync.mjs writes both. It fails
// open: whatever goes wrong comes back as the log text, never as a throw.
// Session is the owner's and is never written.
import { NotionError, readProp, richText } from "./notion.mjs";

export const WORK_TIMELINE = "3706e923-2faa-42bc-aab2-8a2d5ab5d9d3";
export const WORK_TIMELINE_VERSION = "2025-09-03";

const STATE = { start: "In progress", implement: "In progress", qa: "QA", finish: "Merged", blocked: "Blocked" };
const ICON = { "In progress": "🔨", QA: "🧪", Merged: "✅", Blocked: "⛔" };
const SPAN_MS = 2 * 3600e3;

const duration = (from, to) => {
  const m = Math.max(0, Math.floor((new Date(to) - new Date(from)) / 60000));
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`;
};
const dateOf = (page, name) => readProp(page, name)?.start ?? null;
const dateProp = (start) => ({ date: { start } });

/** The step's state and timing, from the story's dates (else the row's). */
function timing(event, story, row, now) {
  const at = now.toISOString();
  const known = (name) => dateOf(story, name) ?? dateOf(row, name);
  let started = known("Started");
  let qa = known("QA from");
  let merged = known("Merged at");
  if (event === "start" || event === "implement") started ??= at;
  if (event === "qa") qa ??= at;
  if (event === "finish") merged = at;
  const state = event === "unblock" ? (qa ? "QA" : "In progress") : STATE[event];
  const range = { start: started ?? at, end: state === "Merged" && merged ? merged : new Date(now.getTime() + SPAN_MS).toISOString() };
  let took = null;
  if (started && state === "Merged") took = `${duration(started, merged)} total · build ${duration(started, qa ?? merged)} · QA ${duration(qa ?? merged, merged)}`;
  else if (started && state === "QA") took = `build ${duration(started, qa)} · in QA ${duration(qa, at)}`;
  else if (started) took = `${duration(started, at)} so far`;
  const dates = {
    ...(started && { Started: dateProp(started) }),
    ...(qa && { "QA from": dateProp(qa) }),
    ...(merged && { "Merged at": dateProp(merged) }),
    ...(took && { Took: { rich_text: richText(took) } }),
  };
  return { state, range, dates };
}

const failure = (error) => `failed — ${error?.short ?? error?.message ?? error}`;

/**
 * Upserts the row whose Key is `key` and writes the timing onto `story`.
 * `client` speaks the stories' API version, `timelineClient` the Work timeline's.
 * Returns the log text, or null when the step writes nothing.
 */
export async function syncWorkTimeline(args) {
  if (!STATE[args.event] && args.event !== "unblock") return null;
  try {
    return await upsert(args);
  } catch (error) {
    return failure(error);
  }
}

async function upsert({ client, timelineClient, event, key, story, pr, now }) {
  let row;
  let rowText;
  try {
    const found = await timelineClient.request("POST", `/data_sources/${WORK_TIMELINE}/query`, {
      page_size: 1,
      filter: { property: "Key", rich_text: { equals: key } },
    });
    if (!Array.isArray(found.results)) throw new NotionError("bad response", "the Work timeline query answered without a results list");
    row = found.results[0];
  } catch (error) {
    rowText = failure(error);
  }
  const { state, range, dates } = timing(event, story, row, now);

  let storyText = "";
  try {
    await client.request("PATCH", `/pages/${story.id}`, { properties: { Work: { date: range }, ...dates } });
  } catch (error) {
    storyText = `; story ${failure(error)}`;
  }
  if (rowText) return rowText + storyText;

  const properties = {
    Task: { title: richText(key) },
    Key: { rich_text: richText(key) },
    Ticket: { relation: [{ id: story.id }] },
    State: { select: { name: state } },
    When: { date: range },
    ...dates,
    ...(pr && { PR: { url: pr } }),
  };
  const icon = { type: "emoji", emoji: ICON[state] };
  try {
    if (row) await timelineClient.request("PATCH", `/pages/${row.id}`, { icon, properties });
    else await timelineClient.request("POST", "/pages", { parent: { type: "data_source_id", data_source_id: WORK_TIMELINE }, icon, properties });
    rowText = row ? `${readProp(row, "State") ?? "no state"} → ${state}` : `created ${state}`;
  } catch (error) {
    rowText = failure(error);
  }
  return rowText + storyText;
}
