// Audits what this branch adds to the CODE, for the failure modes biome, tsc
// and vitest each structurally cannot see. Everything here is a rule that is
// either cross-file (no linter has the whole graph), build-time-only (tsc is
// lenient where the bundler is not), or specific to this repo's stack.
//
//   node .claude/scripts/diff-audit.mjs            # report, semantic lane on
//   node .claude/scripts/diff-audit.mjs --check    # exit 1 on any ERROR, lane off
//   node .claude/scripts/diff-audit.mjs --no-jev   # report without the lane
//
// The lane judges each new dependency against Principle I. Same default as
// artifact-lint and for the same reason: on for a report, off for --check,
// forced on by --jev. It cannot reach the exit code — its findings are WARN.
//
// Deliberately NOT here: anything biome.jsonc already runs. A second linter is
// bloat; this is the complement to the first one.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, basename, dirname, relative } from "node:path";
import { importStyle } from "./lib/tsconfig.mjs";

const repo = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
const check = process.argv.includes("--check");
const useJev =
  !process.argv.includes("--no-jev") && (process.argv.includes("--jev") || !check);
const findings = [];
const add = (level, rule, where, message) => findings.push({ level, rule, where, message });

const git = (args) => {
  try {
    return execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return "";
  }
};

const base = git(["merge-base", "HEAD", "main"]).trim();
const changed = [
  ...new Set(
    [
      base ? git(["diff", "--name-only", `${base}..HEAD`]) : "",
      git(["diff", "--name-only", "HEAD"]),
      git(["ls-files", "--others", "--exclude-standard"]),
    ]
      .join("\n")
      .split("\n")
      .filter(Boolean),
  ),
].filter((f) => existsSync(join(repo, f)));

const isSpec = (f) => /\.(spec|test)\.[cm]?tsx?$/.test(f);
const isSource = (f) => /^(apps|libs)\/[^/]+\/src\/.+\.tsx?$/.test(f) && !isSpec(f);
const sources = changed.filter(isSource);

// Added lines only: a rule that fires on pre-existing code turns the audit into
// noise the reader learns to skip.
const addedLines = (file) => {
  const diff = base ? git(["diff", `${base}..HEAD`, "--", file]) + git(["diff", "HEAD", "--", file]) : "";
  const fromDiff = diff
    .split("\n")
    .filter((l) => l.startsWith("+") && !l.startsWith("+++"))
    .map((l) => l.slice(1));
  // Untracked files have no diff; every line is new.
  return fromDiff.length > 0 ? fromDiff : readFileSync(join(repo, file), "utf8").split("\n");
};

// One pass over the repo's own sources, reused by the cross-file rules below.
const SKIP = new Set(["node_modules", "dist", "coverage", ".turbo", ".work", ".worktrees", ".git", ".stryker-tmp"]);
const allTs = [];
const walk = (dir) => {
  for (const name of existsSync(dir) ? readdirSync(dir) : []) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.[cm]?tsx?$/.test(name)) allTs.push(p);
  }
};
for (const root of ["apps", "libs", "e2e"]) walk(join(repo, root));
const corpus = allTs.map((p) => ({ path: relative(repo, p), text: readFileSync(p, "utf8") }));

// 1. Dead surface — an export nothing imports. Principle I: unused API is the
//    cheapest bloat to write and the most expensive to delete later.
for (const file of sources) {
  const text = readFileSync(join(repo, file), "utf8");
  const names = [
    ...[...text.matchAll(/^export\s+(?:async\s+)?(?:const|function|class|type|interface|enum)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]),
    ...[...text.matchAll(/^export\s*\{([^}]+)\}/gm)].flatMap((m) =>
      m[1].split(",").map((n) => n.trim().split(/\s+as\s+/).pop()).filter(Boolean),
    ),
  ];
  for (const name of new Set(names)) {
    const users = corpus.filter((f) => f.path !== file && new RegExp(`\\b${name}\\b`).test(f.text));
    if (users.length === 0) {
      add("ERROR", "dead-export", `${file}`, `\`${name}\` is exported and imported nowhere`);
    } else if (users.every((f) => isSpec(f.path))) {
      add("WARN", "test-only-export", `${file}`, `\`${name}\` is exported only for its own test — consider keeping it private`);
    }
  }
}

// 2. Relative import extensions. nodenext projects need a literal extension
//    (`.js`, or `.ts` where the tsconfig allows importing it); bundler
//    projects must not have `.js`. The file's own tsconfig decides
//    (lib/tsconfig.mjs), never its path.
for (const file of changed.filter((f) => /\.tsx?$/.test(f))) {
  const resolution = importStyle(repo, file);
  const wantsJs = resolution?.style === "nodenext";
  const forbidsJs = resolution?.style === "bundler";
  const accepted = resolution?.tsExtensions ? /\.([mc]?js|[mc]?ts|tsx)$/ : /\.[mc]?js$/;
  if (!wantsJs && !forbidsJs) continue;
  for (const line of addedLines(file)) {
    const m = line.match(/(?:from|import)\s+['"](\.[^'"]*)['"]/);
    if (!m) continue;
    const spec = m[1];
    if (/\.(json|css|svg|png|jpg|txt|md)$/.test(spec)) continue;
    if (wantsJs && !accepted.test(spec)) {
      const literal = resolution.tsExtensions ? ".js or .ts" : ".js";
      add("ERROR", "import-extension", file, `relative import '${spec}' needs the literal ${literal} extension under nodenext`);
    }
    if (forbidsJs && spec.endsWith(".js")) {
      add("ERROR", "import-extension", file, `relative import '${spec}' must drop .js under bundler resolution`);
    }
  }
}

// 3. New dependencies. Principle I treats one as a decision to justify, not a
//    detail — and the lockfile hides it from a diff read at speed. A runtime
//    dependency ships to production and is an ERROR to add silently; a dev one
//    is a WARN.
for (const file of changed.filter((f) => basename(f) === "package.json")) {
  const parse = (text) => {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  };
  const now = parse(readFileSync(join(repo, file), "utf8"));
  const before = base ? parse(git(["show", `${base}:${file}`])) : null;
  if (!now) continue;
  for (const [block, level] of [["dependencies", "ERROR"], ["devDependencies", "WARN"]]) {
    for (const name of Object.keys(now[block] ?? {})) {
      if (before && name in (before[block] ?? {})) continue;
      add(level, "new-dependency", file, `adds ${block === "dependencies" ? "runtime" : "dev"} dependency \`${name}\` — justify it against Principle I or drop it`);
    }
  }
}

// 4. Suppressions. Each one hides a real check; a branch that adds them is
//    usually paying down the wrong debt.
const SUPPRESS = /(biome-ignore|@ts-ignore|@ts-expect-error|eslint-disable|Stryker disable|\.skip\(|\.only\()/;
for (const file of changed.filter((f) => /\.[cm]?tsx?$/.test(f))) {
  for (const line of addedLines(file)) {
    const m = line.match(SUPPRESS);
    if (!m) continue;
    // A Stryker disable is the one suppression with a legitimate use here:
    // an equivalent mutant cannot be killed by any test. It still has to say
    // why on the same line, or it is indistinguishable from giving up.
    const equivalent = m[1] === "Stryker disable";
    add(equivalent ? "WARN" : "ERROR", "suppression", file,
      equivalent
        ? "adds a Stryker disable — keep it only for a genuinely equivalent mutant, and say which on the line"
        : `adds \`${m[1]}\` — fix the finding instead of silencing it`);
  }
}

// 5. Parameter-property DI in apps/server. AGENTS.md documents the trap: swc
//    can elide an import whose only use is a constructor parameter's type, and
//    `design:paramtypes` then degrades to Object, so Nest fails to resolve the
//    dependency under vitest while `nest build` compiles the same code fine.
//
//    A WARN, not an ERROR, because it does not always fire: a class whose
//    service import survives the transform resolves normally, and this repo has
//    a controller in exactly that state, boots it through TestingModule, and is
//    green. The signal worth raising is "this is the documented trap, and a
//    green suite is not proof you escaped it" — the tests decide, not the shape.
for (const file of sources.filter((f) => f.startsWith("apps/server/src/"))) {
  const text = readFileSync(join(repo, file), "utf8");
  if (/constructor\s*\([^)]*\b(private|protected|public|readonly)\b/s.test(text)) {
    add("WARN", "param-property-di", file, "parameter-property constructor — the documented vitest/swc DI trap; confirm a test actually instantiates this class");
  }
}

// 6. A new source file no test mentions. Not "untested" in the coverage sense —
//    nothing anywhere refers to it, which is the shape of code written ahead of
//    a need.
for (const file of sources) {
  const isNew = base ? !git(["ls-tree", base, "--", file]).trim() : true;
  if (!isNew) continue;
  // Nest plumbing (module/controller/dto) and fixtures are exercised through
  // the app's e2e suite rather than by a direct import, so this rule cannot
  // judge them.
  if (/\.(module|controller|dto)\.tsx?$|fixture/.test(basename(file))) continue;
  const stem = basename(file).replace(/\.tsx?$/, "");
  const sibling = join(repo, dirname(file), `${stem}.spec.ts`);
  if (existsSync(sibling)) continue;
  if (!corpus.some((f) => isSpec(f.path) && f.text.includes(`/${stem}.js`))) {
    add("WARN", "untested-new-file", file, "new source file, and no spec imports it");
  }
}

// 7. The human reviewer's recurring asks — each raised three or more times in
//    inline review on PRs 17–37, each a review round when missed. WARNs, not
//    ERRORs: every one has a legitimate exception the reviewer has also
//    accepted, so the finding says "justify or fix", not "wrong".
const SCANNER_SRC = /^apps\/scanner\/src\//;
const SYNC_IO = /\b(readFileSync|writeFileSync|appendFileSync|readdirSync|statSync|existsSync|execSync|spawnSync)\s*\(/;
for (const file of sources) {
  const added = addedLines(file);
  for (const line of added) {
    if (/\bwhile\s*\(\s*true\s*\)|\bfor\s*\(\s*;\s*;\s*\)/.test(line)) {
      add("WARN", "unbounded-loop", file, "`while (true)` / `for (;;)` — add a hard iteration cap or document the exit; an unbounded loop locks the scanner");
    }
    if (SCANNER_SRC.test(file) && /\bfor\s*\(\s*(const|let)\s+[^)]*\s+of\s+/.test(line)) {
      add("WARN", "for-of-in-scanner", file, "`for...of` in scanner source — indexed `for` on any per-file/per-line/per-match path (AGENTS.md); fine only for load-time loops over small collections");
    }
    if (SCANNER_SRC.test(file) && !/(config|startup|bootstrap|main)\.ts$/.test(file) && SYNC_IO.test(line)) {
      add("WARN", "sync-io-in-scanner", file, `synchronous I/O \`${line.match(SYNC_IO)[1]}\` in scanner source freezes the main thread — async, or justify as startup-only`);
    }
    if (/\[\s*['"]\.[a-z0-9]{1,5}['"]\s*,\s*['"]\.[a-z0-9]{1,5}['"]/.test(line)) {
      add("WARN", "extension-list", file, "hand-rolled file-extension list — the reviewer asks for `istextorbinary` every time; an extension list also misses the OOM case (large binary with a text extension)");
    }
  }
  const isNew = base ? !git(["ls-tree", base, "--", file]).trim() : true;
  if (isNew && basename(file) === "index.ts" && !/^libs\/[^/]+\/src\/index\.ts$/.test(file)) {
    add("WARN", "index-ts", file, "new `index.ts` outside a package barrel — name the file for what it holds; index files \"become messy once we have a lot of them\"");
  }
}

// 12. Is the new dependency carrying its weight? The rule above can see that
//     a name appeared in package.json; it cannot read the diff and say
//     whether the standard library or something already installed would have
//     done. That is the actual review question — the reviewer asks it on
//     every pull request — and it is the one judgement here that is not
//     mechanical. WARN-only, like every finding this lane produces: --check
//     still exits on the mechanical ERRORs alone.
if (useJev) {
  const deps = findings
    .filter((f) => f.rule === "new-dependency")
    .map((f) => ({ name: f.message.match(/`([^`]+)`/)?.[1], where: f.where }))
    .filter((d) => d.name);

  if (deps.length > 0) {
    const { ask, choice, choiceOf, qid, unavailableNote } = await import("./lib/jev.mjs");
    // The lines that actually use it, not the whole branch: a dependency is
    // justified by its call sites or not at all.
    const usage = (name) =>
      changed
        .filter((f) => /\.[cm]?tsx?$/.test(f))
        .flatMap((f) => addedLines(f).filter((l) => l.includes(name)).map((l) => `${f}: ${l.trim()}`))
        .slice(0, 20)
        .join("\n") || "(no added source line mentions it)";

    const questions = {};
    deps.forEach((dep, i) => {
      questions[qid("dep", i)] = choice(`Is dependency ${i} justified by how this branch uses it?`, {
        justified: "it does something non-trivial that node: builtins and the packages already installed do not",
        replaceable: "a node: builtin or an already-installed package would do this in comparable code",
        unused: "nothing in the diff actually uses it",
      });
    });

    const state = {
      principle:
        "Constitution Principle I: no bloated code. A dependency earns its place only if removing it would mean writing something genuinely hard.",
      dependencies: Object.fromEntries(deps.map((dep, i) => [String(i), { name: dep.name, manifest: dep.where, usage: usage(dep.name) }])),
    };
    const { answers, unavailable, reason } = await ask(state, questions, { repo });

    if (unavailable) console.log(unavailableNote(reason));
    else
      deps.forEach((dep, i) => {
        const verdict = choiceOf(answers[qid("dep", i)]);
        if (!verdict || verdict.choice === "justified") return;
        add(
          "WARN",
          "dependency-unjustified",
          dep.where,
          `\`${dep.name}\` looks ${verdict.choice} against Principle I (jev ${verdict.confidence.toFixed(2)}) — say why it stays, or drop it`,
        );
      });
  }
}

const errors = findings.filter((f) => f.level === "ERROR");
const order = ["dead-export", "import-extension", "suppression", "new-dependency", "dependency-unjustified", "unbounded-loop", "sync-io-in-scanner", "for-of-in-scanner", "extension-list", "param-property-di", "index-ts", "test-only-export", "untested-new-file"];
findings.sort((a, b) => order.indexOf(a.rule) - order.indexOf(b.rule));

console.log(
  `diff-audit: ${changed.length} changed file(s) vs ${base ? base.slice(0, 7) : "(no merge-base)"} — ` +
    `${errors.length} error(s), ${findings.length - errors.length} warning(s)`,
);
for (const f of findings) console.log(`  ${f.level === "ERROR" ? "✗" : "!"} [${f.rule}] ${f.where}: ${f.message}`);
if (findings.length === 0) console.log("  ✓ clean");

process.exit(check && errors.length > 0 ? 1 : 0);
