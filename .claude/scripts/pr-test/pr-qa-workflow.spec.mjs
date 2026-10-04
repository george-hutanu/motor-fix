import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { ARTIFACT_PREFIX, WORKFLOW } from './dispatch.mjs';
import { EXTERNAL_PORTS, appEnv } from './services.mjs';

// The PR tester's heavy half runs on GitHub Actions (.github/workflows/pr-qa.yml).
// The repo carries no YAML parser of its own, so the shape is read from the text:
// the file keeps one key per line and two-space indentation, like ci.yml.
const file = fileURLToPath(new URL(`../../../.github/workflows/${WORKFLOW}`, import.meta.url));
const text = readFileSync(file, 'utf8');
const lines = text.split('\n');
const code = lines.filter((l) => !/^\s*#/.test(l)).join('\n');

/** The lines nested under the first `key:` line at `indent` spaces. */
function block(key, indent = 0, from = lines) {
  const start = from.findIndex((l) => l === `${' '.repeat(indent)}${key}:` || l.startsWith(`${' '.repeat(indent)}${key}: `));
  assert.notEqual(start, -1, `${key}: not found at indent ${indent}`);
  const out = [];
  for (const l of from.slice(start + 1)) {
    if (l.trim() && !l.startsWith(' '.repeat(indent + 1))) break;
    out.push(l);
  }
  return out;
}
const keysAt = (body, indent) => body.filter((l) => new RegExp(`^ {${indent}}[A-Za-z_-]+:`).test(l)).map((l) => l.trim().split(':')[0]);
const job = block('qa', 2, block('jobs'));
const steps = block('steps', 4, job).join('\n');

describe('PR QA workflow: trigger', () => {
  it('is dispatched by hand only, never on push or pull_request', () => {
    assert.deepEqual(keysAt(block('on'), 2), ['workflow_dispatch']);
  });

  it('takes the PR number, the head SHA, the lap, the routes, the flows and a nonce', () => {
    const inputs = block('inputs', 4, block('workflow_dispatch', 2, block('on')));
    assert.deepEqual(keysAt(inputs, 6), ['pr', 'sha', 'lap', 'routes', 'flows', 'nonce']);
    for (const name of ['pr', 'sha']) assert.ok(block(name, 6, inputs).some((l) => l.trim() === 'required: true'), `${name} is required`);
  });

  it('names the run after its nonce, so the dispatcher can find it', () => {
    assert.match(code, /^run-name: .*\$\{\{ inputs\.nonce \}\}/m);
  });

  it('reads the repository only', () => {
    assert.deepEqual(block('permissions').map((l) => l.trim()).filter(Boolean), ['contents: read']);
  });
});

describe('PR QA workflow: no secrets', () => {
  it('references no secret, not even GITHUB_TOKEN', () => {
    assert.doesNotMatch(code, /secrets\./);
    assert.doesNotMatch(code, /GITHUB_TOKEN|github\.token|ANTHROPIC|TYPESAFE/i);
  });

  it('keeps no git credentials in either checkout', () => {
    const checkouts = code.match(/uses: actions\/checkout@v\d+/g) ?? [];
    const persisted = code.match(/persist-credentials: false/g) ?? [];
    assert.ok(checkouts.length >= 2);
    assert.equal(persisted.length, checkouts.length);
  });

  it('never splices an input straight into a shell script', () => {
    // Inputs reach run: scripts through env, so a crafted value cannot become shell code.
    const scripts = [];
    let inRun = false;
    for (const l of job) {
      if (/^\s+(- )?run: \|/.test(l)) inRun = l.search(/\S/);
      else if (/^\s+(- )?run: /.test(l)) scripts.push(l);
      else if (inRun !== false && l.trim() && l.search(/\S/) <= inRun) inRun = false;
      if (inRun !== false) scripts.push(l);
    }
    assert.ok(scripts.length > 0);
    for (const l of scripts) assert.doesNotMatch(l, /\$\{\{\s*(inputs|github\.event)\./, l.trim());
  });
});

describe('PR QA workflow: the commit tested is the commit asked for', () => {
  it('checks the PR out at the SHA input, with the history nx affected needs', () => {
    assert.match(steps, /ref: \$\{\{ inputs\.sha \}\}/);
    assert.match(steps, /path: pr\n\s+fetch-depth: 0/);
  });

  it('refuses a malformed SHA and a checkout at any other commit', () => {
    assert.match(steps, /\^\[0-9a-f\]\{40\}\$/);
    assert.match(steps, /git -C pr rev-parse HEAD\)" = "\$SHA"/);
  });

  it('runs the tester from the dispatched ref, not from the PR under test', () => {
    assert.match(steps, /path: tester/);
    assert.match(steps, /node tester\/\.claude\/scripts\/pr-test\/run\.mjs "\$PR" --tree pr --sha "\$SHA"/);
  });
});

describe('PR QA workflow: services', () => {
  const services = block('services', 4, job);

  it('runs PostgreSQL with PostGIS and Redis as service containers on the standard ports', () => {
    assert.deepEqual(keysAt(services, 6), ['postgres', 'redis']);
    assert.ok(services.some((l) => l.includes('image: postgis/postgis:')));
    assert.ok(services.some((l) => l.includes('image: redis:')));
    assert.ok(services.some((l) => l.includes(`'${EXTERNAL_PORTS.postgres}:5432'`)));
    assert.ok(services.some((l) => l.includes(`'${EXTERNAL_PORTS.redis}:6379'`)));
  });

  it('starts MinIO beside them and creates the bucket the apps are given', () => {
    // A service container cannot be given a command, and MinIO needs `server /data`.
    const env = appEnv({ ports: EXTERNAL_PORTS });
    assert.match(steps, new RegExp(`docker run [^\\n]*-p ${EXTERNAL_PORTS.minio}:9000[^\\n]*minio/minio[^\\n]* server /data`));
    assert.match(steps, new RegExp(`MINIO_ROOT_USER=${env.STORAGE_ACCESS_KEY_ID}\\b`));
    assert.match(steps, new RegExp(`MINIO_ROOT_PASSWORD=${env.STORAGE_SECRET_ACCESS_KEY}\\b`));
    assert.match(steps, new RegExp(`mc mb --ignore-existing local/${env.STORAGE_BUCKET}\\b`));
  });

  it('gives PostgreSQL the credentials the apps connect with', () => {
    const url = new URL(appEnv({ ports: EXTERNAL_PORTS }).DATABASE_URL);
    const env = block('env', 8, services).map((l) => l.trim());
    assert.ok(env.includes(`POSTGRES_USER: ${url.username}`));
    assert.ok(env.includes(`POSTGRES_PASSWORD: ${url.password}`));
    assert.ok(env.includes(`POSTGRES_DB: ${url.pathname.slice(1)}`));
  });
});

describe('PR QA workflow: the run and its evidence', () => {
  it('installs Playwright Chromium for the sweep, the flows and e2e', () => {
    assert.match(steps, /npx playwright install --with-deps chromium/);
  });

  it('decodes the flows input (gzip, then base64) into a file the run imports', () => {
    assert.match(steps, /base64 -d \| gunzip > "\$RUNNER_TEMP\/flows\.mjs"/);
    assert.match(steps, /--flows "\$RUNNER_TEMP\/flows\.mjs"/);
  });

  it('runs inside the slot it already has: HEAVY_HELD, no heavy.sh on the runner', () => {
    assert.match(block('env', 4, job).join('\n'), /HEAVY_HELD: '1'/);
  });

  it('prints the readiness lines, so storage up is visible in the log', () => {
    assert.match(steps, /grep [^\n]*'ready '[^\n]*run\.log/);
  });

  it('uploads report.md, report.json and the screenshots as an artifact, even after a failing run', () => {
    const upload = steps.slice(steps.indexOf('uses: actions/upload-artifact@'));
    assert.ok(upload.length > 0);
    assert.match(upload, /if: always\(\)/);
    assert.match(upload, new RegExp(`name: ${ARTIFACT_PREFIX}\\$\\{\\{ inputs\\.pr \\}\\}`));
    assert.match(upload, /path: \$\{\{ runner\.temp \}\}\/pr-qa\n/);
    assert.match(upload, /retention-days: \d+/);
    assert.match(upload, /if-no-files-found: error/);
  });
});
