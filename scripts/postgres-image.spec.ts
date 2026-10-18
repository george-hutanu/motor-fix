// @traces 1174-FR-001 1174-FR-002 1174-FR-003 1174-FR-010
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Read as text, like backup-workflows.spec.ts: the image builds and the
// workflows run only on Docker and GitHub.
const root = join(__dirname, '..');
const read = (...path: string[]) => readFileSync(join(root, ...path), 'utf8');

const IMAGE = 'ghcr.io/george-hutanu/motor-fix-postgres';
const dockerfile = read('infra', 'postgres', 'Dockerfile');
const publish = read('.github', 'workflows', 'postgres-image.yml');

// Every `image:` line naming a PostgreSQL, in a compose or workflow file.
const postgresImages = (text: string) =>
  [...text.matchAll(/^ +image: *(\S+)$/gm)]
    .map((match) => match[1])
    .filter((image) => /postgres|postgis/.test(image));

// The lines right after `header` that match `item`, up to the first that
// does not.
const block = (text: string, header: string, item: RegExp) => {
  const lines = text.split('\n');
  const after = lines.slice(lines.indexOf(header) + 1);
  const end = after.findIndex((line) => !item.test(line));
  return after.slice(0, end < 0 ? undefined : end);
};

// The instructions of the Dockerfile, comments and continuations folded.
const instructions = dockerfile
  .replace(/\\\n/g, ' ')
  .split('\n')
  .filter((line) => line.trim() && !line.trim().startsWith('#'));

describe('the database image definition', () => {
  it('builds on Railway’s PostgreSQL 18 image and nothing else', () => {
    const from = instructions.filter((line) => line.startsWith('FROM '));

    expect(from).toEqual(['FROM ghcr.io/railwayapp-templates/postgres-ssl:18']);
  });

  it('adds PostGIS for PostgreSQL 18 from the base image’s repository only', () => {
    const run = instructions.filter((line) => line.startsWith('RUN '));

    expect(run).toHaveLength(1);
    expect(run[0]).toMatch(/apt-get install -y --no-install-recommends/);
    expect(run[0].match(/postgresql-[\w-]+/g)).toEqual([
      'postgresql-18-postgis-3',
    ]);
    expect(run[0]).toContain('rm -rf /var/lib/apt/lists/*');
    expect(run[0]).not.toMatch(/curl|wget|add-apt-repository|sources\.list/);
  });

  it('keeps the data directory under the volume the base entrypoint expects', () => {
    const pgdata = instructions
      .find((line) => /^ENV PGDATA=/.test(line))
      ?.slice('ENV PGDATA='.length);

    expect(pgdata).toMatch(/^\/var\/lib\/postgresql\/data\/\w+$/);
  });

  it('changes nothing else in the base image', () => {
    const kinds = instructions.map((line) => line.split(' ')[0]);

    expect(kinds).toEqual(['FROM', 'RUN', 'ENV']);
  });
});

describe('one database image everywhere', () => {
  it.each([
    ['docker-compose.yml', 1],
    ['.github/workflows/ci.yml', 1],
    ['.github/workflows/mutation.yml', 1],
  ])('%s names the published 18 tag', (file, count) => {
    expect(postgresImages(read(file))).toEqual(
      Array(count).fill(`${IMAGE}:18`),
    );
  });

  it('the dump drill restores into the same image by default', () => {
    const drill = read('scripts', 'backup', 'restore-drill.sh');

    expect(drill).toContain(`"\${DRILL_IMAGE:-${IMAGE}:$major}"`);
    expect(drill).not.toMatch(/DRILL_IMAGE:-postgres:/);
    expect(drill).not.toMatch(/docker run[^\n]*\bpostgres:\$/);
  });

  // Only 18 is published: a copy of another major fails with its reason,
  // not on a pull of a tag that does not exist.
  it('the dump drill refuses a major with no published image unless DRILL_IMAGE is set', () => {
    const drill = read('scripts', 'backup', 'restore-drill.sh');

    expect(drill).toContain('PUBLISHED_MAJORS="18"');
    expect(drill).toMatch(
      /if \[ -z "\$\{DRILL_IMAGE:-\}" \] && ! printf '%s\\n' \$PUBLISHED_MAJORS \| grep -qx "\$major"; then/,
    );
  });

  it('the point-in-time drill runs the same image by default', () => {
    const drill = read('scripts', 'backup', 'pitr-drill.sh');

    expect(drill).toContain(`IMAGE=\${DRILL_IMAGE:-${IMAGE}:18}`);
  });

  it('the cloud setup’s fixture lists the image compose runs', () => {
    const fixture = read('.claude', 'scripts', 'cloud-setup.fixture.mjs');

    expect(fixture).toContain(
      `export const IMAGES = ['${IMAGE}:18', 'valkey/valkey:9'];`,
    );
  });
});

describe('the image needs no step around it', () => {
  // The base image preloads pg_stat_statements on a fresh database.
  it('compose starts PostgreSQL with no command of its own', () => {
    const compose = read('docker-compose.yml');
    const service = compose.match(/^ {2}postgres:\n((?: {4}.*\n|\n)+)/m)?.[1];

    expect(service).toBeDefined();
    expect(service).not.toMatch(/^ {4}command:/m);
  });
});

describe('the image publish workflow', () => {
  it('runs by hand from any branch and on main when the image changes', () => {
    expect(publish).toMatch(/^ {2}workflow_dispatch:/m);
    expect(publish).toMatch(
      /^ {2}push:\n {4}branches: \[main\]\n {4}paths:\n/m,
    );
    const paths = block(publish, '    paths:', /^ {6}- /).map((line) =>
      line.trim().slice(2).replace(/^'|'$/g, ''),
    );
    expect(paths).toEqual([
      'infra/postgres/**',
      '.github/workflows/postgres-image.yml',
    ]);
  });

  it('only builds a pull request that changes the image, pushing nothing', () => {
    const paths = block(
      publish.slice(publish.indexOf('  pull_request:')),
      '    paths:',
      /^ {6}- /,
    );
    expect(
      paths.map((line) => line.trim().slice(2).replace(/^'|'$/g, '')),
    ).toEqual(['infra/postgres/**', '.github/workflows/postgres-image.yml']);
    expect(publish).toMatch(
      /- uses: docker\/login-action@v\d+\n {8}if: github\.event_name != 'pull_request'\n/,
    );
  });

  it('may push packages and read the repository, nothing more', () => {
    const permissions = block(publish, 'permissions:', /^ {2}\S/).map((line) =>
      line.trim(),
    );

    expect(permissions).toEqual(['contents: read', 'packages: write']);
  });

  it('builds both architectures and pushes the 18 and commit tags', () => {
    expect(publish).toContain('docker/setup-qemu-action@');
    expect(publish).toContain('docker/setup-buildx-action@');
    expect(publish).toContain('docker/login-action@');
    expect(publish).toContain('registry: ghcr.io');
    expect(publish).toContain(`password: \${{ secrets.GITHUB_TOKEN }}`);
    expect(publish).toContain('docker/build-push-action@');
    expect(publish).toMatch(/context: infra\/postgres$/m);
    expect(publish).toMatch(/platforms: linux\/amd64,linux\/arm64$/m);
    expect(publish).toMatch(
      /push: \$\{\{ github\.event_name != 'pull_request' \}\}$/m,
    );
    expect(publish).toContain(`${IMAGE}:18`);
    expect(publish).toContain(`${IMAGE}:\${{ github.sha }}`);
  });

  // compose, CI and staging pull 18: a dispatch from a branch moves it only
  // when asked to, and every run pushes its commit tag.
  it('moves the 18 tag only from main or when a dispatch asks for it', () => {
    expect(publish).toMatch(
      /^ {6}move_18:\n {8}description: .+\n {8}type: boolean\n {8}default: false$/m,
    );
    expect(publish).toContain(
      `\${{ (github.ref == 'refs/heads/main' || inputs.move_18) && '${IMAGE}:18' || '' }}`,
    );
    expect(publish).not.toMatch(new RegExp(`^ {12}${IMAGE}:18$`, 'm'));
  });

  it('is bounded in time and never runs two publishes at once', () => {
    expect(publish).toMatch(/timeout-minutes: \d+/);
    expect(publish).toMatch(
      /^ {2}cancel-in-progress: \$\{\{ github\.event_name == 'pull_request' \}\}$/m,
    );
  });

  // A pull request only builds: it must never share a group with a publish,
  // or a queued build cancels a pending publish of the 18 tag.
  it('keeps pull request builds out of the publish group', () => {
    expect(publish).toContain(
      `  group: \${{ github.event_name == 'pull_request' && format('postgres-image-pr-{0}', github.ref) || 'postgres-image' }}`,
    );
  });
});
