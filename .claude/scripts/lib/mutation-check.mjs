// The Mutation workflow (.github/workflows/mutation.yml) runs on main's
// schedule and by hand, never in a task's lifecycle: a run someone starts on a
// PR head is no part of that PR, so no wait, gate or summary reads its checks.

export const MUTATION_WORKFLOW = "Mutation";

/** A check run of the Mutation workflow: gh's rollup names it workflowName, `gh pr checks` workflow. A commit status never is one. */
export const isMutationCheck = (c) => c?.__typename !== "StatusContext" && (c?.workflowName ?? c?.workflow) === MUTATION_WORKFLOW;
