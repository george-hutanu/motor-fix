import { describe, it, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, utimesSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { add, check, detect, projectSlug } from './notion-agent-tools.mjs';
import { checkNotionTools } from './doctor.mjs';

const OLD = 'f3041bc4-d91f-4aa7-a3e8-b9172efcd78f';
const NEW = 'fd62790a-b7ca-480e-9cf5-9073c1192ba8';
const RESEARCHER = ['notion-search', 'notion-fetch', 'notion-get-comments', 'notion-query-data-sources', 'notion-get-tool-access'];
const REVIEWER = ['notion-search', 'notion-fetch', 'notion-get-comments'];
const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'notion-agent-tools.mjs');

let repo;
let config;
const names = (id, reads) => reads.map((r) => `mcp__${id}__${r}`);
const agent = (name, base, notion, eol = '\n') =>
  [`---`, `name: ${name}`, `description: a test agent`, `tools: ${[...base, ...notion].join(', ')}`, `model: sonnet`, `---`, ``, `Body of ${name}.`, ``].join(eol);
const write = (rel, body) => {
  const file = join(repo, rel);
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, body);
  return file;
};
const read = (rel) => readFileSync(join(repo, rel), 'utf8');
const tools = (name) =>
  read(`.claude/agents/${name}.md`)
    .match(/^tools:[ \t]*(.+?)\r?$/m)[1]
    .split(',')
    .map((t) => t.trim());
const allow = () => JSON.parse(read('.claude/settings.json')).permissions.allow;

const seed = ({ researcher = names(OLD, RESEARCHER), reviewer = names(OLD, REVIEWER), settings = names(OLD, RESEARCHER), eol = '\n' } = {}) => {
  write('.claude/agents/org-researcher.md', agent('org-researcher', ['Read', 'Write', 'ToolSearch'], researcher, eol));
  write('.claude/agents/spec-reviewer.md', agent('spec-reviewer', ['Read', 'Grep', 'Bash', 'ToolSearch'], reviewer, eol));
  write('.claude/settings.json', `${JSON.stringify({ permissions: { allow: ['Bash(git status)', ...settings, 'WebSearch'] } }, null, 2)}\n`);
};

const slugDir = (slug) => {
  const dir = join(config, 'projects', slug);
  mkdirSync(dir, { recursive: true });
  return dir;
};
const delta = (names_, extra = {}) =>
  JSON.stringify({ type: 'attachment', attachment: { type: 'deferred_tools_delta', addedNames: names_, ...extra } });
const transcript = (file, lines, mtime, slug = projectSlug(repo)) => {
  const path = join(slugDir(slug), file);
  writeFileSync(path, `${lines.join('\n')}\n`);
  if (mtime) utimesSync(path, mtime, mtime);
  return path;
};

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'notion-adv-repo-'));
  config = mkdtempSync(join(tmpdir(), 'notion-adv-config-'));
});
afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
  rmSync(config, { recursive: true, force: true });
});

describe('check on hostile agent files', () => {
  it('returns no findings when no agent lists a Notion tool', () => {
    seed({ researcher: [], reviewer: [], settings: [] });
    assert.deepEqual(check(repo), []);
  });

  it('accepts the same servers listed in a different order', () => {
    seed({ researcher: [...names(OLD, RESEARCHER), ...names(NEW, RESEARCHER)], reviewer: [...names(NEW, REVIEWER), ...names(OLD, REVIEWER)], settings: [...names(NEW, RESEARCHER), ...names(OLD, RESEARCHER)] });
    assert.deepEqual(check(repo), []);
  });

  it('flags every write verb under the built-in server id too', () => {
    for (const verb of ['notion-delete-page', 'notion-create-database', 'notion-update-data-source', 'notion-create-comment']) {
      seed({ reviewer: [...names(OLD, REVIEWER), `mcp__claude_ai_Notion__${verb}`] });
      assert.match(check(repo).join('\n'), new RegExp(`spec-reviewer.*${verb}`), verb);
    }
  });

  it('flags a write tool the permission allowlist grants', () => {
    seed({ settings: [...names(OLD, RESEARCHER), `mcp__${OLD}__notion-update-page`] });
    assert.match(check(repo).join('\n'), /settings\.json.*notion-update-page/);
  });

  it('flags a server wildcard on the tools line because it grants every write tool', () => {
    seed({ reviewer: [...names(OLD, REVIEWER), `mcp__${NEW}__*`] });
    assert.notDeepEqual(check(repo), []);
  });

  it('reads a CRLF agent file the same as an LF one', () => {
    seed({ eol: '\r\n', reviewer: [...names(OLD, REVIEWER), `mcp__${OLD}__notion-update-page`] });
    assert.match(check(repo).join('\n'), /spec-reviewer.*notion-update-page/);
  });

  it('passes with no permissions block in settings', () => {
    seed();
    write('.claude/settings.json', '{}\n');
    assert.deepEqual(check(repo), []);
  });

  it('flags a bare whole-server grant on the tools line', () => {
    seed({ reviewer: [...names(OLD, REVIEWER), `mcp__${NEW}`] });
    assert.match(check(repo).join('\n'), new RegExp(`spec-reviewer.*mcp__${NEW}\\b`));
  });

  it('flags a server wildcard in the allowlist for a Notion server', () => {
    seed({ settings: [...names(OLD, RESEARCHER), `mcp__${OLD}__*`] });
    assert.match(check(repo).join('\n'), /settings\.json.*wildcard/);
  });

  it('reports a settings.json that is not JSON instead of throwing', () => {
    seed();
    write('.claude/settings.json', '{ not json');
    assert.match(check(repo).join('\n'), /settings\.json.*not valid JSON/);
    assert.throws(() => add(repo, NEW), /settings\.json.*not valid JSON/);
  });

});

describe('add on hostile input', () => {
  it('refuses an id that would smuggle another tool onto the tools line', () => {
    seed();
    const before = read('.claude/agents/spec-reviewer.md');
    for (const bad of ['abc, Bash', 'abc,Bash', 'abc\nmodel: opus', 'abc def', 'mcp__abc__notion-fetch, Bash']) {
      assert.throws(() => add(repo, bad), /server id/, JSON.stringify(bad));
    }
    assert.equal(read('.claude/agents/spec-reviewer.md'), before);
  });

  it('refuses a non-string input', () => {
    seed();
    for (const bad of [undefined, null, 42, {}]) assert.throws(() => add(repo, bad), /server id/);
  });

  it('refuses an mcp tool name that is not a Notion tool', () => {
    seed();
    assert.throws(() => add(repo, `mcp__${NEW}__slack-send`), /server id/);
  });

  it('refuses an mcp tool of another kind on a Notion-looking server', () => {
    seed();
    for (const bad of ['mcp__x__Bash', `mcp__${NEW}__Bash`, `mcp__${NEW}__*`]) assert.throws(() => add(repo, bad), /server id/, bad);
  });

  it('refuses a wildcard tool name instead of reading the star as an id', () => {
    seed();
    assert.throws(() => add(repo, `mcp__*__notion-fetch`), /server id/);
  });

  it('accepts the built-in connector name as a bare id', () => {
    seed();
    add(repo, 'claude_ai_Notion');
    assert.ok(tools('spec-reviewer').includes('mcp__claude_ai_Notion__notion-fetch'));
  });

  it('never writes a write tool whatever tool name selected the server', () => {
    seed();
    for (const verb of ['notion-update-page', 'notion-delete-page', 'notion-create-comment']) add(repo, `mcp__${NEW}__${verb}`);
    const all = [...tools('org-researcher'), ...tools('spec-reviewer'), ...allow()];
    assert.deepEqual(all.filter((t) => /notion-(create|update|move|duplicate|delete)|notion-create-comment/.test(t)), []);
    assert.deepEqual(check(repo), []);
  });

  it('fills only what is missing when an agent already has part of the server', () => {
    seed({ reviewer: [...names(OLD, REVIEWER), `mcp__${NEW}__notion-fetch`] });
    add(repo, NEW);
    const list = tools('spec-reviewer');
    assert.equal(list.filter((t) => t === `mcp__${NEW}__notion-fetch`).length, 1);
    assert.deepEqual(names(NEW, REVIEWER).filter((t) => !list.includes(t)), []);
    assert.deepEqual(check(repo), []);
  });

  it('keeps CRLF line endings in an agent file', () => {
    seed({ eol: '\r\n' });
    add(repo, NEW);
    const text = read('.claude/agents/spec-reviewer.md');
    assert.equal(text.replace(/\r\n/g, '').includes('\n'), false);
    assert.deepEqual(names(NEW, REVIEWER).filter((t) => !tools('spec-reviewer').includes(t)), []);
  });

  it('writes the allowlist when settings has no permissions block, or leaves it untouched', () => {
    seed();
    write('.claude/settings.json', '{"other": 1}\n');
    add(repo, NEW);
    const json = JSON.parse(read('.claude/settings.json'));
    assert.equal(json.other, 1);
    assert.deepEqual(check(repo), []);
  });

  it('does not duplicate allowlist entries on a second server, and reports nothing changed on repeat', () => {
    seed();
    add(repo, NEW);
    add(repo, OLD);
    const list = allow();
    assert.equal(new Set(list).size, list.length);
    assert.deepEqual(add(repo, `mcp__${NEW}__notion-search`), []);
  });

});

describe('detect on hostile transcripts', () => {
  it('skips malformed, blank and truncated lines and still finds the id', () => {
    seed();
    transcript('a.jsonl', ['{not json', '', '   ', delta(names(NEW, ['notion-fetch'])), '{"attachment":{"type":"deferred_tools_delta","addedNa']);
    assert.deepEqual(detect(repo, { configDir: config }).missing, [NEW]);
  });

  it('survives null, non-array and non-string addedNames', () => {
    seed();
    transcript('a.jsonl', [
      JSON.stringify({ attachment: { type: 'deferred_tools_delta', addedNames: null } }),
      JSON.stringify({ attachment: { type: 'deferred_tools_delta', addedNames: 'mcp__zzzz__notion-fetch' } }),
      JSON.stringify({ attachment: { type: 'deferred_tools_delta', addedNames: [null, 7, {}, [`mcp__zzzz__notion-fetch`]] } }),
      JSON.stringify({ attachment: null }),
      'null',
      '[]',
      delta(names(NEW, ['notion-fetch'])),
    ]);
    assert.deepEqual(detect(repo, { configDir: config }).missing, [NEW]);
  });

  it('ignores removed names and other attachment types', () => {
    seed();
    transcript('a.jsonl', [
      delta([], { removedNames: names(NEW, ['notion-fetch']) }),
      JSON.stringify({ attachment: { type: 'mcp_instructions_delta', addedNames: names(NEW, ['notion-fetch']) } }),
    ]);
    assert.deepEqual(detect(repo, { configDir: config }).missing, []);
  });

  it('ignores tools of other servers and names that are not Notion tools', () => {
    seed();
    transcript('a.jsonl', [delta(['mcp__zzzz__slack-send', 'mcp__zzzz__fetch', 'notion-fetch', 'mcp__zzzz__notion'])]);
    assert.deepEqual(detect(repo, { configDir: config }).missing, []);
  });

  it('lists a missing id once however many transcripts carry it', () => {
    seed();
    for (let i = 0; i < 5; i += 1) transcript(`s-${i}.jsonl`, [delta(names(NEW, ['notion-fetch', 'notion-search']))]);
    assert.deepEqual(detect(repo, { configDir: config }).missing, [NEW]);
  });

  it('lists several missing ids', () => {
    seed();
    transcript('a.jsonl', [delta([...names(NEW, ['notion-fetch']), ...names('bbbb2222-0000-0000-0000-000000000000', ['notion-fetch'])])]);
    assert.deepEqual([...detect(repo, { configDir: config }).missing].sort(), [NEW, 'bbbb2222-0000-0000-0000-000000000000'].sort());
  });

  it('counts the 20th newest transcript and drops the 21st', () => {
    seed();
    const base = Date.now();
    const old = 'aaaa1111-0000-0000-0000-000000000000';
    transcript('oldest.jsonl', [delta(names(old, ['notion-fetch']))], new Date(base - 1e7));
    for (let i = 0; i < 19; i += 1) transcript(`n-${i}.jsonl`, [delta([])], new Date(base - 1e6 + i * 1000));
    assert.deepEqual(detect(repo, { configDir: config }).missing, [old]);
    transcript('n-extra.jsonl', [delta([])], new Date(base));
    assert.deepEqual(detect(repo, { configDir: config }).missing, []);
  });

  it('ignores non-jsonl files and a directory named like a transcript', () => {
    seed();
    const dir = slugDir(projectSlug(repo));
    writeFileSync(join(dir, 'notes.txt'), delta(names(NEW, ['notion-fetch'])));
    mkdirSync(join(dir, 'folder.jsonl'));
    assert.deepEqual(detect(repo, { configDir: config }).missing, []);
  });

  it('does not throw on a dangling symlink among the transcripts', () => {
    seed();
    const dir = slugDir(projectSlug(repo));
    symlinkSync(join(config, 'does-not-exist.jsonl'), join(dir, 'dangling.jsonl'));
    transcript('ok.jsonl', [delta(names(NEW, ['notion-fetch']))]);
    assert.deepEqual(detect(repo, { configDir: config }).missing, [NEW]);
  });

  it('does not throw on a binary blob, a UTF-16 file or Latin-1 text', () => {
    seed();
    const dir = slugDir(projectSlug(repo));
    writeFileSync(join(dir, 'bin.jsonl'), Buffer.from([0xff, 0xfe, 0x00, 0x01, 0x80, 0x81, 0x0a, 0xc3, 0x28]));
    writeFileSync(join(dir, 'u16.jsonl'), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(`${delta(names('cccc3333', ['notion-fetch']))}\n`, 'utf16le')]));
    writeFileSync(join(dir, 'latin.jsonl'), Buffer.concat([Buffer.from('caf\xe9 ', 'latin1'), Buffer.from('\n'), Buffer.from(`${delta(names(NEW, ['notion-fetch']))}\n`)]));
    assert.ok(detect(repo, { configDir: config }).missing.includes(NEW));
  });

  it('reads a UTF-8 transcript that starts with a byte-order mark', () => {
    seed();
    const dir = slugDir(projectSlug(repo));
    writeFileSync(join(dir, 'bom.jsonl'), `﻿${delta(names(NEW, ['notion-fetch']))}\n`);
    assert.deepEqual(detect(repo, { configDir: config }).missing, [NEW]);
  });

  it('finds an id at the end of a transcript tens of megabytes long', () => {
    seed();
    const filler = JSON.stringify({ type: 'user', message: { content: 'x'.repeat(1_000_000) } });
    const lines = Array.from({ length: 30 }, () => filler);
    lines.push(delta(names(NEW, ['notion-fetch'])));
    transcript('big.jsonl', lines);
    assert.deepEqual(detect(repo, { configDir: config }).missing, [NEW]);
  }, 60_000);

  it('reports a note and nothing missing when the config dir does not exist', () => {
    seed();
    const found = detect(repo, { configDir: join(config, 'nope'), roots: [repo] });
    assert.deepEqual(found.missing, []);
    assert.match(found.note, /no transcript/);
  });

  it('reports a note and nothing missing for an empty project dir', () => {
    seed();
    slugDir(projectSlug(repo));
    const found = detect(repo, { configDir: config });
    assert.deepEqual(found.missing, []);
    assert.match(found.note, /no transcript/);
  });

  it('does not repeat an id when both roots resolve to the same checkout', () => {
    seed();
    transcript('a.jsonl', [delta(names(NEW, ['notion-fetch']))]);
    assert.deepEqual(detect(repo, { configDir: config, roots: [repo, repo] }).missing, [NEW]);
  });


  it('reports nothing missing when the agents already carry the id', () => {
    seed();
    transcript('a.jsonl', [delta(names(OLD, ['notion-fetch']))]);
    assert.deepEqual(detect(repo, { configDir: config }).missing, []);
  });
});

describe('projectSlug', () => {
  it('maps underscores, dots, spaces and non-ASCII characters to hyphens', () => {
    assert.equal(projectSlug('/Users/me/my_proj.v2 x/é'), '-Users-me-my-proj-v2-x--');
  });

  it('gives the same slug with and without a trailing slash', () => {
    assert.equal(projectSlug('/Users/me/motor-fix/'), projectSlug('/Users/me/motor-fix'));
  });
});

describe('command line', () => {
  const run = (args, env = {}) =>
    spawnSync(process.execPath, [SCRIPT, ...args], { cwd: repo, encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: config, ...env } });

  it('add with a bad id exits 2 and names the problem', () => {
    const r = run(['add', 'not an id!']);
    assert.equal(r.status, 2);
    assert.match(r.stderr + r.stdout, /server id/);
  });

  it('add with no argument exits 2', () => {
    assert.equal(run(['add']).status, 2);
  });

  it('an unknown command does not exit 0', () => {
    assert.notEqual(run(['frobnicate']).status, 0);
  });

  it('check exits 0 on the repository this script ships in', () => {
    const real = join(dirname(SCRIPT), '..', '..');
    const r = spawnSync(process.execPath, [SCRIPT, 'check'], { cwd: real, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
  });

  it('detect exits 0 with a note when the config dir holds no transcript', () => {
    assert.equal(run(['detect']).status, 0);
  });
});

describe('doctor Notion tools check', () => {
  const reviewer = (list) => `---\nname: spec-reviewer\ndescription: reviews\ntools: Read, ${list.join(', ')}\n---\n`;
  const status = (results) => results.find((r) => r.name === 'agents/notion-tools')?.status;

  it('is ok when no agent lists a Notion tool and there is no transcript', () => {
    write('.claude/agents/code-reviewer.md', '---\nname: code-reviewer\ndescription: x\ntools: Read\n---\n');
    assert.equal(status(checkNotionTools(repo, { configDir: config })), 'ok');
  });

  it('is ok when the config dir does not exist', () => {
    write('.claude/agents/spec-reviewer.md', reviewer(names(NEW, REVIEWER)));
    assert.equal(status(checkNotionTools(repo, { configDir: join(config, 'nope') })), 'ok');
  });

  it('fails, not warns, when a write tool is listed and a transcript also shows a missing id', () => {
    write('.claude/agents/spec-reviewer.md', reviewer([...names(OLD, REVIEWER), `mcp__${OLD}__notion-update-page`]));
    transcript('a.jsonl', [delta(names(NEW, ['notion-fetch']))]);
    assert.equal(status(checkNotionTools(repo, { configDir: config })), 'fail');
  });

  it('fails when the two Notion agents list different servers', () => {
    write('.claude/agents/spec-reviewer.md', reviewer(names(NEW, REVIEWER)));
    write('.claude/agents/org-researcher.md', `---\nname: org-researcher\ndescription: x\ntools: Read, ${names(OLD, RESEARCHER).join(', ')}\n---\n`);
    assert.equal(status(checkNotionTools(repo, { configDir: config })), 'fail');
  });

  it('returns one result named agents/notion-tools', () => {
    write('.claude/agents/spec-reviewer.md', reviewer(names(NEW, REVIEWER)));
    const results = checkNotionTools(repo, { configDir: config });
    assert.equal(results.filter((r) => r.name === 'agents/notion-tools').length, 1);
  });
});
