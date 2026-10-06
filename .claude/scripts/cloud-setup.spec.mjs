import { afterEach, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// scripts/cloud-setup.sh is the setup script of a Claude Code cloud
// environment. It cannot be run on a real cloud VM from here, so every tool it
// calls is a stub on PATH that logs its call and keeps its state in files.

const script = fileURLToPath(new URL('../../scripts/cloud-setup.sh', import.meta.url));
const dirs = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const stub = (bin, name, body) => {
  writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`);
  chmodSync(join(bin, name), 0o755);
};

/** A checkout with a lock file, stub tools on PATH, Node `node` major and the Docker daemon `docker` up or down. */
function setup({ node = '22', docker = false, nvm = false, n = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'cloud-setup-'));
  dirs.push(root);
  const repo = join(root, 'repo');
  const bin = join(root, 'bin');
  const state = join(root, 'state');
  const home = join(root, 'home');
  for (const d of [join(repo, 'scripts'), bin, state, home]) mkdirSync(d, { recursive: true });
  copyFileSync(script, join(repo, 'scripts', 'cloud-setup.sh'));
  writeFileSync(join(repo, 'package-lock.json'), '{}');
  writeFileSync(join(state, 'node'), node);
  if (docker) writeFileSync(join(state, 'docker-up'), '');
  const log = join(state, 'log');
  writeFileSync(log, '');
  stub(bin, 'node', `v=$(cat ${state}/node); case "$1" in -p) echo "$v";; --version) echo "v$v.0.0";; esac`);
  stub(bin, 'npm', `echo "npm $*" >> ${log}; mkdir -p node_modules; touch node_modules/.package-lock.json`);
  stub(bin, 'docker', `case "$1" in info) test -e ${state}/docker-up;; *) echo "docker $*" >> ${log};; esac`);
  stub(bin, 'service', `echo "service $*" >> ${log}; touch ${state}/docker-up`);
  stub(bin, 'sudo', `echo "sudo $1" >> ${state}/sudo; [ "$1" = -n ] && shift; exec "$@"`);
  if (n) stub(bin, 'n', `echo "n $*" >> ${log}; echo "$1" > ${state}/node`);
  if (nvm) {
    mkdirSync(join(home, '.nvm'));
    writeFileSync(join(home, '.nvm', 'nvm.sh'), `nvm() { echo "nvm $*" >> ${log}; [ "$1" = install ] && echo "$2" > ${state}/node; return 0; }\n`);
  }
  const run = (extra = {}) => spawnSync('/bin/bash', [join(repo, 'scripts', 'cloud-setup.sh')], {
    cwd: root,
    encoding: 'utf8',
    env: { PATH: `${bin}:/usr/bin:/bin`, HOME: home, CLAUDE_CODE_REMOTE: 'true', ...extra },
  });
  const sudo = () => (existsSync(join(state, 'sudo')) ? readFileSync(join(state, 'sudo'), 'utf8').trim().split('\n') : []);
  const calls = () => readFileSync(log, 'utf8').trim().split('\n').filter(Boolean);
  return { repo, home, bin, run, calls, sudo };
}

// @traces 749-FR-005
describe('cloud-setup.sh', () => {
  it('on a fresh VM installs Node 24 with n, runs npm ci, starts Docker and pulls postgres and redis', () => {
    const { run, calls } = setup();
    const out = run();
    assert.equal(out.status, 0, out.stderr + out.stdout);
    assert.deepEqual(calls(), ['n 24', 'npm ci', 'service docker start', 'docker compose pull postgres redis']);
    assert.match(out.stdout, /node v24/);
  });

  it('prefers nvm when it is installed, and makes 24 its default', () => {
    const { run, calls } = setup({ nvm: true });
    const out = run();
    assert.equal(out.status, 0, out.stderr + out.stdout);
    assert.deepEqual(calls().slice(0, 2), ['nvm install 24', 'nvm alias default 24']);
    assert.ok(!calls().some((c) => c.startsWith('n ')));
  });

  it('sources a real nvm.sh, which reads unset variables and runs failing commands, without tripping set -eu', () => {
    const { run, calls, home } = setup({ nvm: true });
    writeFileSync(join(home, '.nvm', 'nvm.sh'), `[ -n "$NVM_UNSET_PROBE" ] && :\nfalse\n` + readFileSync(join(home, '.nvm', 'nvm.sh'), 'utf8'));
    const out = run();
    assert.equal(out.status, 0, out.stderr + out.stdout);
    assert.equal(calls()[0], 'nvm install 24');
  });

  it('never lets sudo ask for a password', () => {
    const { run, sudo } = setup();
    run();
    assert.ok(sudo().length > 0);
    assert.ok(sudo().every((l) => l === 'sudo -n'), sudo().join('\n'));
  });

  it('gives up on the Docker daemon after CLOUD_SETUP_DOCKER_WAIT seconds, naming it', () => {
    const { run, bin } = setup({ node: '24' });
    stub(bin, 'service', 'exit 1');
    stub(bin, 'dockerd', 'exit 1');
    const started = Date.now();
    const out = run({ CLOUD_SETUP_DOCKER_WAIT: '1' });
    assert.equal(out.status, 1);
    assert.match(out.stderr, /Docker daemon did not start/);
    assert.ok(Date.now() - started < 10_000);
  });

  it('a second run installs nothing it already has', () => {
    const { run, calls } = setup();
    run();
    const first = calls().length;
    const out = run();
    assert.equal(out.status, 0, out.stderr + out.stdout);
    assert.deepEqual(calls().slice(first), ['docker compose pull postgres redis']);
  });

  it('runs npm ci again when package-lock.json is newer than node_modules', () => {
    const { repo, run, calls } = setup({ node: '24', docker: true });
    run();
    const later = new Date(Date.now() + 60_000);
    utimesSync(join(repo, 'package-lock.json'), later, later);
    const before = calls().length;
    run();
    assert.ok(calls().slice(before).includes('npm ci'), calls().join('\n'));
  });

  it('fails, naming Node, when no installer gets Node 24 onto PATH', () => {
    const { run, calls, repo } = setup({ n: false });
    // No nvm, no n, and the NodeSource path needs curl and apt-get: stub them to do nothing.
    const bin = join(repo, '..', 'bin');
    stub(bin, 'curl', 'echo "echo nodesource"');
    stub(bin, 'apt-get', 'exit 0');
    const out = run();
    assert.equal(out.status, 1);
    assert.match(out.stderr, /Node 24/);
    assert.ok(!calls().includes('npm ci'));
    assert.equal(existsSync(join(repo, 'node_modules')), false);
  });
});
