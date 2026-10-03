#!/usr/bin/env bash
# Create (or reuse) a git worktree under .worktrees/ for an unattended routine
# and make Spec Kit usable inside it. Never contacts a remote: <base-ref> must
# already resolve locally (e.g. origin/main as of the last human fetch).
#
# Usage: routine-worktree.sh <branch-name> <base-ref> [feature-dir]
#   feature-dir  optional, repo-relative (specs/NNN-slug); written to the
#                worktree's own .specify/feature.json
#
# Output: one JSON line {worktree, branch, base, feature_dir, reused}.
#
# Layout inside the worktree (all links relative so the same .git works from
# a differently mounted path):
#   specs, .claude                 -> symlinks to the main clone (shared)
#   .specify                       -> copy (feature.json is per-worktree)
#   .specify/memory, .specify/templates -> symlinks (single source)
#   node_modules                   -> directory of symlinks into the main
#                                     clone, except @blastradius/* which point
#                                     at this worktree's own workspaces
#   apps/*/node_modules etc.       -> symlinks to the main clone's nested dirs
#   libs/regex-engine/{index.js,index.d.ts,*.node} -> symlinks (git-ignored
#                                     napi build output; cannot be rebuilt
#                                     without cargo)

set -euo pipefail

if [[ $# -lt 2 || $# -gt 3 ]]; then
    echo "Usage: $0 <branch-name> <base-ref> [feature-dir]" >&2
    exit 2
fi
BRANCH="$1"
BASE_REF="$2"
FEATURE_DIR="${3:-}"

SCRIPT_DIR="$(CDPATH="" cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

# The main clone is wherever the common .git lives, even when this script runs
# from a worktree's copy of .specify/.
MAIN_ROOT="$(cd -- "$SCRIPT_DIR" && cd -- "$(git rev-parse --git-common-dir)/.." && pwd -P)"
[[ -d "$MAIN_ROOT/.specify" && -d "$MAIN_ROOT/node_modules" ]] || {
    echo "ERROR: $MAIN_ROOT lacks .specify/ or node_modules/" >&2
    exit 1
}

if ! BASE_COMMIT=$(git -C "$MAIN_ROOT" rev-parse --verify --quiet "${BASE_REF}^{commit}"); then
    echo "ERROR: base ref '$BASE_REF' does not resolve locally (no fetch is performed)" >&2
    exit 1
fi

WT_NAME="${BRANCH//\//-}"
WT_DIR="$MAIN_ROOT/.worktrees/$WT_NAME"
mkdir -p "$MAIN_ROOT/.worktrees"

# Keep `git status` (and Biome, which honours git's ignore files) clean in
# every checkout: the worktrees dir, plus symlink-safe forms of already
# ignored dirs — a trailing-slash pattern like `specs/` or `node_modules/`
# matches a directory but not the symlink a worktree gets.
EXCLUDE_FILE="$(git -C "$MAIN_ROOT" rev-parse --git-path info/exclude)"
for pattern in '/.worktrees' '/specs' '/.claude' 'node_modules'; do
    grep -qxF -- "$pattern" "$EXCLUDE_FILE" 2>/dev/null || echo "$pattern" >> "$EXCLUDE_FILE"
done

REUSED=false
if [[ -d "$WT_DIR" ]] && [[ "$(git -C "$WT_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null)" == "$BRANCH" ]]; then
    REUSED=true
else
    [[ -e "$WT_DIR" ]] && { echo "ERROR: $WT_DIR exists but is not a worktree on $BRANCH" >&2; exit 1; }
    git -C "$MAIN_ROOT" worktree prune
    ADD_OPTS=()
    # Relative gitdir pointers survive the repo being mounted at another path.
    add_help="$(git worktree add -h 2>&1 || true)"
    [[ "$add_help" == *relative-paths* ]] && ADD_OPTS+=(--relative-paths)
    if git -C "$MAIN_ROOT" show-ref --verify --quiet "refs/heads/$BRANCH"; then
        git -C "$MAIN_ROOT" worktree add "${ADD_OPTS[@]}" "$WT_DIR" "$BRANCH" >/dev/null
        REUSED=true
    else
        git -C "$MAIN_ROOT" worktree add "${ADD_OPTS[@]}" --no-track --no-guess-remote -b "$BRANCH" "$WT_DIR" "$BASE_COMMIT" >/dev/null
    fi
fi

# up N -> "../../.." (N segments). From a path at depth D below the worktree
# root, the main root is up(D + 2) because the worktree sits at
# <main>/.worktrees/<name>.
up() { local s=""; for ((i = 0; i < $1; i++)); do s+="../"; done; printf '%s' "${s%/}"; }

# link <target> <path>: (re)create a symlink; refuse to clobber a real path.
link() {
    if [[ -L "$2" ]]; then
        ln -sfn "$1" "$2"
    elif [[ -e "$2" ]]; then
        echo "ERROR: $2 exists and is not a symlink; refusing to replace it" >&2
        exit 1
    else
        ln -s "$1" "$2"
    fi
}

cd "$WT_DIR"
link "$(up 2)/specs" specs
link "$(up 2)/.claude" .claude

# .specify: fresh copy every run so script fixes propagate; only feature.json
# survives. memory/ and templates/ stay single-source via symlinks.
mkdir -p .specify
shopt -s dotglob nullglob
for entry in .specify/*; do
    [[ "$entry" == .specify/feature.json ]] || rm -rf "$entry"
done
for entry in "$MAIN_ROOT"/.specify/*; do
    case "$(basename "$entry")" in
        feature.json | memory | templates) ;;
        *) cp -R "$entry" .specify/ ;;
    esac
done
shopt -u dotglob nullglob
link "$(up 3)/.specify/memory" .specify/memory
link "$(up 3)/.specify/templates" .specify/templates

# The routine owns branching: disable the hooks that would create branches or
# init a repo, so the speckit skills skip them (they filter `enabled: false`).
awk '
    /^[[:space:]]+command: speckit\.git\.(feature|initialize)$/ { flip = 1 }
    flip && /^[[:space:]]+enabled: / { sub(/true/, "false"); flip = 0 }
    { print }
' .specify/extensions.yml > .specify/extensions.yml.tmp && mv .specify/extensions.yml.tmp .specify/extensions.yml

if [[ -n "$FEATURE_DIR" ]]; then
    _persist_feature_json "$WT_DIR" "$FEATURE_DIR"
fi

# node_modules: rebuilt from scratch each run (rm on a dir of symlinks never
# touches their targets).
rm -rf node_modules
mkdir node_modules
shopt -s dotglob nullglob
for entry in "$MAIN_ROOT"/node_modules/*; do
    name="$(basename "$entry")"
    if [[ "$name" == "@blastradius" ]]; then
        mkdir node_modules/@blastradius
        for ws in "$entry"/*; do
            # Relative targets like ../../libs/contracts resolve inside this worktree.
            ln -s "$(readlink "$ws")" "node_modules/@blastradius/$(basename "$ws")"
        done
    else
        ln -s "$(up 3)/node_modules/$name" "node_modules/$name"
    fi
done
shopt -u dotglob nullglob

# Nested workspace node_modules (version-conflict installs) and the git-ignored
# napi outputs the scanner imports.
while IFS= read -r nested; do
    rel="${nested#"$MAIN_ROOT"/}"
    [[ -d "$(dirname "$rel")" ]] || continue
    slashes="${rel//[^\/]/}"
    link "$(up $((${#slashes} + 2)))/$rel" "$rel"
done < <(find "$MAIN_ROOT/apps" "$MAIN_ROOT/libs" "$MAIN_ROOT/e2e" -mindepth 1 -maxdepth 2 -name node_modules -type d 2>/dev/null)

if [[ -d libs/regex-engine ]]; then
    for artifact in "$MAIN_ROOT"/libs/regex-engine/index.js "$MAIN_ROOT"/libs/regex-engine/index.d.ts "$MAIN_ROOT"/libs/regex-engine/*.node; do
        [[ -e "$artifact" ]] && link "$(up 4)/libs/regex-engine/$(basename "$artifact")" "libs/regex-engine/$(basename "$artifact")"
    done
fi

FEATURE_OUT="$(read_feature_json_feature_directory "$WT_DIR")"
if has_jq; then
    jq -cn --arg wt "$WT_DIR" --arg br "$BRANCH" --arg base "$BASE_COMMIT" --arg fd "$FEATURE_OUT" --argjson reused "$REUSED" \
        '{worktree:$wt,branch:$br,base:$base,feature_dir:(if $fd == "" then null else $fd end),reused:$reused}'
else
    fd_json=null
    [[ -n "$FEATURE_OUT" ]] && fd_json="\"$(json_escape "$FEATURE_OUT")\""
    printf '{"worktree":"%s","branch":"%s","base":"%s","feature_dir":%s,"reused":%s}\n' \
        "$(json_escape "$WT_DIR")" "$(json_escape "$BRANCH")" "$BASE_COMMIT" "$fd_json" "$REUSED"
fi
