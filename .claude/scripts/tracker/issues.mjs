// The tracker's reads and writes on GitHub: an issue of the issue repository
// found by the ID its title starts with, its item and field values in Project
// "MotorFix", its "blocked by" dependencies and sub-issues, and the label,
// comment, state and field writes the lifecycle makes (tracker-sync.mjs).
import { findProject, projectState } from "./bootstrap.mjs";
import { GitHubError } from "./github.mjs";
import { ISSUE_REPO, OWNER } from "./repos.mjs";

export const READY_LABEL = "ready to work";
/** Issues that hold others and are never a unit of work: never ready, never counted for the epic's Done. */
export const CONTAINER_LABELS = ["epic", "type: feature", "type: group"];
export const issueUrl = (number) => `https://github.com/${OWNER}/${ISSUE_REPO}/issues/${number}`;

export const ADD_ITEM = "mutation AddItem($projectId: ID!, $contentId: ID!) { addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) { item { id } } }";

/** One aliased mutation that sets every listed field of an item. */
export function setFieldsMutation(count) {
  const vars = Array.from({ length: count }, (_, i) => `, $f${i}: ID!, $v${i}: ProjectV2FieldValue!`).join("");
  const sets = Array.from(
    { length: count },
    (_, i) => `f${i}: updateProjectV2ItemFieldValue(input: { projectId: $projectId, itemId: $itemId, fieldId: $f${i}, value: $v${i} }) { projectV2Item { id } }`,
  ).join(" ");
  return `mutation SetFields($projectId: ID!, $itemId: ID!${vars}) { ${sets} }`;
}

const fieldName = "field { ... on ProjectV2FieldCommon { name } }";
const values = (n) =>
  `fieldValues(first: ${n}) { nodes { ... on ProjectV2ItemFieldSingleSelectValue { name ${fieldName} } ... on ProjectV2ItemFieldDateValue { date ${fieldName} } ... on ProjectV2ItemFieldTextValue { text ${fieldName} } ... on ProjectV2ItemFieldNumberValue { number ${fieldName} } } }`;
// A dependency only needs its state and Status, so its connections are kept small (GitHub caps a query at 500,000 nodes).
const LINKED = `id databaseId number title url state labels(first: 20) { nodes { name } } projectItems(first: 3) { nodes { id project { id } ${values(20)} } }`;
const DETAIL = `id databaseId number title url state labels(first: 50) { nodes { name } } projectItems(first: 5) { nodes { id project { id } ${values(30)} } } blockedBy(first: 20) { nodes { ${LINKED} } } subIssues(first: 50) { nodes { ${LINKED} } }`;
const ISSUE_DETAIL = `query IssueDetail($id: ID!) { node(id: $id) { ... on Issue { ${DETAIL} } } }`;
const LABEL_ISSUES = `query LabelIssues($owner: String!, $repo: String!, $label: String!, $after: String) { repository(owner: $owner, name: $repo) { issues(first: 50, after: $after, states: OPEN, labels: [$label]) { pageInfo { hasNextPage endCursor } nodes { ${DETAIL} } } } }`;
const MAX_LABEL_PAGES = 20;

/** The ID an issue's title starts with (ST-12, EP-6), else its number. */
export const idOf = (issue) => issue.title.match(/^((?:ST|EP)-\d+)\b/)?.[1] ?? `#${issue.number}`;
const labelNames = (issue) => (issue.labels?.nodes ?? issue.labels ?? []).map((l) => (typeof l === "string" ? l : l.name));
export const isContainer = (issue) => labelNames(issue).some((l) => CONTAINER_LABELS.includes(l));
export const epicLabel = (issue) => labelNames(issue).find((l) => /^EP-\d+$/.test(l)) ?? null;

/** An issue node's item in the Project and its values by field name, or null when it has none there. */
function itemIn(node, projectId) {
  const item = node.projectItems?.nodes?.find((it) => it.project?.id === projectId);
  if (!item) return null;
  const vals = {};
  for (const v of item.fieldValues?.nodes ?? []) if (v.field) vals[v.field.name] = v.name ?? v.date ?? v.number ?? v.text;
  return { id: item.id, values: vals };
}

/** An issue as the tracker reads it: open or closed, its Project values, labels and dependencies. */
function shape(node, projectId) {
  const item = itemIn(node, projectId);
  const out = {
    nodeId: node.id,
    id: node.databaseId,
    number: node.number,
    title: node.title,
    url: node.url ?? issueUrl(node.number),
    open: node.state === "OPEN",
    labels: labelNames(node),
    itemId: item?.id ?? null,
    values: item?.values ?? {},
  };
  out.key = idOf(out);
  if (node.blockedBy) out.blockedBy = node.blockedBy.nodes.map((n) => shape(n, projectId));
  if (node.subIssues) out.subIssues = node.subIssues.nodes.map((n) => shape(n, projectId));
  return out;
}

/** The status a dependency counts with: a closed issue is finished whatever its Status says. */
export const statusOf = (issue) => (issue.open ? (issue.values.Status ?? "To do") : "Done");

export function tracker(github) {
  let project;
  let issues;

  async function theProject() {
    if (project) return project;
    const found = (await findProject(github)).project;
    if (!found) throw new GitHubError("project", 'no Project "MotorFix" for this token');
    const { fields } = await projectState(github, found.id);
    project = { ...found, fields };
    return project;
  }

  /** Every issue of the repository (pull requests aside), read once per run. */
  async function allIssues() {
    issues ??= (await github.pages("issues?state=all&per_page=100")).filter((i) => !i.pull_request);
    return issues;
  }

  /** The issue titled with `key` (ST-n, EP-n), with its Project values and dependencies; null when none is. */
  async function find(key, { label } = {}) {
    const re = new RegExp(`^${key}\\b`);
    const hit = (await allIssues()).find((i) => re.test(i.title) && (!label || labelNames(i).includes(label)));
    return hit ? detail(hit.node_id) : null;
  }

  async function detail(nodeId) {
    const { id } = await theProject();
    return shape((await github.graphql(ISSUE_DETAIL, { id: nodeId })).node, id);
  }

  /** The open issues carrying `label`, each with its values and dependencies. */
  async function labelled(label) {
    const { id } = await theProject();
    const out = [];
    for (let after = null, page = 0; ; ) {
      if (++page > MAX_LABEL_PAGES) throw new GitHubError("pages", `issues labelled ${label}: more than ${MAX_LABEL_PAGES} pages`);
      const list = (await github.graphql(LABEL_ISSUES, { owner: OWNER, repo: ISSUE_REPO, label, after })).repository.issues;
      out.push(...list.nodes.map((n) => shape(n, id)));
      if (!list.pageInfo.hasNextPage) return out;
      after = list.pageInfo.endCursor;
    }
  }

  /** The issue's item id, adding it to the Project when it has none. */
  async function ensureItem(issue) {
    if (issue.itemId) return issue.itemId;
    const { id } = await theProject();
    issue.itemId = (await github.graphql(ADD_ITEM, { projectId: id, contentId: issue.nodeId }, { idempotent: true })).addProjectV2ItemById.item.id;
    return issue.itemId;
  }

  /** Sets fields by name in one request; a field or option the Project lacks is skipped and named. */
  async function setFields(issue, fields) {
    const { id, fields: all } = await theProject();
    const variables = { projectId: id, itemId: await ensureItem(issue) };
    const skipped = [];
    let i = 0;
    for (const [name, value] of Object.entries(fields)) {
      const field = all.find((f) => f.name === name);
      const option = field?.dataType === "SINGLE_SELECT" ? field.options?.find((o) => o.name === value) : null;
      if (!field || (field.dataType === "SINGLE_SELECT" && !option)) {
        skipped.push(name);
        continue;
      }
      variables[`f${i}`] = field.id;
      variables[`v${i}`] = option ? { singleSelectOptionId: option.id } : field.dataType === "NUMBER" ? { number: value } : field.dataType === "TEXT" ? { text: value } : { date: value };
      i++;
    }
    if (i) await github.graphql(setFieldsMutation(i), variables, { idempotent: true });
    Object.assign(issue.values, Object.fromEntries(Object.entries(fields).filter(([name]) => !skipped.includes(name))));
    return skipped;
  }

  const addLabels = (issue, labels) => github.rest("POST", `issues/${issue.number}/labels`, { labels }, { idempotent: true });
  async function removeLabel(issue, label) {
    try {
      await github.rest("DELETE", `issues/${issue.number}/labels/${encodeURIComponent(label)}`, undefined, { idempotent: true });
    } catch (error) {
      if (!(error instanceof GitHubError && error.type === "404")) throw error;
    }
  }
  const comment = (issue, body) => github.rest("POST", `issues/${issue.number}/comments`, { body });
  const close = (issue) => github.rest("PATCH", `issues/${issue.number}`, { state: "closed", state_reason: "completed" });

  /** A new issue, in the Project with `fields`, and under `parent` when one is given. */
  async function create({ title, body, labels, fields, parent }) {
    const made = await github.rest("POST", "issues", { title, body, labels });
    const issue = { nodeId: made.node_id, id: made.id, number: made.number, title: made.title, url: made.html_url ?? issueUrl(made.number), open: true, labels, itemId: null, values: {} };
    await setFields(issue, fields);
    let placed = true;
    if (parent) {
      try {
        await github.rest("POST", `issues/${parent.number}/sub_issues`, { sub_issue_id: made.id });
      } catch (error) {
        // A parent at GitHub's 100 sub-issues: the issue stands, outside it.
        if (!(error instanceof GitHubError && error.type === "422")) throw error;
        placed = false;
      }
    }
    return { ...issue, placed };
  }

  return { project: theProject, find, labelled, ensureItem, setFields, addLabels, removeLabel, comment, close, create };
}
