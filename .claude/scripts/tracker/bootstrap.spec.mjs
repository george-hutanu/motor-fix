import { afterEach, describe, it } from "vitest";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CHECKLIST, RESERVED_FIELD_NAMES, reconcile, SCHEMA } from "./bootstrap.mjs";
import { fakeGitHub } from "./fixtures/github.mjs";
import { githubClient } from "./github.mjs";

const TOKEN = "ghp_SECRET_never_print_me";
const TODAY = new Date("2026-10-09T12:00:00Z");
const dirs = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function formsDir() {
  const dir = mkdtempSync(join(tmpdir(), "forms-"));
  dirs.push(dir);
  writeFileSync(join(dir, "story.yml"), 'name: Story\nlabels: ["type: story"]\nprojects: ["george-hutanu/<number>"]\nbody: []\n');
  writeFileSync(join(dir, "task.yml"), 'name: Task\nlabels: ["type: task"]\nbody: []\n');
  return dir;
}

async function run(gh, opts = {}) {
  const lines = [];
  const github = githubClient({ token: TOKEN, fetchImpl: gh.fetchImpl, sleep: async () => {} });
  const result = await reconcile(github, { today: TODAY, formsDir: opts.formsDir ?? formsDir(), log: (l) => lines.push(l), ...opts });
  return { ...result, lines, github };
}

const ops = (gh, op) => gh.requests.filter((r) => r.op === op);
const project = (gh) => gh.state.projects[0];
const fieldNamed = (gh, name) => project(gh).fields.find((f) => f.name === name);
const optionNames = (gh, name) => fieldNamed(gh, name).options.map((o) => o.name);
const EPICS = Array.from({ length: 17 }, (_, i) => `EP-${i + 1}`);

// @traces 1017-FR-001
// @traces 1017-FR-002
// @traces 1017-FR-003
// @traces 1017-FR-004
// @traces 1017-FR-014
describe("a first run on a fresh account", () => {
  it("creates the Project, links the repository, writes the README and posts one status update", async () => {
    const gh = fakeGitHub();
    const r = await run(gh);
    assert.equal(r.exit, 0);
    assert.equal(gh.state.projects.length, 1);
    assert.equal(project(gh).title, "MotorFix");
    assert.deepEqual(project(gh).repositories, ["george-hutanu/motor-fix"]);
    assert.equal(project(gh).readme, SCHEMA.readme);
    assert.equal(project(gh).statusUpdates.length, 1);
    assert.equal(project(gh).statusUpdates[0].status, "ON_TRACK");
    assert.ok(r.lines.some((l) => /^project\s+created\s+MotorFix \(#1\)/.test(l)));
  });

  it("sets every field with its options in the tracker's order", async () => {
    const gh = fakeGitHub();
    await run(gh);
    assert.deepEqual(optionNames(gh, "Status"), ["To do", "Planning", "Implementing", "Blocked", "QA", "Done"]);
    assert.deepEqual(optionNames(gh, "Priority"), ["Urgent", "Highest", "High", "Medium", "Low"]);
    assert.deepEqual(optionNames(gh, "Work type"), ["Story", "Task", "Bug", "Tech debt", "Decision", "Epic"]);
    assert.deepEqual(optionNames(gh, "Epic"), EPICS);
    assert.deepEqual(optionNames(gh, "Ready to work"), ["Yes", "No"]);
    for (const name of ["Started", "QA from", "Merged at", "Planned start", "Planned end"]) assert.equal(fieldNamed(gh, name).dataType, "DATE", name);
    assert.equal(fieldNamed(gh, "Story points").dataType, "NUMBER");
    const iteration = fieldNamed(gh, "Sprint");
    assert.equal(iteration.dataType, "ITERATION");
    assert.equal(iteration.iteration.duration, 14);
    assert.equal(iteration.iteration.startDate, "2026-10-12");
  });

  it("creates the views with their layouts, then sets their filters", async () => {
    const gh = fakeGitHub();
    await run(gh);
    const views = Object.fromEntries(project(gh).views.map((v) => [v.name, v]));
    assert.equal(views.Board.layout, "BOARD_LAYOUT");
    assert.equal(views.Table.layout, "TABLE_LAYOUT");
    assert.equal(views.Roadmap.layout, "ROADMAP_LAYOUT");
    assert.equal(views.Blocked.filter, "status:Blocked");
    assert.equal(views["My work"].filter, "assignee:@me -status:Done");
    for (const key of EPICS) {
      assert.equal(views[key]?.layout, "BOARD_LAYOUT", key);
      assert.equal(views[key].filter, `epic:"${key}"`);
    }
    const names = (v) => v.visibleFieldIds.map((id) => project(gh).fields.find((f) => f.id === id).name);
    assert.deepEqual(names(views.Blocked), ["Title", "Priority", "Work type", "Epic", "Assignees"]);
    assert.ok(ops(gh, "CreateView").every((c) => !("filter" in c.body.variables)), "the create input has no filter");
  });

  it("creates the labels and milestones the import needs", async () => {
    const gh = fakeGitHub();
    await run(gh);
    const labels = gh.state.labels.map((l) => l.name);
    for (const name of ["type: story", "type: task", "type: bug", "type: tech debt", "type: decision", "epic", "area: front end", "area: data", "role: Driver", "role: System", "track: Platform", "track: Whole team", ...EPICS]) {
      assert.ok(labels.includes(name), name);
    }
    assert.deepEqual(
      gh.state.milestones.map((m) => m.title),
      ["1 - Launch", "2 - Soon after", "3 - Later"],
    );
  });

  it("writes the Project number into the issue forms, after their labels", async () => {
    const gh = fakeGitHub();
    const dir = formsDir();
    const r = await run(gh, { formsDir: dir });
    assert.match(readFileSync(join(dir, "story.yml"), "utf8"), /^projects: \["george-hutanu\/1"\]$/m);
    assert.equal(readFileSync(join(dir, "task.yml"), "utf8"), 'name: Task\nlabels: ["type: task"]\nprojects: ["george-hutanu/1"]\nbody: []\n');
    assert.ok(r.lines.some((l) => /^forms\s+written/.test(l)));
  });

  it("never prints the token", async () => {
    const gh = fakeGitHub();
    const r = await run(gh);
    assert.ok(!r.lines.join("\n").includes(TOKEN));
  });
});

describe("a second run", () => {
  it("creates nothing and reports every element present", async () => {
    const gh = fakeGitHub();
    const dir = formsDir();
    await run(gh, { formsDir: dir });
    const before = gh.writes().length;
    const r = await run(gh, { formsDir: dir });
    assert.equal(gh.writes().length, before);
    assert.equal(r.counts.created, 0);
    assert.equal(r.exit, 0);
    assert.ok(r.lines.some((l) => /^summary\s+created 0/.test(l)));
    assert.ok(!r.lines.some((l) => /\bcreated\b/.test(l) && !/^summary/.test(l)));
  });
});

describe("field names", () => {
  it("creates no field under a name GitHub keeps for its own fields", () => {
    const reserved = new Set(RESERVED_FIELD_NAMES.map((n) => n.toLowerCase()));
    const created = SCHEMA.fields.filter((f) => f.name !== "Status").map((f) => f.name);
    assert.deepEqual(
      created.filter((n) => reserved.has(n.toLowerCase())),
      [],
    );
  });

  it("finishes a Project whose first run stopped on a refused field name, then changes nothing", async () => {
    const want = (name) => SCHEMA.fields.find((f) => f.name === name);
    const gh = fakeGitHub({
      projects: [
        {
          title: "MotorFix",
          linked: true,
          statusOptions: want("Status").options.map((o) => o.name),
          fields: [want("Priority")],
        },
      ],
    });
    const first = await run(gh);
    assert.equal(first.exit, 0);
    for (const f of SCHEMA.fields) assert.equal(project(gh).fields.filter((x) => x.name === f.name).length, 1, f.name);
    assert.equal(ops(gh, "CreateProject").length, 0);
    const before = gh.writes().length;
    const second = await run(gh);
    assert.equal(second.exit, 0);
    assert.equal(gh.writes().length, before);
  });
});

describe("views", () => {
  it("creates a roadmap without visible fields, which GitHub refuses for one", async () => {
    const gh = fakeGitHub();
    const r = await run(gh);
    assert.equal(r.exit, 0);
    const roadmaps = ops(gh, "CreateView").filter((q) => q.body.variables.layout === "ROADMAP_LAYOUT");
    assert.equal(roadmaps.length, 1);
    assert.equal(roadmaps[0].body.variables.fieldIds, undefined);
    assert.ok(SCHEMA.views.filter((v) => v.layout === "ROADMAP_LAYOUT").every((v) => v.fields.length === 0));
  });

  it("finishes a Project whose run stopped after the Board and Table views, then changes nothing", async () => {
    const gh = fakeGitHub();
    await run(gh);
    const p = project(gh);
    p.views = p.views.filter((v) => v.name === "Board" || v.name === "Table");
    gh.state.labels.length = 0;
    gh.state.milestones.length = 0;
    const before = ops(gh, "CreateView").length;
    const r = await run(gh);
    assert.equal(r.exit, 0);
    assert.deepEqual(
      p.views.map((v) => v.name).sort(),
      SCHEMA.views.map((v) => v.name).sort(),
    );
    assert.equal(ops(gh, "CreateView").length - before, SCHEMA.views.length - 2);
    assert.equal(ops(gh, "CreateField").length, SCHEMA.fields.length - 1);
    const writes = gh.writes().length;
    assert.equal((await run(gh)).exit, 0);
    assert.equal(gh.writes().length, writes);
  });
});

describe("a Project someone changed by hand", () => {
  it("reports a drifted option and a view's layout without changing them, and exits 2", async () => {
    const gh = fakeGitHub({
      projects: [
        {
          title: "MotorFix",
          linked: true,
          fields: [{ name: "Priority", dataType: "SINGLE_SELECT", options: [{ name: "Urgent" }, { name: "Highest" }, { name: "High" }, { name: "Medium" }] }],
          views: [{ name: "Board", layout: "TABLE_LAYOUT" }],
        },
      ],
    });
    const r = await run(gh);
    assert.equal(r.exit, 2);
    assert.ok(r.lines.some((l) => /^field\s+differs\s+Priority/.test(l)));
    assert.ok(r.lines.some((l) => /^view\s+differs\s+Board/.test(l)));
    assert.deepEqual(optionNames(gh, "Priority"), ["Urgent", "Highest", "High", "Medium"]);
    assert.equal(project(gh).views.find((v) => v.name === "Board").layout, "TABLE_LAYOUT");
    assert.ok(ops(gh, "SetOptions").every((r) => r.body.variables.fieldId !== fieldNamed(gh, "Priority").id));
  });

  it("reports a view whose visible fields differ without changing them, and exits 2", async () => {
    const gh = fakeGitHub();
    const dir = formsDir();
    await run(gh, { formsDir: dir });
    const board = project(gh).views.find((v) => v.name === "Board");
    board.visibleFieldIds = [fieldNamed(gh, "Title").id, fieldNamed(gh, "Status").id];
    const before = gh.writes().length;
    const r = await run(gh, { formsDir: dir });
    assert.equal(r.exit, 2);
    assert.ok(r.lines.some((l) => /^view\s+differs\s+Board: fields Title, Status, not Title, Priority, Work type, Epic, Ready to work \(not changed\)$/.test(l)));
    assert.equal(gh.writes().length, before);
    assert.deepEqual(board.visibleFieldIds, [fieldNamed(gh, "Title").id, fieldNamed(gh, "Status").id]);
  });

  it("leaves GitHub's default Status options alone once the Project holds items", async () => {
    const gh = fakeGitHub({ projects: [{ title: "MotorFix", linked: true, itemCount: 3 }] });
    const r = await run(gh);
    assert.deepEqual(optionNames(gh, "Status"), ["Todo", "In Progress", "Done"]);
    assert.ok(r.lines.some((l) => /^field\s+differs\s+Status/.test(l)));
    assert.equal(r.exit, 2);
  });

  it("leaves Status options that are not GitHub's defaults alone", async () => {
    const gh = fakeGitHub({ projects: [{ title: "MotorFix", linked: true, statusOptions: ["To do", "Doing", "Done"] }] });
    await run(gh);
    assert.deepEqual(optionNames(gh, "Status"), ["To do", "Doing", "Done"]);
    assert.equal(ops(gh, "SetOptions").length, 0);
  });

  it("reuses a label that already exists", async () => {
    const gh = fakeGitHub({ labels: [{ name: "EP-1", color: "5319e7" }] });
    await run(gh);
    assert.equal(gh.state.labels.filter((l) => l.name === "EP-1").length, 1);
    assert.ok(!gh.requests.some((r) => r.method === "POST" && r.path.endsWith("/labels") && r.body.name === "EP-1"));
  });

  it("reuses ep-1 for EP-1, since GitHub label names ignore case, and says so", async () => {
    const gh = fakeGitHub({ labels: ["ep-1"] });
    const r = await run(gh);
    assert.ok(!gh.requests.some((q) => q.method === "POST" && q.path.endsWith("/labels") && q.body.name.toLowerCase() === "ep-1"));
    assert.ok(r.lines.some((l) => /^label\s+present\s+EP-1 \(as ep-1\)$/.test(l)));
  });
});

describe("a dry run", () => {
  it("reads, prints what it would create and the checklist, and writes nothing", async () => {
    const gh = fakeGitHub();
    const dir = formsDir();
    const r = await run(gh, { dryRun: true, formsDir: dir });
    assert.equal(gh.writes().length, 0);
    assert.match(readFileSync(join(dir, "story.yml"), "utf8"), /<number>/);
    assert.ok(r.lines.some((l) => /^project\s+would create\s+MotorFix/.test(l)));
    assert.ok(r.lines.some((l) => /^label\s+would create\s+type: story/.test(l)));
    assert.ok(r.lines.includes(CHECKLIST[0]));
  });
});

// @traces 1017-FR-003
describe("the owner's checklist", () => {
  it("fits fifteen lines, one setting each, and holds only what the API cannot set", async () => {
    assert.ok(CHECKLIST.length >= 7 && CHECKLIST.length <= 15, `${CHECKLIST.length} lines`);
    const text = CHECKLIST.join("\n");
    for (const needle of [/Board.*group by Status/i, /Table.*sort.*Priority/i, /EP-.*group by Status/i, /Roadmap.*Started.*Merged at/i, /Roadmap.*Planned start.*Planned end/i, /auto-add.*is:issue/i, /Insights/i, /private/i]) {
      assert.match(text, needle);
    }
    assert.doesNotMatch(text, /filter|create (the )?field|option/i);
  });

  it("is printed at the end of every run", async () => {
    const gh = fakeGitHub();
    const r = await run(gh);
    assert.deepEqual(r.lines.slice(-CHECKLIST.length), CHECKLIST);
  });
});
