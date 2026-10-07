import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// scripts/cloud-setup.sh is the setup script of a Claude Code cloud
// environment. It cannot be run on a real cloud VM from here, so every tool it
// calls is a stub on PATH that logs its call and keeps its state in files.
// Both cloud-setup spec files build their VM here; call `cleanup` afterEach.

const script = fileURLToPath(new URL('../../scripts/cloud-setup.sh', import.meta.url));
const dirs = [];

export const IMAGES = ['imresamu/postgis:17-3.5', 'redis:7'];

export function cleanup() {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
}

export const stub = (bin, name, body) => {
  writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`);
  chmodSync(join(bin, name), 0o755);
};

/**
 * A checkout with a lock file, stub tools on PATH, Node `node` major and the
 * Docker daemon `docker` up or down. `id` answers a non-root uid, so the spec
 * reads the same as root on a cloud VM. `chromium` writes the revision a
 * playwright-core install pins. Installed Nodes are looked for only under the
 * test's own `opt/nvm`.
 *
 * Docker images: `config` is the exact stdout of `docker compose config
 * --images` and `configStatus` its exit code; `present` lists the images
 * `docker image inspect` finds (an empty name or one with stray whitespace
 * never is, as with the real CLI); `pullFails` makes `compose pull` refuse,
 * else the pull adds the config's images. Those two queries are logged to
 * `queries()`, apart from the setup's own `calls()`.
 */
export function setup({ node = '22', docker = false, nvm = false, n = true, chromium = null, config = `${IMAGES.join('\n')}\n`, configStatus = 0, present = [], pullFails = false } = {}) {
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
  writeFileSync(join(state, 'config'), config);
  writeFileSync(join(state, 'images'), present.map((i) => `${i}\n`).join(''));
  if (pullFails) writeFileSync(join(state, 'pull-fails'), '');
  const log = join(state, 'log');
  const queryLog = join(state, 'queries');
  writeFileSync(log, '');
  writeFileSync(queryLog, '');
  stub(bin, 'node', `v=$(cat ${state}/node); case "$1" in -p) echo "$v";; --version) echo "v$v.0.0";; esac`);
  stub(bin, 'npm', `echo "npm $*" >> ${log}; mkdir -p node_modules; touch node_modules/.package-lock.json`);
  stub(bin, 'docker', [
    'case "$1 $2" in',
    `  "info ") test -e ${state}/docker-up;;`,
    `  "compose config") echo "docker $*" >> ${queryLog}; cat ${state}/config; exit ${configStatus};;`,
    `  "image inspect") echo "docker $*" >> ${queryLog}; shift 2; [ $# -gt 0 ] || exit 1; for i; do case "$i" in ""|*[[:space:]]*) exit 1;; esac; grep -qxF "$i" ${state}/images || exit 1; done;;`,
    `  "compose pull") echo "docker $*" >> ${log}; [ ! -e ${state}/pull-fails ] || { echo 'toomanyrequests: 429 Too Many Requests' >&2; exit 1; }; cat ${state}/config >> ${state}/images;;`,
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
  const lines = (file) => readFileSync(file, 'utf8').trim().split('\n').filter(Boolean);
  const sudo = () => (existsSync(join(state, 'sudo')) ? lines(join(state, 'sudo')) : []);
  const calls = () => lines(log);
  const queries = () => lines(queryLog);
  const pulled = () => calls().includes('docker compose pull postgres redis');
  return { root, repo, home, bin, state, run, calls, queries, pulled, sudo };
}
