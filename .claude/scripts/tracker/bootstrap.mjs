// Sets up the MotorFix GitHub Project, its fields and views, links it to the
// issue and code repositories, makes the labels and milestones in the private
// issue repository (repos.mjs) and writes its number into the issue forms. Every run
// reconciles: it creates what is missing, reports what differs and changes
// nothing a person may have set by hand.
//
//   node .claude/scripts/tracker/bootstrap.mjs [--dry-run]
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { isEntryPoint } from "../lib/entry.mjs";
import { GitHubError, githubClient } from "./github.mjs";
import * as specsRepo from "../specs-repo.mjs";
import { CODE_REPO, ISSUE_REPO, OWNER, specsClone } from "./repos.mjs";
import { assertProjectScope, projectToken, TokenError } from "./token.mjs";

const PROJECT_TITLE = "MotorFix";
// The issue forms live in the specs clone (motor-fix-specs), beside the issues.
const FORMS_DIR = join(specsClone(fileURLToPath(new URL("../../../", import.meta.url)), specsRepo), ".github", "ISSUE_TEMPLATE");
/** The repositories the Project is linked to: issues from the first, pull requests from the second. */
export const LINKED_REPOS = [ISSUE_REPO, CODE_REPO];
const DEFAULT_STATUS = ["Todo", "In Progress", "Done"];

const EPICS = Array.from({ length: 17 }, (_, i) => `EP-${i + 1}`);
const select = (name, options) => ({ name, dataType: "SINGLE_SELECT", options: options.map(([n, color = "GRAY"]) => ({ name: n, color, description: "" })) });
const plain = (dataType) => (name) => ({ name, dataType });
const label = (color) => (name) => ({ name, color, description: "" });

// Field names GitHub keeps for its own fields (built-in item fields and the
// organisation issue Type); creating a field with one answers UNPROCESSABLE.
// Status is the one built-in the schema reuses, by updating its options.
export const RESERVED_FIELD_NAMES = [
  "Title",
  "Assignees",
  "Status",
  "Labels",
  "Linked pull requests",
  "Milestone",
  "Repository",
  "Reviewers",
  "Parent issue",
  "Sub-issues progress",
  "Type",
  "Iteration",
  "Tracks",
  "Tracked by",
];

export const SCHEMA = {
  fields: [
    select("Status", [["To do"], ["Planning", "BLUE"], ["Implementing", "YELLOW"], ["Blocked", "RED"], ["QA", "ORANGE"], ["Done", "GREEN"]]),
    select("Priority", [["Urgent", "RED"], ["Highest", "ORANGE"], ["High", "YELLOW"], ["Medium", "BLUE"], ["Low"]]),
    select("Work type", [["Story"], ["Task"], ["Bug"], ["Tech debt"], ["Decision"], ["Epic"]]),
    select(
      "Epic",
      EPICS.map((e) => [e]),
    ),
    select("Ready to work", [["Yes", "GREEN"], ["No"]]),
    ...["Started", "QA from", "Merged at", "Planned start", "Planned end"].map(plain("DATE")),
    plain("NUMBER")("Story points"),
    plain("ITERATION")("Sprint"),
  ],
  views: [
    { name: "Board", layout: "BOARD_LAYOUT", fields: ["Title", "Priority", "Work type", "Epic", "Ready to work"] },
    {
      name: "Table",
      layout: "TABLE_LAYOUT",
      fields: ["Title", "Status", "Priority", "Work type", "Epic", "Ready to work", "Story points", "Started", "Merged at", "Assignees", "Labels", "Milestone"],
    },
    { name: "Roadmap", layout: "ROADMAP_LAYOUT", fields: [] },
    { name: "Blocked", layout: "TABLE_LAYOUT", filter: "status:Blocked", fields: ["Title", "Priority", "Work type", "Epic", "Assignees"] },
    { name: "My work", layout: "TABLE_LAYOUT", filter: "assignee:@me -status:Done", fields: ["Title", "Status", "Priority", "Work type", "Epic"] },
    ...EPICS.map((e) => ({ name: e, layout: "BOARD_LAYOUT", filter: `epic:"${e}"`, fields: ["Title", "Priority", "Work type", "Ready to work"] })),
  ],
  labels: [
    ...["type: story", "type: task", "type: bug", "type: tech debt", "type: decision", "epic"].map(label("1d76db")),
    ...["front end", "backend", "real-time", "outside service", "legal", "design", "data"].map((a) => label("0e8a16")(`area: ${a}`)),
    ...["Visitor", "Driver", "Garage", "Mechanic", "Admin", "System"].map((r) => label("fbca04")(`role: ${r}`)),
    ...["Platform", "Driver side", "Garage side", "Admin", "Whole team"].map((t) => label("c5def5")(`track: ${t}`)),
    ...EPICS.map(label("5319e7")),
  ],
  milestones: ["1 - Launch", "2 - Soon after", "3 - Later"],
  readme: [
    "# MotorFix",
    "",
    "The backlog of MotorFix: one issue per story, task, bug, tech debt or decision, and one parent issue per epic.",
    "",
    "- Each imported issue carries its whole page: every property, the build brief or plan, comments (under Notes from Notion) and files (stored in this repository under tracker/).",
    "- File new work with an issue form (Story, Task, Bug, Tech debt, Decision); it lands here by itself.",
    "- An imported issue is titled `ST-<n>` or `EP-<n>` after its old ID; a new one is known by its number.",
    "- Stories are sub-issues of their epic; Blocked by links are issue dependencies.",
  ].join("\n"),
};

export const CHECKLIST = [
  "- Board view: group by Status.",
  "- Table view: sort by Priority, then by Title.",
  "- Each EP-<n> view: group by Status.",
  "- Roadmap view: dates Started and Merged at, zoom Month.",
  '- Duplicate the Roadmap view as "Plan": dates Planned start and Planned end, zoom Quarter.',
  `- Workflows: turn on Auto-add to project for ${OWNER}/${ISSUE_REPO} with is:issue.`,
  "- Workflows: keep Item closed and Pull request merged setting Status to Done.",
  "- Insights: add a chart of items by Status for each Epic, and one of Done over time.",
  "- Settings: keep the Project's visibility private.",
];

const Q = {
  projects: `query Projects { viewer { id login projectsV2(first: 100) { nodes { id number title } } } issues: repository(owner: "${OWNER}", name: "${ISSUE_REPO}") { id } code: repository(owner: "${OWNER}", name: "${CODE_REPO}") { id } }`,
  state: `query ProjectState($id: ID!) { node(id: $id) { ... on ProjectV2 { id number title readme
    repositories(first: 5) { nodes { nameWithOwner } } statusUpdates(first: 1) { totalCount } items { totalCount }
    fields(first: 50) { nodes { ... on ProjectV2SingleSelectField { id name dataType options { id name color } } ... on ProjectV2IterationField { id name dataType } ... on ProjectV2Field { id name dataType } } }
    views(first: 50) { nodes { id name layout filter fields(first: 30) { nodes { ... on ProjectV2FieldCommon { id name } } } } } } } }`,
  createProject: "mutation CreateProject($ownerId: ID!, $title: String!) { createProjectV2(input: { ownerId: $ownerId, title: $title }) { projectV2 { id number } } }",
  linkRepo:
    "mutation LinkRepo($projectId: ID!, $repositoryId: ID!) { linkProjectV2ToRepository(input: { projectId: $projectId, repositoryId: $repositoryId }) { repository { id } } }",
  setReadme: "mutation SetReadme($projectId: ID!, $readme: String!) { updateProjectV2(input: { projectId: $projectId, readme: $readme }) { projectV2 { id } } }",
  postStatus:
    "mutation PostStatus($projectId: ID!, $status: ProjectV2StatusUpdateStatus!, $body: String!) { createProjectV2StatusUpdate(input: { projectId: $projectId, status: $status, body: $body }) { statusUpdate { id } } }",
  setOptions:
    "mutation SetOptions($fieldId: ID!, $options: [ProjectV2SingleSelectFieldOptionInput!]!) { updateProjectV2Field(input: { fieldId: $fieldId, singleSelectOptions: $options }) { projectV2Field { ... on ProjectV2SingleSelectField { id } } } }",
  createField:
    "mutation CreateField($projectId: ID!, $dataType: ProjectV2CustomFieldType!, $name: String!, $options: [ProjectV2SingleSelectFieldOptionInput!], $iteration: ProjectV2IterationFieldConfigurationInput) { createProjectV2Field(input: { projectId: $projectId, dataType: $dataType, name: $name, singleSelectOptions: $options, iterationConfiguration: $iteration }) { projectV2Field { ... on ProjectV2FieldCommon { id } } } }",
  createView:
    "mutation CreateView($projectId: ID!, $name: String!, $layout: ProjectV2ViewLayout!, $fieldIds: [ID!]) { createProjectV2View(input: { projectId: $projectId, name: $name, layout: $layout, configuration: { visibleFieldIds: $fieldIds } }) { projectV2View { id } } }",
  // A roadmap takes no visible fields: GitHub refuses any configuration for one.
  createRoadmapView:
    "mutation CreateView($projectId: ID!, $name: String!, $layout: ProjectV2ViewLayout!) { createProjectV2View(input: { projectId: $projectId, name: $name, layout: $layout }) { projectV2View { id } } }",
  setViewFilter: "mutation SetViewFilter($viewId: ID!, $filter: String!) { updateProjectV2View(input: { viewId: $viewId, filter: $filter }) { projectV2View { id } } }",
};

/** The MotorFix Project ({id, number}) and the ids it is created and linked with; project is null when it does not exist. */
export async function findProject(github) {
  const data = await github.graphql(Q.projects);
  return { project: data.viewer.projectsV2.nodes.find((p) => p.title === PROJECT_TITLE) ?? null, ownerId: data.viewer.id, repositoryIds: { [ISSUE_REPO]: data.issues.id, [CODE_REPO]: data.code.id } };
}

/** The Project's readme, links, counts, fields (with option ids) and views. */
export async function projectState(github, id) {
  const node = (await github.graphql(Q.state, { id })).node;
  return {
    readme: node.readme ?? "",
    repositories: node.repositories.nodes.map((r) => r.nameWithOwner),
    statusUpdates: node.statusUpdates.totalCount,
    items: node.items.totalCount,
    fields: node.fields.nodes.filter((f) => f.name),
    views: node.views.nodes.map((v) => ({ ...v, fieldNames: v.fields.nodes.map((f) => f.name) })),
  };
}

const EMPTY_STATE = { readme: "", repositories: [], statusUpdates: 0, items: 0, fields: [], views: [] };

/** The Monday after `today` (UTC), as YYYY-MM-DD. */
function nextMonday(today) {
  const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + ((8 - d.getUTCDay()) % 7 || 7));
  return d.toISOString().slice(0, 10);
}

const sameNames = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));

export async function reconcile(github, { today = new Date(), formsDir = FORMS_DIR, log = console.log, dryRun = false } = {}) {
  const lines = [];
  const counts = { created: 0, present: 0, differs: 0 };
  const out = (kind, status, detail = "") => {
    const line = `${kind.padEnd(9)} ${status.padEnd(9)} ${detail}`.trimEnd();
    lines.push(line);
    log(line);
  };
  const created = (kind, detail, status = "created") => {
    if (dryRun) return out(kind, "would create", detail);
    counts.created++;
    out(kind, status, detail);
  };
  const present = (kind, detail) => {
    counts.present++;
    out(kind, "present", detail);
  };
  const differs = (kind, detail) => {
    counts.differs++;
    out(kind, "differs", `${detail} (not changed)`);
  };
  const write = async (query, variables) => (dryRun ? null : github.graphql(query, variables));

  const found = await findProject(github);
  let project = found.project;
  if (project) present("project", `${PROJECT_TITLE} (#${project.number})`);
  else if (dryRun) created("project", PROJECT_TITLE);
  else {
    project = (await github.graphql(Q.createProject, { ownerId: found.ownerId, title: PROJECT_TITLE })).createProjectV2.projectV2;
    created("project", `${PROJECT_TITLE} (#${project.number})`);
  }
  let state = project ? await projectState(github, project.id) : EMPTY_STATE;
  const projectId = project?.id;

  for (const repo of LINKED_REPOS) {
    if (state.repositories.includes(`${OWNER}/${repo}`)) present("link", `${OWNER}/${repo}`);
    else {
      await write(Q.linkRepo, { projectId, repositoryId: found.repositoryIds[repo] });
      created("link", `${OWNER}/${repo}`);
    }
  }
  if (state.readme === SCHEMA.readme) present("readme");
  else {
    await write(Q.setReadme, { projectId, readme: SCHEMA.readme });
    created("readme", "", state.readme ? "updated" : "created");
  }
  if (state.statusUpdates > 0) present("status");
  else {
    const date = today.toISOString().slice(0, 10);
    await write(Q.postStatus, { projectId, status: "ON_TRACK", body: `Project set up on ${date}; the backlog is imported from Notion next.` });
    created("status", "ON_TRACK");
  }

  let fieldsCreated = false;
  for (const want of SCHEMA.fields) {
    const have = state.fields.find((f) => f.name === want.name);
    const names = want.options?.map((o) => o.name);
    const detail = names ? `${want.name} (${names.length} options)` : `${want.name} (${want.dataType})`;
    if (!have) {
      if (want.name === "Status" && project) {
        differs("field", "Status: missing");
        continue;
      }
      const iteration = want.dataType === "ITERATION" ? { startDate: nextMonday(today), duration: 14, iterations: [] } : undefined;
      await write(Q.createField, { projectId, dataType: want.dataType, name: want.name, options: want.options, iteration });
      fieldsCreated = true;
      created("field", detail);
      continue;
    }
    const haveNames = have.options?.map((o) => o.name);
    if (have.dataType !== want.dataType) differs("field", `${want.name}: ${have.dataType}, not ${want.dataType}`);
    else if (!names || sameNames(haveNames, names)) present("field", detail);
    else if (want.name === "Status" && sameNames(haveNames, DEFAULT_STATUS) && state.items === 0) {
      await write(Q.setOptions, { fieldId: have.id, options: want.options });
      fieldsCreated = true;
      created("field", detail, "updated");
    } else differs("field", `${want.name}: options ${haveNames.join(", ")}, not ${names.join(", ")}`);
  }
  if (fieldsCreated && !dryRun) state = await projectState(github, projectId);

  const fieldId = (name) => state.fields.find((f) => f.name === name)?.id;
  for (const want of SCHEMA.views) {
    const have = state.views.find((v) => v.name === want.name);
    const detail = `${want.name} (${want.layout}${want.filter ? `, filter ${want.filter}` : ""})`;
    if (!have) {
      const made =
        want.layout === "ROADMAP_LAYOUT"
          ? await write(Q.createRoadmapView, { projectId, name: want.name, layout: want.layout })
          : await write(Q.createView, { projectId, name: want.name, layout: want.layout, fieldIds: want.fields.map(fieldId).filter(Boolean) });
      if (want.filter) await write(Q.setViewFilter, { viewId: made?.createProjectV2View.projectV2View.id, filter: want.filter });
      created("view", detail);
    } else if (have.layout !== want.layout) differs("view", `${want.name}: ${have.layout}, not ${want.layout}`);
    else if (want.layout !== "ROADMAP_LAYOUT" && !sameSet(have.fieldNames, want.fields.filter(fieldId))) {
      differs("view", `${want.name}: fields ${have.fieldNames.join(", ") || "none"}, not ${want.fields.filter(fieldId).join(", ")}`);
    } else if (want.filter && have.filter !== want.filter) {
      await write(Q.setViewFilter, { viewId: have.id, filter: want.filter });
      created("view", detail, "updated");
    } else present("view", detail);
  }

  // GitHub label names are case-insensitive: an existing "ep-1" is EP-1.
  const labels = new Map((await github.pages("labels?per_page=100")).map((l) => [l.name.toLowerCase(), l.name]));
  for (const want of SCHEMA.labels) {
    const have = labels.get(want.name.toLowerCase());
    if (have) present("label", have === want.name ? want.name : `${want.name} (as ${have})`);
    else {
      if (!dryRun) await github.rest("POST", "labels", want);
      created("label", want.name);
    }
  }
  const milestones = new Set((await github.pages("milestones?state=all&per_page=100")).map((m) => m.title));
  for (const title of SCHEMA.milestones) {
    if (milestones.has(title)) present("milestone", title);
    else {
      if (!dryRun) await github.rest("POST", "milestones", { title });
      created("milestone", title);
    }
  }

  if (!project) out("forms", "would write", "the Project number, once it exists");
  else if (!existsSync(formsDir)) out("forms", "skipped", `no ${formsDir} (clone the specs repo: node .claude/scripts/specs-repo.mjs ensure)`);
  else {
    const line = `projects: ["${OWNER}/${project.number}"]`;
    const changed = [];
    for (const name of readdirSync(formsDir).filter((f) => f.endsWith(".yml") && f !== "config.yml")) {
      const path = `${formsDir.replace(/\/?$/, "/")}${name}`;
      const text = readFileSync(path, "utf8");
      const next = /^projects:.*$/m.test(text) ? text.replace(/^projects:.*$/m, line) : text.replace(/^(labels:.*)$/m, `$1\n${line}`);
      if (next === text) continue;
      if (!dryRun) writeFileSync(path, next);
      changed.push(name);
    }
    if (!changed.length) present("forms", line);
    else if (dryRun) out("forms", "would write", `${changed.join(", ")} (${line})`);
    else out("forms", "written", `${changed.join(", ")} (${line})`);
  }

  out("summary", `created ${counts.created} · present ${counts.present} · differs ${counts.differs}`);
  out("", "");
  log("Owner checklist (UI only):");
  lines.push("Owner checklist (UI only):");
  for (const item of CHECKLIST) {
    lines.push(item);
    log(item);
  }
  return { exit: counts.differs ? 2 : 0, counts, lines };
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  try {
    const github = githubClient({ token: projectToken() });
    console.log(`${"token".padEnd(9)} ${await assertProjectScope(github)}, project scope`);
    process.exitCode = (await reconcile(github, { dryRun })).exit;
  } catch (error) {
    if (!(error instanceof TokenError || error instanceof GitHubError)) throw error;
    console.error(error.message);
    process.exitCode = 1;
  }
}

if (isEntryPoint(import.meta.url)) await main();
