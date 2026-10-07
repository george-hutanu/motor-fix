import { afterEach, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, IMAGES, setup, stub } from './cloud-setup.fixture.mjs';

// scripts/cloud-setup.sh is the setup script of a Claude Code cloud environment.

afterEach(cleanup);

// @traces 749-FR-005
describe('cloud-setup.sh', () => {
  it('on a fresh VM installs Node 24 with n, keeps it first on PATH, runs npm ci, starts Docker and pulls postgres and redis', () => {
    const { run, calls, home, bin } = setup();
    const out = run();
    assert.equal(out.status, 0, out.stderr + out.stdout);
    assert.deepEqual(calls(), ['n 24', 'npm ci', 'service docker start', 'docker compose pull postgres redis']);
    assert.match(out.stdout, /node v24/);
    assert.equal(readFileSync(join(home, '.bashrc'), 'utf8'), `export PATH="${bin}:$PATH" # cloud-setup: node 24\n`);
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
    assert.deepEqual(calls().slice(first), []);
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

  it('puts an installed Node 24 first on PATH instead of installing one, and keeps it there for the session', () => {
    const { root, home, run, calls } = setup();
    const dir = join(root, 'opt', 'nvm', 'versions', 'node', 'v24.21.0', 'bin');
    mkdirSync(dir, { recursive: true });
    stub(dir, 'node', 'case "$1" in -p) echo 24;; --version) echo v24.21.0;; esac');
    const envFile = join(root, 'env.sh');
    writeFileSync(join(home, '.bashrc'), '[ -z "$PS1" ] && return\nalias ll=ls\n');
    const out = run({ CLAUDE_ENV_FILE: envFile });
    assert.equal(out.status, 0, out.stderr + out.stdout);
    assert.ok(!calls().some((c) => c.startsWith('n ')), calls().join('\n'));
    assert.match(out.stdout, /node v24\.21\.0/);
    const line = `export PATH="${dir}:$PATH" # cloud-setup: node 24`;
    assert.equal(readFileSync(join(home, '.bashrc'), 'utf8').split('\n')[0], line);
    assert.ok(readFileSync(envFile, 'utf8').includes(line));
    run({ CLAUDE_ENV_FILE: envFile });
    const bashrc = readFileSync(join(home, '.bashrc'), 'utf8');
    assert.equal(bashrc.split('\n').filter((l) => l.includes('# cloud-setup: node 24')).length, 1);
    assert.ok(bashrc.includes('alias ll=ls'));
  });

  it('finds the Node 24 an installer left behind another Node on PATH', () => {
    const { root, bin, state, run, calls } = setup();
    const dir = join(root, 'opt', 'nvm', 'versions', 'node', 'v24.1.0', 'bin');
    stub(bin, 'n', `echo "n $*" >> ${state}/log; mkdir -p ${dir}; printf '#!/bin/sh\\ncase "$1" in -p) echo 24;; --version) echo v24.1.0;; esac\\n' > ${dir}/node; chmod +x ${dir}/node`);
    const out = run();
    assert.equal(out.status, 0, out.stderr + out.stdout);
    assert.equal(calls()[0], 'n 24');
    assert.match(out.stdout, /node v24\.1\.0/);
  });

  it('installs the chromium playwright-core pins when the browsers path lacks it, with downloads allowed', () => {
    const { run, calls } = setup({ node: '24', docker: true, chromium: '1243' });
    const out = run({ PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1' });
    assert.equal(out.status, 0, out.stderr + out.stdout);
    assert.ok(calls().includes('npx playwright install chromium skip=[]'), calls().join('\n'));
  });

  it('installs no chromium when the pinned revision is already there', () => {
    const { root, run, calls } = setup({ node: '24', docker: true, chromium: '1243' });
    for (const d of ['chromium-1243', 'chromium_headless_shell-1243']) mkdirSync(join(root, 'pw', d), { recursive: true });
    const out = run();
    assert.equal(out.status, 0, out.stderr + out.stdout);
    assert.ok(!calls().some((c) => c.startsWith('npx')), calls().join('\n'));
  });

  // @traces 768-FR-001
  it('pulls nothing when the postgres and redis images are already present, and says so', () => {
    const { run, calls } = setup({ node: '24', docker: true, present: IMAGES, pullFails: true });
    const out = run();
    assert.equal(out.status, 0, out.stderr + out.stdout);
    assert.ok(!calls().some((c) => c.startsWith('docker compose pull')), calls().join('\n'));
    assert.match(out.stdout, /images present/);
    assert.match(out.stdout, /ready/);
  });

  // @traces 768-FR-002
  it('pulls postgres and redis when one of their images is missing', () => {
    const { run, calls } = setup({ node: '24', docker: true, present: ['redis:7'] });
    const out = run();
    assert.equal(out.status, 0, out.stderr + out.stdout);
    assert.ok(calls().includes('docker compose pull postgres redis'), calls().join('\n'));
  });

  // @traces 768-FR-002
  it('fails when an image is missing and the pull is refused', () => {
    const { run, calls } = setup({ node: '24', docker: true, pullFails: true });
    const out = run();
    assert.notEqual(out.status, 0);
    assert.ok(calls().includes('docker compose pull postgres redis'), calls().join('\n'));
    assert.match(out.stderr, /429/);
    assert.doesNotMatch(out.stdout, /ready/);
  });

  // @traces 768-FR-002
  it('pulls when the compose file names no images it can read', () => {
    const { run, calls } = setup({ node: '24', docker: true, present: IMAGES, config: '', configStatus: 1 });
    const out = run();
    assert.equal(out.status, 0, out.stderr + out.stdout);
    assert.ok(calls().includes('docker compose pull postgres redis'), calls().join('\n'));
  });
});
