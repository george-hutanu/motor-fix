import { afterEach, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../../scripts/cloud-setup.sh', import.meta.url));
const dirs = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const stub = (bin, name, body) => {
  writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`);
  chmodSync(join(bin, name), 0o755);
};

/**
 * Docker is up and Node 24 is in place. `config` is the exact stdout of
 * `docker compose config --images` (and `configStatus` its exit code); `present`
 * lists the images `docker image inspect` finds. An empty argument or a name
 * with stray whitespace is never present, as with the real CLI.
 */
function scene({ config, configStatus = 0, present = [], pullFails = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'cloud-setup-adv-'));
  dirs.push(root);
  const repo = join(root, 'repo');
  const bin = join(root, 'bin');
  const state = join(root, 'state');
  const home = join(root, 'home');
  for (const d of [join(repo, 'scripts'), bin, state, home]) mkdirSync(d, { recursive: true });
  copyFileSync(script, join(repo, 'scripts', 'cloud-setup.sh'));
  writeFileSync(join(repo, 'package-lock.json'), '{}');
  writeFileSync(join(state, 'node'), '24');
  writeFileSync(join(state, 'docker-up'), '');
  writeFileSync(join(state, 'config'), config);
  writeFileSync(join(state, 'images'), present.map((i) => `${i}\n`).join(''));
  if (pullFails) writeFileSync(join(state, 'pull-fails'), '');
  const log = join(state, 'log');
  writeFileSync(log, '');
  stub(bin, 'node', `v=$(cat ${state}/node); case "$1" in -p) echo "$v";; --version) echo "v$v.0.0";; esac`);
  stub(bin, 'npm', `echo "npm $*" >> ${log}; mkdir -p node_modules; touch node_modules/.package-lock.json`);
  stub(bin, 'docker', [
    'case "$1 $2" in',
    `  "info ") test -e ${state}/docker-up;;`,
    `  "compose config") echo "docker $*" >> ${log}; cat ${state}/config; exit ${configStatus};;`,
    `  "image inspect") echo "docker $*" >> ${log}; shift 2; [ $# -gt 0 ] || exit 1; for i; do case "$i" in ""|*[[:space:]]*) exit 1;; esac; grep -qxF "$i" ${state}/images || exit 1; done;;`,
    `  "compose pull") echo "docker $*" >> ${log}; [ ! -e ${state}/pull-fails ] || { echo 'toomanyrequests: 429' >&2; exit 1; }; cat ${state}/config >> ${state}/images;;`,
    `  *) echo "docker $*" >> ${log};;`,
    'esac',
  ].join('\n'));
  stub(bin, 'service', `touch ${state}/docker-up`);
  stub(bin, 'sudo', '[ "$1" = -n ] && shift; exec "$@"');
  stub(bin, 'id', 'echo 1000');
  stub(bin, 'npx', 'true');
  const run = () => spawnSync('/bin/bash', [join(repo, 'scripts', 'cloud-setup.sh')], {
    cwd: root,
    encoding: 'utf8',
    env: { PATH: `${bin}:/usr/bin:/bin`, HOME: home, CLAUDE_CODE_REMOTE: 'true', CLOUD_SETUP_NODE_SEARCH: `${root}/opt/none`, PLAYWRIGHT_BROWSERS_PATH: join(root, 'pw') },
  });
  const calls = () => readFileSync(log, 'utf8').trim().split('\n').filter(Boolean);
  const pulled = () => calls().includes('docker compose pull postgres redis');
  return { run, calls, pulled };
}

const PG = 'imresamu/postgis:17-3.5';
const RD = 'redis:7';

describe('cloud-setup.sh image check, hostile inputs', () => {
  // @traces 768-FR-001
  it('skips the pull when the image list has blank lines between and after the names', () => {
    const { run, pulled } = scene({ config: `\n${PG}\n\n${RD}\n\n`, present: [PG, RD] });
    const out = run();
    assert.equal(out.status, 0, out.stderr + out.stdout);
    assert.equal(pulled(), false);
    assert.match(out.stdout, /images present/);
  });

  // @traces 768-FR-001
  it('asks docker about each named image and nothing else', () => {
    const { run, calls } = scene({ config: `${PG}\n\n${RD}\n`, present: [PG, RD] });
    run();
    const asked = calls()
      .filter((c) => c.startsWith('docker image inspect'))
      .join(' ')
      .replace(/docker image inspect/g, ' ')
      .split(/\s+/)
      .filter(Boolean)
      .sort();
    assert.deepEqual(asked, [RD, PG].sort());
  });

  // @traces 768-FR-001
  it('skips the pull for images named by registry and digest', () => {
    const digest = `ghcr.io/org/pg@sha256:${'a'.repeat(64)}`;
    const { run, pulled } = scene({ config: `${digest}\nredis:7-alpine\n`, present: [digest, 'redis:7-alpine'] });
    const out = run();
    assert.equal(out.status, 0, out.stderr + out.stdout);
    assert.equal(pulled(), false);
  });

  // @traces 768-FR-001
  it('skips the pull when the same image is listed twice', () => {
    const { run, pulled } = scene({ config: `${RD}\n${RD}\n${PG}\n`, present: [PG, RD] });
    const out = run();
    assert.equal(out.status, 0, out.stderr + out.stdout);
    assert.equal(pulled(), false);
  });

  // @traces 768-FR-001
  it('skips the pull when the last image name has no trailing newline', () => {
    const { run, pulled } = scene({ config: `${PG}\n${RD}`, present: [PG, RD] });
    const out = run();
    assert.equal(out.status, 0, out.stderr + out.stdout);
    assert.equal(pulled(), false);
  });

  // @traces 768-FR-002
  it('pulls when the config command succeeds but prints nothing, even with images on the VM', () => {
    const { run, pulled } = scene({ config: '', present: [PG, RD] });
    const out = run();
    assert.equal(out.status, 0, out.stderr + out.stdout);
    assert.equal(pulled(), true);
  });

  // @traces 768-FR-002
  it('pulls when the config command prints only blank lines', () => {
    const { run, pulled } = scene({ config: '\n\n  \n', present: [PG, RD] });
    const out = run();
    assert.equal(out.status, 0, out.stderr + out.stdout);
    assert.equal(pulled(), true);
  });

  // @traces 768-FR-002
  it('pulls when the config command fails after printing present images', () => {
    const { run, pulled } = scene({ config: `${PG}\n${RD}\n`, configStatus: 1, present: [PG, RD] });
    const out = run();
    assert.equal(out.status, 0, out.stderr + out.stdout);
    assert.equal(pulled(), true);
  });

  // @traces 768-FR-002
  it('fails when the config is unreadable and the pull is refused', () => {
    const { run, pulled } = scene({ config: '', present: [PG, RD], pullFails: true });
    const out = run();
    assert.notEqual(out.status, 0);
    assert.equal(pulled(), true);
    assert.doesNotMatch(out.stdout, /ready/);
  });

  // @traces 768-FR-002
  it('pulls when only the first listed image is present', () => {
    const { run, pulled } = scene({ config: `${PG}\n${RD}\n`, present: [PG] });
    const out = run();
    assert.equal(out.status, 0, out.stderr + out.stdout);
    assert.equal(pulled(), true);
  });

  // @traces 768-FR-002
  it('pulls when only the last listed image is present', () => {
    const { run, pulled } = scene({ config: `${PG}\n${RD}\n`, present: [RD] });
    const out = run();
    assert.equal(out.status, 0, out.stderr + out.stdout);
    assert.equal(pulled(), true);
  });

  // @traces 768-FR-002
  it('pulls when the only image the config names is missing', () => {
    const { run, pulled } = scene({ config: `${RD}\n`, present: [PG] });
    const out = run();
    assert.equal(out.status, 0, out.stderr + out.stdout);
    assert.equal(pulled(), true);
  });

  // @traces 768-FR-002
  it('pulls when a blank line sits before a missing image', () => {
    const { run, pulled } = scene({ config: `\n${PG}\n\n${RD}\n`, present: [PG] });
    const out = run();
    assert.equal(out.status, 0, out.stderr + out.stdout);
    assert.equal(pulled(), true);
  });

  // @traces 768-FR-002
  it('fails when one image is missing, the other present, and the pull is refused', () => {
    const { run, pulled } = scene({ config: `${PG}\n${RD}\n`, present: [PG], pullFails: true });
    const out = run();
    assert.notEqual(out.status, 0);
    assert.equal(pulled(), true);
    assert.match(out.stderr, /429/);
  });

  // @traces 768-FR-001
  it('pulls once on a bare VM and not on the run after it', () => {
    const { run, calls } = scene({ config: `${PG}\n${RD}\n` });
    assert.equal(run().status, 0);
    const first = calls().length;
    const again = run();
    assert.equal(again.status, 0, again.stderr + again.stdout);
    assert.equal(calls().slice(first).some((c) => c.startsWith('docker compose pull')), false);
    assert.equal(calls().filter((c) => c === 'docker compose pull postgres redis').length, 1);
  });

  // @traces 768-FR-001
  it('reads the images for postgres and redis only', () => {
    const { run, calls } = scene({ config: `${PG}\n${RD}\n`, present: [PG, RD] });
    run();
    assert.ok(calls().includes('docker compose config --images postgres redis'), calls().join('\n'));
  });
});
