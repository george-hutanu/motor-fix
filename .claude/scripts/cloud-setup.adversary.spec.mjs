import { afterEach, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { cleanup, setup } from './cloud-setup.fixture.mjs';

afterEach(cleanup);

/** Docker is up and Node 24 is in place; the rest is the fixture's image controls. */
const scene = (images) => setup({ node: '24', docker: true, ...images });

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
    const { run, queries } = scene({ config: `${PG}\n\n${RD}\n`, present: [PG, RD] });
    run();
    const asked = queries()
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
    const { run, queries } = scene({ config: `${PG}\n${RD}\n`, present: [PG, RD] });
    run();
    assert.ok(queries().includes('docker compose config --images postgres redis'), queries().join('\n'));
  });
});
