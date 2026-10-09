// An in-memory GitHub for the tracker specs: a fetch that answers the REST
// paths and the named GraphQL operations the tracker sends, and records every
// request. GraphQL operations are told apart by their operation name.

const API = "https://api.github.com";
const json = (data, status = 200, headers = {}) =>
  new Response(data === null ? null : JSON.stringify(data), { status, headers: { "content-type": "application/json", ...headers } });

// The names GitHub refuses for a new field (its built-in fields and the issue Type).
const RESERVED = new Set(
  ["Title", "Assignees", "Status", "Labels", "Linked pull requests", "Milestone", "Repository", "Reviewers", "Parent issue", "Sub-issues progress", "Type", "Iteration", "Tracks", "Tracked by"].map((n) =>
    n.toLowerCase(),
  ),
);

const BUILT_IN = [
  { name: "Title", dataType: "TITLE" },
  { name: "Assignees", dataType: "ASSIGNEES" },
  { name: "Status", dataType: "SINGLE_SELECT", options: ["Todo", "In Progress", "Done"].map((name) => ({ name, color: "GRAY" })) },
  { name: "Labels", dataType: "LABELS" },
  { name: "Milestone", dataType: "MILESTONE" },
];

/** A fake GitHub; `seed` presets labels, milestones, issues, pulls and projects. */
export function fakeGitHub(seed = {}) {
  let seq = 0;
  const nextId = (prefix) => `${prefix}_${++seq}`;
  const state = {
    login: "george-hutanu",
    scoped: seed.scoped ?? true,
    labels: (seed.labels ?? []).map((l) => (typeof l === "string" ? { name: l, color: "ededed", description: "" } : { description: "", ...l })),
    milestones: (seed.milestones ?? []).map((title, i) => ({ number: i + 1, title, state: "open" })),
    issues: [],
    pulls: new Map(),
    projects: [],
    subIssues: new Map(),
    // GitHub refuses a parent's 101st sub-issue.
    subIssueMax: seed.subIssueMax ?? 100,
    listLag: seed.listLag ?? 0,
    blockedBy: new Map(),
    nextNumber: 1,
    // Pull requests of the issue repo itself, which its issue list also returns.
    specsPulls: seed.specsPulls ?? [],
  };
  const requests = [];

  const field = (f, project) => {
    const made = { id: nextId("F"), name: f.name, dataType: f.dataType };
    if (f.options) made.options = f.options.map((o) => ({ id: nextId("O"), name: o.name, color: o.color ?? "GRAY" }));
    project.fields.push(made);
    return made;
  };
  const project = ({ title, number }) => {
    const p = { id: nextId("PVT"), number: number ?? state.projects.length + 1, title, readme: "", repositories: [], statusUpdates: [], fields: [], views: [], items: [] };
    for (const f of BUILT_IN) field(f, p);
    state.projects.push(p);
    return p;
  };
  const addIssue = (issue) => {
    const number = issue.number ?? state.nextNumber;
    state.nextNumber = Math.max(state.nextNumber, number + 1);
    const made = {
      number,
      id: 1000 + number,
      node_id: `I_${number}`,
      title: issue.title,
      body: issue.body ?? "",
      labels: (issue.labels ?? []).map((name) => ({ name })),
      milestone: issue.milestone ?? null,
      assignees: (issue.assignees ?? []).map((login) => ({ login })),
      state: issue.state ?? "open",
      state_reason: issue.state_reason ?? null,
    };
    state.issues.push(made);
    return made;
  };
  for (const p of seed.projects ?? []) {
    const made = project(p);
    if (p.statusOptions) made.fields.find((f) => f.name === "Status").options = p.statusOptions.map((name) => ({ id: nextId("O"), name, color: "GRAY" }));
    for (const f of p.fields ?? []) field(f, made);
    for (const v of p.views ?? []) made.views.push({ id: nextId("PVTV"), filter: null, visibleFieldIds: [], ...v });
    for (let i = 0; i < (p.itemCount ?? 0); i++) made.items.push({ id: nextId("PVTI"), number: null, values: {} });
    if (p.linked) made.repositories.push("george-hutanu/motor-fix-specs", "george-hutanu/motor-fix");
  }
  for (const i of seed.issues ?? []) addIssue(i);
  for (const pr of seed.pulls ?? []) {
    const number = pr.number ?? state.nextNumber;
    state.nextNumber = Math.max(state.nextNumber, number + 1);
    state.pulls.set(number, { number, state: pr.state ?? "open", body: pr.body ?? "", merged_at: pr.merged_at ?? null });
  }

  const issueBy = (number) => state.issues.find((i) => i.number === Number(number));
  const issueById = (id) => state.issues.find((i) => i.id === id);
  const projectById = (id) => state.projects.find((p) => p.id === id);
  const milestoneOf = (number) => (number == null ? null : state.milestones.find((m) => m.number === number) ?? null);

  function restAnswer(method, path, query, body) {
    // Issues, labels and milestones exist in the private issue repo only; the
    // public code repo answers its pull requests and nothing else.
    const [, name, repo] = path.match(/^\/repos\/george-hutanu\/([^/]+)\/(.*)$/) ?? [];
    let m;
    if (name === "motor-fix") {
      if (!(m = repo.match(/^pulls\/(\d+)$/))) return json({ message: "Not Found" }, 404);
      const pr = state.pulls.get(Number(m[1]));
      if (!pr) return json({ message: "Not Found" }, 404);
      if (method === "PATCH") pr.body = body.body;
      return json(pr);
    }
    if (name !== "motor-fix-specs") return json({ message: "Not Found" }, 404);
    if (repo === "labels" && method === "GET") return json(state.labels.map((l) => ({ node_id: `LA_${l.name}`, ...l })));
    if (repo === "labels" && method === "POST") {
      if (state.labels.some((l) => l.name === body.name)) return json({ message: "Validation Failed" }, 422);
      state.labels.push({ name: body.name, color: body.color, description: body.description ?? "" });
      return json(state.labels.at(-1), 201);
    }
    if (repo === "milestones" && method === "GET") return json(state.milestones.map((m) => ({ node_id: `MI_${m.number}`, ...m })));
    if (repo === "milestones" && method === "POST") {
      const made = { number: state.milestones.length + 1, title: body.title, state: "open" };
      state.milestones.push(made);
      return json(made, 201);
    }
    if (repo === "issues" && method === "GET") {
      const all = [...state.issues, ...state.specsPulls.map((number) => ({ number, title: `PR ${number}`, body: "", pull_request: {}, labels: [], assignees: [] }))].sort(
        (a, b) => a.number - b.number,
      );
      const per = Number(query.get("per_page") ?? 30);
      const page = Number(query.get("page") ?? 1);
      const slice = all.slice((page - 1) * per, page * per);
      const headers = page * per < all.length ? { link: `<${API}${path}?state=all&per_page=${per}&page=${page + 1}>; rel="next"` } : {};
      return json(slice, 200, headers);
    }
    if (repo === "issues" && method === "POST") {
      const made = addIssue({ ...body, milestone: milestoneOf(body.milestone) });
      return json(made, 201);
    }
    if ((m = repo.match(/^issues\/(\d+)$/)) && method === "PATCH") {
      const issue = issueBy(m[1]);
      if (!issue) return json({ message: "Not Found" }, 404);
      if ("title" in body) issue.title = body.title;
      if ("body" in body) issue.body = body.body;
      if ("labels" in body) issue.labels = body.labels.map((name) => ({ name }));
      if ("milestone" in body) issue.milestone = milestoneOf(body.milestone);
      if ("assignees" in body) issue.assignees = body.assignees.map((login) => ({ login }));
      if ("state" in body) {
        issue.state = body.state;
        issue.state_reason = body.state_reason ?? (body.state === "open" ? "reopened" : null);
      }
      return json(issue);
    }
    if ((m = repo.match(/^issues\/(\d+)\/sub_issues$/))) {
      const list = state.subIssues.get(Number(m[1])) ?? [];
      // listLag hides the newest links, as a listing taken before another writer filled the parent would.
      if (method === "GET") return json(list.slice(0, Math.max(0, list.length - (state.listLag ?? 0))).map(issueById));
      if (list.length >= state.subIssueMax) return json({ message: "An error occurred while adding the sub-issue to the parent issue. Parent cannot have more than 100 sub-issues" }, 422);
      // A sub-issue has one parent: another parent is refused unless replace_parent moves it.
      const former = [...state.subIssues].find(([n, ids]) => n !== Number(m[1]) && ids.includes(body.sub_issue_id));
      if (former && body.replace_parent !== true) return json({ message: "An error occurred while adding the sub-issue to the parent issue. Sub issue may only have one parent" }, 422);
      if (former) state.subIssues.set(former[0], former[1].filter((id) => id !== body.sub_issue_id));
      list.push(body.sub_issue_id);
      state.subIssues.set(Number(m[1]), list);
      return json(issueBy(m[1]), 201);
    }
    if ((m = repo.match(/^issues\/(\d+)\/dependencies\/blocked_by$/))) {
      const list = state.blockedBy.get(Number(m[1])) ?? [];
      // listLag hides the newest links, as a listing taken before another writer filled the parent would.
      if (method === "GET") return json(list.slice(0, Math.max(0, list.length - (state.listLag ?? 0))).map(issueById));
      list.push(body.issue_id);
      state.blockedBy.set(Number(m[1]), list);
      return json(issueBy(m[1]), 201);
    }
    return json({ message: "Not Found" }, 404);
  }

  const fieldNode = (f) => ({ id: f.id, name: f.name, dataType: f.dataType, ...(f.options ? { options: f.options } : {}) });
  const valueNode = (f, value) => {
    if (f.dataType === "SINGLE_SELECT") return { name: f.options.find((o) => o.id === value.singleSelectOptionId)?.name, field: { name: f.name } };
    if (f.dataType === "DATE") return { date: value.date, field: { name: f.name } };
    if (f.dataType === "NUMBER") return { number: value.number, field: { name: f.name } };
    if (f.dataType === "TEXT") return { text: value.text, field: { name: f.name } };
    return {};
  };

  const OPS = {
    Probe: () => (state.scoped ? { viewer: { login: state.login, projectsV2: { totalCount: state.projects.length } } } : { errors: [{ type: "INSUFFICIENT_SCOPES", message: "Your token has not been granted the required scopes." }] }),
    Projects: () => ({
      viewer: { id: "U_owner", login: state.login, projectsV2: { nodes: state.projects.map(({ id, number, title }) => ({ id, number, title })) } },
      issues: { id: "R_specs" },
      code: { id: "R_code" },
    }),
    CreateProject: (v) => ({ createProjectV2: { projectV2: (({ id, number }) => ({ id, number }))(project({ title: v.title })) } }),
    ProjectState: (v) => {
      const p = projectById(v.id);
      return {
        node: {
          id: p.id,
          number: p.number,
          title: p.title,
          readme: p.readme,
          repositories: { nodes: p.repositories.map((nameWithOwner) => ({ nameWithOwner })) },
          statusUpdates: { totalCount: p.statusUpdates.length },
          items: { totalCount: p.items.length },
          fields: { nodes: p.fields.map(fieldNode) },
          views: {
            nodes: p.views.map((w) => ({ id: w.id, name: w.name, layout: w.layout, filter: w.filter, fields: { nodes: w.visibleFieldIds.map((id) => ({ id, name: p.fields.find((f) => f.id === id)?.name })) } })),
          },
        },
      };
    },
    LinkRepo: (v) => {
      projectById(v.projectId).repositories.push(`george-hutanu/${{ R_specs: "motor-fix-specs", R_code: "motor-fix" }[v.repositoryId]}`);
      return { linkProjectV2ToRepository: { repository: { id: v.repositoryId } } };
    },
    SetReadme: (v) => {
      projectById(v.projectId).readme = v.readme;
      return { updateProjectV2: { projectV2: { id: v.projectId } } };
    },
    PostStatus: (v) => {
      projectById(v.projectId).statusUpdates.push({ status: v.status, body: v.body });
      return { createProjectV2StatusUpdate: { statusUpdate: { id: nextId("SU") } } };
    },
    SetOptions: (v) => {
      const f = state.projects.flatMap((p) => p.fields).find((x) => x.id === v.fieldId);
      f.options = v.options.map((o) => ({ id: nextId("O"), name: o.name, color: o.color }));
      return { updateProjectV2Field: { projectV2Field: { id: f.id } } };
    },
    CreateField: (v) => {
      const taken = projectById(v.projectId).fields.some((f) => f.name.toLowerCase() === v.name.toLowerCase());
      if (taken || RESERVED.has(v.name.toLowerCase()))
        return { errors: [{ type: "UNPROCESSABLE", message: "Name cannot have a reserved value, Name has already been taken" }] };
      const made = field({ name: v.name, dataType: v.dataType, options: v.options ?? undefined }, projectById(v.projectId));
      if (v.iteration) made.iteration = v.iteration;
      return { createProjectV2Field: { projectV2Field: { id: made.id } } };
    },
    DeleteField: (v) => {
      const p = state.projects.find((x) => x.fields.some((f) => f.id === v.fieldId));
      if (!p) return { errors: [{ type: "NOT_FOUND", message: "Could not resolve to a node" }] };
      p.fields = p.fields.filter((f) => f.id !== v.fieldId);
      for (const w of p.views) w.visibleFieldIds = w.visibleFieldIds.filter((id) => id !== v.fieldId);
      for (const it of p.items) delete it.values[v.fieldId];
      return { deleteProjectV2Field: { projectV2Field: { id: v.fieldId } } };
    },
    CreateView: (v) => {
      if (v.layout === "ROADMAP_LAYOUT" && v.fieldIds !== undefined)
        return { errors: [{ type: "UNPROCESSABLE", message: "Roadmap views do not support visible fields." }] };
      const made = { id: nextId("PVTV"), name: v.name, layout: v.layout, filter: null, visibleFieldIds: v.fieldIds ?? [] };
      projectById(v.projectId).views.push(made);
      return { createProjectV2View: { projectV2View: { id: made.id } } };
    },
    SetViewFilter: (v) => {
      const w = state.projects.flatMap((p) => p.views).find((x) => x.id === v.viewId);
      w.filter = v.filter;
      return { updateProjectV2View: { projectV2View: { id: w.id } } };
    },
    Items: (v) => {
      const p = projectById(v.id);
      const start = v.after ? Number(v.after) : 0;
      const nodes = p.items.slice(start, start + 100).map((it) => ({
        id: it.id,
        content: it.number === null ? null : { number: it.number },
        fieldValues: { nodes: Object.entries(it.values).map(([fid, value]) => valueNode(p.fields.find((f) => f.id === fid), value)) },
      }));
      const end = start + nodes.length;
      return { node: { items: { totalCount: p.items.length, pageInfo: { hasNextPage: end < p.items.length, endCursor: String(end) }, nodes } } };
    },
    AddItem: (v) => {
      const p = projectById(v.projectId);
      const issue = state.issues.find((i) => i.node_id === v.contentId);
      let item = p.items.find((it) => it.number === issue.number);
      if (!item) {
        item = { id: nextId("PVTI"), number: issue.number, values: {} };
        p.items.push(item);
      }
      return { addProjectV2ItemById: { item: { id: item.id } } };
    },
    UserId: (v) => ({ user: { id: `U_${v.login}` } }),
    CreateIssue: ({ input }) => {
      if (input.repositoryId !== "R_specs") return { errors: [{ type: "FORBIDDEN", message: "issues go to the issue repository only" }] };
      // GitHub makes nothing when the parent is full.
      const full = input.parentIssueId && state.issues.find((i) => i.node_id === input.parentIssueId);
      if (full && (state.subIssues.get(full.number) ?? []).length >= state.subIssueMax) return { errors: [{ type: "UNPROCESSABLE", message: "Parent cannot have more than 100 sub-issues" }] };
      const made = addIssue({
        title: input.title,
        body: input.body,
        labels: input.labelIds.map((id) => id.slice("LA_".length)),
        milestone: input.milestoneId ? milestoneOf(Number(input.milestoneId.slice("MI_".length))) : null,
        assignees: (input.assigneeIds ?? []).map((id) => id.slice("U_".length)),
      });
      const placed = (input.projectV2Ids ?? []).map((id) => {
        const item = { id: nextId("PVTI"), number: made.number, values: {} };
        projectById(id).items.push(item);
        return { id: item.id, project: { id } };
      });
      if (input.parentIssueId) {
        const parent = state.issues.find((i) => i.node_id === input.parentIssueId);
        state.subIssues.set(parent.number, [...(state.subIssues.get(parent.number) ?? []), made.id]);
      }
      return { createIssue: { issue: { id: made.node_id, databaseId: made.id, number: made.number, title: made.title, body: made.body, projectItems: { nodes: placed } } } };
    },
    SetFields: (v) => {
      const p = projectById(v.projectId);
      const item = p.items.find((it) => it.id === v.itemId);
      const out = {};
      for (const key of Object.keys(v).filter((k) => /^f\d+$/.test(k))) {
        item.values[v[key]] = v[`v${key.slice(1)}`];
        out[key] = { projectV2Item: { id: item.id } };
      }
      return out;
    },
  };

  async function fetchImpl(url, init = {}) {
    const method = init.method ?? "GET";
    const parsed = new URL(url);
    const body = init.body ? JSON.parse(init.body) : undefined;
    if (parsed.pathname === "/graphql") {
      const op = body.query.match(/^\s*(query|mutation)\s+(\w+)/)?.[2];
      requests.push({ method, path: "/graphql", op, mutation: /^\s*mutation\b/.test(body.query), body, headers: init.headers });
      const answer = OPS[op];
      if (!answer) return json({ errors: [{ type: "UNKNOWN_OPERATION", message: `no fake for ${op}` }] });
      const data = answer(body.variables ?? {});
      return json(data.errors ? data : { data });
    }
    requests.push({ method, path: parsed.pathname, repo: parsed.pathname.match(/^\/repos\/[^/]+\/([^/]+)/)?.[1], query: parsed.search, body, headers: init.headers });
    return restAnswer(method, parsed.pathname, parsed.searchParams, body);
  }

  /** The requests that write: every non-GET REST call and every mutation. */
  const writes = () => requests.filter((r) => (r.path === "/graphql" ? r.mutation : r.method !== "GET"));

  return { state, requests, writes, fetchImpl };
}

/** Whether a request creates an issue: GraphQL's createIssue (the import) or a REST POST to /issues. */
export function createsIssue(url, init = {}) {
  if (init.method !== "POST") return false;
  if (new URL(url).pathname === "/graphql") return /^\s*mutation\s+CreateIssue\b/.test(JSON.parse(init.body).query);
  return new URL(url).pathname.endsWith("/issues");
}

/** The title an issue-creating request carries. */
export const createdTitle = (init) => {
  const body = JSON.parse(init.body);
  return body.variables?.input?.title ?? body.title;
};

/** A clock that only moves when the code under test sleeps. */
export function fakeClock() {
  const c = { t: 0, waits: [] };
  c.now = () => c.t;
  c.sleep = async (ms) => {
    c.waits.push(ms);
    c.t += ms;
  };
  return c;
}
