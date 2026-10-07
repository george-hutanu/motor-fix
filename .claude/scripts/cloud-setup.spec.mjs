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

const IMAGES = ['imresamu/postgis:17-3.5', 'redis:7'];

const stub = (bin, name, body) => {
  writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`);
  chmodSync(join(bin, name), 0o755);
};

/**
 * A checkout with a lock file, stub tools on PATH, Node `node` major and the
 * Docker daemon `docker` up or down. `id` answers a non-root uid, so the spec
 * reads the same as root on a cloud VM. `chromium` writes the revision a
 * playwright-core install pins. Installed Nodes are looked for only under the
 * test's own `opt/nvm`.
 */
function setup({ node = '22', docker = false, nvm = false, n = true, chromium = null } = {}) {
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
  // `compose config --images` names the compose file's images (none when
  // state/no-config exists); `image inspect` answers from state/images, which
  // a pull fills unless state/pull-fails exists.
  stub(bin, 'docker', [
    'case "$1 $2" in',
    `  "info ") test -e ${state}/docker-up;;`,
    `  "compose config") [ ! -e ${state}/no-config ] && printf '%s\\n' ${IMAGES.join(' ')};;`,
    `  "image inspect") shift 2; [ $# -gt 0 ] || exit 1; for i; do grep -qxF "$i" ${state}/images 2>/dev/null || exit 1; done;;`,
    `  "compose pull") echo "docker $*" >> ${log}; [ ! -e ${state}/pull-fails ] || { echo 'toomanyrequests: 429 Too Many Requests' >&2; exit 1; }; printf '%s\\n' ${IMAGES.join(' ')} >> ${state}/images;;`,
    `  *) echo "docker $*" >> ${log};;`,
    'esac',
  ].join('\n'));
  stub(bin, 'service', `echo "service $*" >> ${log}; touch ${state}/docker-up`);
  stub(bin, 'sudo', `echo "sudo $1" >> ${state}/sudo; [ "$1" = -n ] && shift; exec "$@"`);
  stub(bin, 'id', 'echo 1000');
  stub(bin, 'npx', `echo "npx $* skip=[\${PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD-unset}]" >> ${log}`);
  if (chromium) {
    mkdirSync(join(repo, 'node_modules', 'playwright-core'), { recursive: true });
    const browsers = [{ name: 'chromium', revision: chromium }, { name: 'chromium-headless-shell', revision: chromium }, { name: 'firefox', revision: '1543' }];
    writeFileSync(join(repo, 'node_modules', 'playwright-core', 'browsers.json'), JSON.stringify({ comment: 'x', browsers }, null, 2));
  }
  if (n) stub(bin, 'n', `echo "n $*" >> ${log}; echo "$1" > ${state}/node`);
  if (nvm) {
    mkdirSync(join(home, '.nvm'));
    writeFileSync(join(home, '.nvm', 'nvm.sh'), `nvm() { echo "nvm $*" >> ${log}; [ "$1" = install ] && echo "$2" > ${state}/node; return 0; }\n`);
  }
  const run = (extra = {}) => spawnSync('/bin/bash', [join(repo, 'scripts', 'cloud-setup.sh')], {
    cwd: root,
    encoding: 'utf8',
    env: { PATH: `${bin}:/usr/bin:/bin`, HOME: home, CLAUDE_CODE_REMOTE: 'true', CLOUD_SETUP_NODE_SEARCH: `${root}/opt/nvm/versions/node/v24*/bin`, PLAYWRIGHT_BROWSERS_PATH: join(root, 'pw'), ...extra },
  });
  const sudo = () => (existsSync(join(state, 'sudo')) ? readFileSync(join(state, 'sudo'), 'utf8').trim().split('\n') : []);
  const calls = () => readFileSync(log, 'utf8').trim().split('\n').filter(Boolean);
  return { root, repo, home, bin, state, run, calls, sudo };
}

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
    const { run, calls, state } = setup({ node: '24', docker: true });
    writeFileSync(join(state, 'images'), `${IMAGES.join('\n')}\n`);
    writeFileSync(join(state, 'pull-fails'), '');
    const out = run();
    assert.equal(out.status, 0, out.stderr + out.stdout);
    assert.ok(!calls().some((c) => c.startsWith('docker compose pull')), calls().join('\n'));
    assert.match(out.stdout, /images present/);
    assert.match(out.stdout, /ready/);
  });

  // @traces 768-FR-002
  it('pulls postgres and redis when one of their images is missing', () => {
    const { run, calls, state } = setup({ node: '24', docker: true });
    writeFileSync(join(state, 'images'), 'redis:7\n');
    const out = run();
    assert.equal(out.status, 0, out.stderr + out.stdout);
    assert.ok(calls().includes('docker compose pull postgres redis'), calls().join('\n'));
  });

  // @traces 768-FR-002
  it('fails when an image is missing and the pull is refused', () => {
    const { run, calls, state } = setup({ node: '24', docker: true });
    writeFileSync(join(state, 'pull-fails'), '');
    const out = run();
    assert.notEqual(out.status, 0);
    assert.ok(calls().includes('docker compose pull postgres redis'), calls().join('\n'));
    assert.match(out.stderr, /429/);
    assert.doesNotMatch(out.stdout, /ready/);
  });

  // @traces 768-FR-002
  it('pulls when the compose file names no images it can read', () => {
    const { run, calls, state } = setup({ node: '24', docker: true });
    writeFileSync(join(state, 'images'), `${IMAGES.join('\n')}\n`);
    writeFileSync(join(state, 'no-config'), '');
    const out = run();
    assert.equal(out.status, 0, out.stderr + out.stdout);
    assert.ok(calls().includes('docker compose pull postgres redis'), calls().join('\n'));
  });
});
