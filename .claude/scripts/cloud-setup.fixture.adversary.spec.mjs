import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { afterEach, describe, it } from 'vitest';
import { cleanup, IMAGES, setup } from './cloud-setup.fixture.mjs';

afterEach(cleanup);

const docker = (vm, ...args) =>
  spawnSync(`${vm.bin}/docker`, args, { encoding: 'utf8', env: { ...process.env, PATH: `${vm.bin}:${process.env.PATH}` } });

describe('cloud-setup fixture docker stub', () => {
  it('prints the config verbatim with the given exit status', () => {
    const vm = setup({ docker: true, config: 'a\n\nb', configStatus: 3 });
    const r = docker(vm, 'compose', 'config', '--images');
    assert.equal(r.status, 3);
    assert.equal(r.stdout, 'a\n\nb');
  });

  it('inspects only the images present, never an empty or padded name', () => {
    const vm = setup({ docker: true, present: ['redis:7', ''] });
    assert.equal(docker(vm, 'image', 'inspect', 'redis:7').status, 0);
    assert.notEqual(docker(vm, 'image', 'inspect', 'redis:7 ').status, 0);
    assert.notEqual(docker(vm, 'image', 'inspect', '').status, 0);
    assert.notEqual(docker(vm, 'image', 'inspect', 'postgres:16').status, 0);
  });

  it('adds the config images on pull, or refuses and adds none', () => {
    const ok = setup({ docker: true, config: `${IMAGES.join('\n')}\n` });
    assert.notEqual(docker(ok, 'image', 'inspect', IMAGES[1]).status, 0);
    assert.equal(docker(ok, 'compose', 'pull').status, 0);
    assert.deepEqual(
      IMAGES.map((i) => docker(ok, 'image', 'inspect', i).status),
      [0, 0],
    );

    const bad = setup({ docker: true, pullFails: true });
    assert.notEqual(docker(bad, 'compose', 'pull').status, 0);
    assert.notEqual(docker(bad, 'image', 'inspect', IMAGES[0]).status, 0);
  });

  it('logs config and inspect to queries and pull to calls only', () => {
    const vm = setup({ docker: true, present: ['a'] });
    docker(vm, 'compose', 'config', '--images');
    docker(vm, 'image', 'inspect', 'a');
    docker(vm, 'compose', 'pull');
    assert.deepEqual(vm.queries(), ['docker compose config --images', 'docker image inspect a']);
    assert.deepEqual(vm.calls(), ['docker compose pull']);
  });

  it('keeps two VMs apart so one pull does not reach the other', () => {
    const a = setup({ docker: true });
    const b = setup({ docker: true });
    docker(a, 'compose', 'pull');
    assert.notEqual(a.root, b.root);
    assert.notEqual(docker(b, 'image', 'inspect', IMAGES[0]).status, 0);
    assert.deepEqual(b.calls(), []);
  });

  it('removes every directory it made on cleanup and tolerates a second cleanup', () => {
    const vm = setup({ docker: true });
    const { root, bin } = vm;
    assert.equal(existsSync(bin), true);
    cleanup();
    assert.equal(existsSync(root), false);
    assert.equal(existsSync(bin), false);
    cleanup();
  });
});
