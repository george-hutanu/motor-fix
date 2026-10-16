// The next task of an epic, for `tracker-sync.mjs next --epic EP-<n>`: the
// open issues labelled with the epic and `ready to work`, less those that need
// the owner's confirmation, found by REST issue search (not `gh project
// item-list`, which spends the GraphQL quota on every item of the Project),
// then ordered by their Project Priority (one GraphQL `nodes` read per 100
// issues) and their number (1323-FR-006).
import { isContainer, READY_LABEL } from "./issues.mjs";
import { rank } from "./ready.mjs";
import { ISSUE_REPO, OWNER } from "./repos.mjs";

const PROJECT_TITLE = "MotorFix";
const PRIORITIES = `query Priorities($ids: [ID!]!) { nodes(ids: $ids) { ... on Issue { id projectItems(first: 10) { nodes { project { title } fieldValueByName(name: "Priority") { ... on ProjectV2ItemFieldSingleSelectValue { name } } } } } } }`;
const BATCH = 100;

/** The epic's ready issues, highest priority first, then by number: [{ id, number, title, url, priority }]. */
export async function nextTasks(github, epic) {
  if (!/^EP-\d+$/.test(epic ?? "")) throw new Error(`next: --epic is EP-<n>, not "${epic}"`);
  const q = `repo:${OWNER}/${ISSUE_REPO} is:issue is:open label:${epic} label:"${READY_LABEL}" -label:needs-confirmation`;
  const { items = [] } = await github.rest("GET", `/search/issues?q=${encodeURIComponent(q)}&per_page=100`);
  const issues = items.filter((i) => !i.pull_request && !isContainer(i));
  const priority = new Map();
  for (let i = 0; i < issues.length; i += BATCH) {
    const ids = issues.slice(i, i + BATCH).map((issue) => issue.node_id);
    const { nodes } = await github.graphql(PRIORITIES, { ids });
    for (const n of nodes ?? []) {
      const item = n?.projectItems?.nodes?.find((it) => it.project?.title === PROJECT_TITLE);
      if (n) priority.set(n.id, item?.fieldValueByName?.name ?? null);
    }
  }
  return issues
    .map((issue) => ({
      id: issue.title.match(/^((?:ST|EP)-\d+)\b/)?.[1] ?? `#${issue.number}`,
      number: issue.number,
      title: issue.title,
      url: issue.html_url,
      priority: priority.get(issue.node_id) ?? null,
    }))
    .sort((a, b) => rank(a.priority) - rank(b.priority) || a.number - b.number);
}
