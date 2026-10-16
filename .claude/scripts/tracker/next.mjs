// The next task to take, for `tracker-sync.mjs next [--epic EP-<n>]`: the
// open issues without `needs-confirmation` (of one epic when named), found by
// REST issue search, not `gh project item-list`, which spends the GraphQL
// quota on every item of the Project. One GraphQL `nodes` read per 100 issues
// brings their Project Status and Priority and their open blockers; only
// To do issues with no open blocker are kept, ordered by Priority, then by
// number.
import { isContainer } from "./issues.mjs";
import { rank } from "./ready.mjs";
import { ISSUE_REPO, OWNER } from "./repos.mjs";

const PROJECT_TITLE = "MotorFix";
const single = (name) => `${name.toLowerCase()}: fieldValueByName(name: "${name}") { ... on ProjectV2ItemFieldSingleSelectValue { name } }`;
const TRIAGE = `query Triage($ids: [ID!]!) { nodes(ids: $ids) { ... on Issue { id projectItems(first: 10) { nodes { project { title } ${single("Status")} ${single("Priority")} } } blockedBy(first: 50) { nodes { state } } } } }`;
const BATCH = 100;
/** GitHub's search answers at most 1,000 results, 100 a page. */
const SEARCH_PAGES = 10;

async function search(github, q) {
  const all = [];
  for (let page = 1; page <= SEARCH_PAGES; page++) {
    const { items = [] } = await github.rest("GET", `/search/issues?q=${encodeURIComponent(q)}&per_page=100&page=${page}`);
    all.push(...items);
    if (items.length < 100) break;
  }
  return all;
}

/** The issues to take next, highest priority first, then by number: [{ id, number, title, url, priority }]. */
export async function nextTasks(github, { epic } = {}) {
  if (epic !== undefined && !/^EP-\d+$/.test(epic)) throw new Error(`next: --epic is EP-<n>, not "${epic}"`);
  const q = `repo:${OWNER}/${ISSUE_REPO} is:issue is:open -label:needs-confirmation${epic ? ` label:${epic}` : ""}`;
  const issues = (await search(github, q)).filter((i) => !i.pull_request && !isContainer(i));
  const triage = new Map();
  for (let i = 0; i < issues.length; i += BATCH) {
    const { nodes } = await github.graphql(TRIAGE, { ids: issues.slice(i, i + BATCH).map((issue) => issue.node_id) });
    for (const n of nodes ?? []) {
      if (!n) continue;
      const item = n.projectItems?.nodes?.find((it) => it.project?.title === PROJECT_TITLE);
      triage.set(n.id, {
        status: item?.status?.name ?? "To do",
        priority: item?.priority?.name ?? null,
        blocked: (n.blockedBy?.nodes ?? []).some((b) => b.state === "OPEN"),
      });
    }
  }
  return issues
    .filter((issue) => triage.get(issue.node_id)?.status === "To do" && !triage.get(issue.node_id).blocked)
    .map((issue) => ({
      id: issue.title.match(/^((?:ST|EP)-\d+)\b/)?.[1] ?? `#${issue.number}`,
      number: issue.number,
      title: issue.title,
      url: issue.html_url,
      priority: triage.get(issue.node_id).priority,
    }))
    .sort((a, b) => rank(a.priority) - rank(b.priority) || a.number - b.number);
}
