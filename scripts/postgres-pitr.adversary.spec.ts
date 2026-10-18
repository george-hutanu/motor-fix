// @traces 1174-FR-001 1174-FR-002 1174-FR-008
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..');
const read = (...path: string[]) => readFileSync(join(root, ...path), 'utf8');

const IMAGE = 'ghcr.io/george-hutanu/motor-fix-postgres';
const workflowNames = readdirSync(join(root, '.github', 'workflows')).filter(
  (name) => name.endsWith('.yml'),
);
const workflows = Object.fromEntries(
  workflowNames.map((name) => [name, read('.github', 'workflows', name)]),
);
const publish = workflows['postgres-image.yml'];
const drill = workflows['pitr-drill.yml'];
const compose = read('docker-compose.yml');

// The text of the top-level job `name`, up to the next job or the end.
const job = (text: string, name: string) => {
  const start = text.search(new RegExp(`^  ${name}:$`, 'm'));
  const rest = text.slice(start + 1);
  const next = rest.search(/^ {2}[a-z][\w-]*:$/m);
  return next < 0 ? rest : rest.slice(0, next);
};

// The `run:` bodies of a workflow text, block scalars included.
const runBodies = (text: string) => {
  const lines = text.split('\n');
  const bodies: string[] = [];
  lines.forEach((line, i) => {
    const m = line.match(/^( *)(?:- )?run: *(.*)$/);
    if (!m) return;
    if (!/^[|>]/.test(m[2])) {
      bodies.push(m[2]);
      return;
    }
    const body: string[] = [];
    for (const next of lines.slice(i + 1)) {
      if (next.trim() && next.search(/\S/) <= m[1].length) break;
      body.push(next);
    }
    bodies.push(body.join('\n'));
  });
  return bodies;
};

// Step blocks of a job text.
const steps = (text: string) =>
  text
    .split(/^ {6}- /m)
    .slice(1)
    .map((s) => `- ${s}`);

describe('the database image across every file', () => {
  it('is the only PostgreSQL image any workflow or compose file runs', () => {
    const files = { ...workflows, 'docker-compose.yml': compose };
    const offenders = Object.entries(files).flatMap(([name, text]) =>
      [...text.matchAll(/^\s*image:\s*(\S+)\s*$/gm)]
        .map((m) => m[1])
        .filter((image) => /postgres|postgis|pgvector|timescale/i.test(image))
        .filter((image) => image !== `${IMAGE}:18`)
        .map((image) => `${name}: ${image}`),
    );

    expect(offenders).toEqual([]);
  });

  it('is never pulled or run by a docker command on another tag', () => {
    const dockerImage =
      /docker (?:run|pull|create)[^\n]*?\s((?:\S*\/)?(?:postgres|postgis)\S*)/g;
    const offenders = Object.entries(workflows).flatMap(([name, text]) =>
      runBodies(text)
        .flatMap((body) => [...body.matchAll(dockerImage)].map((m) => m[1]))
        .filter((image) => image !== `${IMAGE}:18`)
        .map((image) => `${name}: ${image}`),
    );

    expect(offenders).toEqual([]);
  });

  it('uses the same tag in compose, ci, mutation and both drills', () => {
    const tags = [
      compose,
      workflows['ci.yml'],
      workflows['mutation.yml'],
      drill,
      read('scripts', 'backup', 'pitr-drill.sh'),
    ].map((text) =>
      [...text.matchAll(/motor-fix-postgres:(\d+|latest)\b/g)].map((m) => m[1]),
    );

    expect(tags.map((t) => [...new Set(t)])).toEqual([
      ['18'],
      ['18'],
      ['18'],
      ['18'],
      ['18'],
    ]);
  });

  it('leaves no preload step or command behind in compose or ci', () => {
    expect(compose).not.toMatch(
      /shared_preload_libraries|^\s+command:.*postgres/m,
    );
    expect(workflows['ci.yml']).not.toMatch(
      /ALTER SYSTEM|shared_preload_libraries/,
    );
  });

  it('never names the image without a tag or with latest', () => {
    const all = `${Object.values(workflows).join('\n')}\n${compose}`
      .split('\n')
      .filter((line) => !line.trim().startsWith('#'))
      .join('\n');

    expect(all).not.toMatch(/motor-fix-postgres(?!:(?:\d|\$))(?![\w-])/);
    expect(all).not.toContain('motor-fix-postgres:latest');
  });
});

describe('the publish workflow', () => {
  it('pushes only when the event is not a pull request', () => {
    expect(publish).toMatch(
      /push: \$\{\{ github\.event_name != 'pull_request' \}\}/,
    );
    expect(publish).not.toMatch(/push: true/);
  });

  it('logs in to the registry only when it will push', () => {
    const login = steps(job(publish, 'publish')).find((s) =>
      s.includes('docker/login-action'),
    );

    expect(login).toContain("if: github.event_name != 'pull_request'");
  });

  it('is triggered by dispatch, a push to main and a build-only pull request, as the contract says', () => {
    const triggers = (publish.match(/^on:\n([\s\S]*?)^\S/m)?.[1] ?? '')
      .split('\n')
      .filter((line) => /^ {2}\w/.test(line))
      .map((line) => line.trim().replace(':', ''));

    expect(triggers).toEqual(['workflow_dispatch', 'push', 'pull_request']);
  });

  it('never runs on pull_request_target', () => {
    for (const text of Object.values(workflows)) {
      expect(text).not.toContain('pull_request_target');
    }
  });

  it('pushes the 18 tag and the commit sha for both architectures', () => {
    expect(publish).toContain(`${IMAGE}:18`);
    expect(publish).toContain(`${IMAGE}:\${{ github.sha }}`);
    expect(publish).toContain('platforms: linux/amd64,linux/arm64');
  });

  it('grants packages write and contents read and nothing more', () => {
    const perms = publish.match(/^permissions:\n((?: {2}.*\n)+)/m)?.[1];

    expect(
      perms
        ?.trim()
        .split('\n')
        .map((l) => l.trim())
        .sort(),
    ).toEqual(['contents: read', 'packages: write']);
  });

  it('serialises publishes without cancelling one that is pushing', () => {
    expect(publish).toMatch(
      /concurrency:\n\s+group: postgres-image\n\s+cancel-in-progress: false/,
    );
  });
});

describe('the point-in-time drill workflow', () => {
  const staging = job(drill, 'staging');
  const selfContained = job(drill, 'self-contained');

  it('keeps the staging job off pull requests', () => {
    expect(staging).toMatch(/^ {4}if: github\.event_name != 'pull_request'$/m);
  });

  it('binds the staging job to the staging environment', () => {
    expect(staging).toMatch(/^ {4}environment: staging$/m);
  });

  it('gives the self-contained job no environment, secret or variable', () => {
    expect(selfContained).not.toMatch(/environment:|secrets\.|vars\./);
  });

  it('references secrets only inside the staging job', () => {
    const outside = drill.replace(staging, '');

    expect(outside).not.toMatch(/secrets\./);
  });

  it('is scheduled quarterly one hour after the dump drill', () => {
    expect(drill).toContain("cron: '0 5 1 1,4,7,10 *'");
    expect(workflows['restore-drill.yml']).toContain(
      "cron: '0 4 1 1,4,7,10 *'",
    );
  });

  it('runs on pull requests that touch the image, the script or itself', () => {
    expect(drill).toMatch(
      /pull_request:\n\s+paths:\n\s+- 'infra\/postgres\/\*\*'\n\s+- 'scripts\/backup\/pitr-drill\.sh'\n\s+- '\.github\/workflows\/pitr-drill\.yml'/,
    );
  });

  it('grants contents read and nothing else', () => {
    expect(drill.match(/^permissions:\n((?: {2}.*\n)+)/m)?.[1].trim()).toBe(
      'contents: read',
    );
  });

  it('skips every drill step of the staging job when no bucket is set', () => {
    const guarded = steps(staging).filter(
      (s) => !/id: settings|Note the skip/.test(s),
    );

    expect(guarded.length).toBeGreaterThanOrEqual(6);
    for (const step of guarded) {
      expect(step).toMatch(/steps\.settings\.outputs\.skip != 'true'/);
    }
  });

  it('removes the registered ssh key even when an earlier step failed', () => {
    const removal = steps(staging).find((s) => s.includes('ssh keys remove'));

    expect(removal).toMatch(
      /if: always\(\) && steps\.settings\.outputs\.skip != 'true'/,
    );
  });

  it('names the ssh key per run and attempt', () => {
    expect(staging).toMatch(
      /KEY_NAME: pitr-drill-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/,
    );
  });

  it('pins the Railway CLI to an exact version', () => {
    expect(staging).toMatch(/@railway\/cli@\d+\.\d+\.\d+\b/);
    expect(staging).not.toMatch(/@railway\/cli(@latest)?\s*$/m);
  });

  it('never overlaps two staging drills', () => {
    expect(staging).toMatch(
      /concurrency:\n\s+group: pitr-drill-staging\n\s+cancel-in-progress: false/,
    );
  });

  it('sets the archive credentials through env, never inline in a run line', () => {
    for (const body of runBodies(drill)) {
      expect(body).not.toMatch(/\$\{\{\s*(secrets|vars)\./);
    }
  });

  // The drill needs Node for its report only, so no dependency install.
  it('sets up Node from .nvmrc in the self-contained job, installing nothing', () => {
    expect(selfContained).toMatch(
      /uses: actions\/setup-node@v\d+\n\s+with:\n\s+node-version-file: \.nvmrc/,
    );
    expect(selfContained).not.toMatch(/npm (ci|install)/);
  });
});

describe('secrets in every workflow', () => {
  const sensitive =
    /WAL_ARCHIVE_KEY|WAL_ARCHIVE_SECRET|RAILWAY_API_TOKEN|WAL_RECOVER_FROM_(?:KEY|SECRET)|secrets\./;

  it('are never echoed, printed or traced by a run step', () => {
    const printing = /\b(echo|printf|cat|tee|printenv)\b/;
    const offenders = Object.entries(workflows).flatMap(([name, text]) =>
      runBodies(text)
        .flatMap((body) => body.split('\n'))
        .filter((line) => sensitive.test(line) && printing.test(line))
        .filter((line) => !/GITHUB_OUTPUT|::add-mask::/.test(line))
        .map((line) => `${name}: ${line.trim()}`),
    );

    expect(offenders).toEqual([]);
  });

  it('are never exposed by a traced shell or an environment dump', () => {
    const offenders = Object.entries(workflows).flatMap(([name, text]) =>
      runBodies(text)
        .filter((body) =>
          /set -\w*x|bash -\w*x|^\s*(?:env|printenv)\s*$/m.test(body),
        )
        .map(() => name),
    );

    expect(offenders).toEqual([]);
  });

  it('are never printed by the drill script', () => {
    const script = read('scripts', 'backup', 'pitr-drill.sh');
    const printing = script
      .split('\n')
      .filter((l) => /\b(echo|printf)\b/.test(l) && /KEY|SECRET|TOKEN/.test(l))
      .filter((l) => !/^\s*#/.test(l));

    expect(printing).toEqual([]);
    expect(script).not.toMatch(/set -\w*x/);
  });
});

describe('every workflow', () => {
  it('gives every job of the two new workflows a timeout', () => {
    const missing = ['postgres-image.yml', 'pitr-drill.yml'].flatMap((name) => {
      const jobsBlock = workflows[name].split(/^jobs:\n/m)[1] ?? '';
      return [
        ...jobsBlock.matchAll(/^ {2}([a-z][\w-]*):\n((?: {4}.*\n|\n)+)/gm),
      ]
        .filter((m) => !/^ {4}timeout-minutes: \d+$/m.test(m[2]))
        .map((m) => `${name}/${m[1]}`);
    });

    expect(missing).toEqual([]);
  });

  it('gives every job of every workflow this feature touches a timeout', () => {
    const touched = [
      'ci.yml',
      'mutation.yml',
      'postgres-image.yml',
      'pitr-drill.yml',
    ];
    const missing = touched.flatMap((name) => {
      const text = workflows[name];
      const jobsBlock = text.split(/^jobs:\n/m)[1] ?? '';
      return [
        ...jobsBlock.matchAll(/^ {2}([a-z][\w-]*):\n((?: {4}.*\n|\n)+)/gm),
      ]
        .filter((m) => !/^ {4}uses:/m.test(m[2]))
        .filter(
          (m) =>
            !/^ {4}timeout-minutes: (\d+|\$\{\{ matrix\.\w+ \}\})$/m.test(m[2]),
        )
        .map((m) => `${name}/${m[1]}`);
    });

    expect(missing).toEqual([]);
  });

  it('pins every action to a version tag or a sha, never a branch', () => {
    const pinned = /^(v\d[\w.]*|[0-9a-f]{40})$/;
    const mutable = Object.entries(workflows).flatMap(([name, text]) =>
      [...text.matchAll(/^\s*-?\s*uses:\s*([^\s#]+)/gm)]
        .map((m) => m[1])
        .filter((ref) => !ref.startsWith('./'))
        .filter((ref) => !pinned.test(ref.split('@')[1] ?? ''))
        .map((ref) => `${name}: ${ref}`),
    );

    expect(mutable).toEqual([]);
  });

  it('declares its permissions for the two new workflows at the top', () => {
    expect(publish).toMatch(/^permissions:$/m);
    expect(drill).toMatch(/^permissions:$/m);
  });
});

describe('the dump drill default', () => {
  it('restores into the repository image at the copy’s major version', () => {
    const script = read('scripts', 'backup', 'restore-drill.sh');

    expect(script).toContain(`\${DRILL_IMAGE:-${IMAGE}:$major}`);
    expect(script).not.toMatch(/docker run[^\n]*\bpostgres:\$/);
  });
});
