import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// scripts/backup/sandbox-backup.sh runs inside the Railway sandbox, where it
// drives docker and gpg. Here both are fakes on PATH, so each way the dump,
// the encryption or the upload can fail is shown to fail the script, with no
// size line the runner could mistake for a finished copy.
const script = join(__dirname, 'backup', 'sandbox-backup.sh');
const HEAD = '{"server_version":"18.1","tables":{"garages":3}}';
const PASSPHRASE = 'pass phrase\n';

const DOCKER = `#!/bin/sh
case "$1" in pull) exit 0 ;; esac
case "$*" in
  *amazon/aws-cli*)
    [ "$FAKE_UPLOAD" = fail ] && { echo "upload refused" >&2; exit 1; }
    for a; do case "$a" in *:/backup/dump.gpg:ro) src=\${a%%:*} ;; esac; done
    cp "$src" "$FAKE_DIR/uploaded"
    exit 0 ;;
esac
cat >"$FAKE_DIR/dump-seen"
[ "$FAKE_DUMP" = none ] && exit 1
echo '${HEAD}'
case "$FAKE_DUMP" in
  ok) printf 'custom-format dump' | base64 ;;
  exit) printf 'custom-format' | base64; exit 1 ;;
  marked) printf 'custom' | base64; echo '!dump failed' ;;
esac
`;

const GPG = `#!/bin/sh
out=; pass=
while [ $# -gt 0 ]; do
  case "$1" in --output) out=$2; shift ;; --passphrase-file) pass=$2; shift ;; esac
  shift
done
cp "$pass" "$FAKE_DIR/passphrase-seen"
[ "$FAKE_GPG" = fail ] && { cat >/dev/null; exit 2; }
{ printf 'GPG:'; cat; } >"$out"
`;

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sandbox-backup-'));
  mkdirSync(join(dir, 'bin'));
  for (const [name, body] of [
    ['docker', DOCKER],
    ['gpg', GPG],
  ] as const) {
    writeFileSync(join(dir, 'bin', name), body);
    chmodSync(join(dir, 'bin', name), 0o755);
  }
});
afterEach(() => rmSync(dir, { force: true, recursive: true }));

function backup(fake: Record<string, string> = {}) {
  const result = spawnSync('sh', [script], {
    encoding: 'utf8',
    env: {
      BACKUP_GPG_PASSPHRASE: PASSPHRASE,
      BACKUP_S3_ACCESS_KEY_ID: 'key-id',
      BACKUP_S3_BUCKET: 'bucket',
      BACKUP_S3_ENDPOINT: 'http://127.0.0.1:8333',
      BACKUP_S3_REGION: 'auto',
      BACKUP_S3_SECRET_ACCESS_KEY: 'key-secret',
      DUMP_SH: 'echo dump\n',
      EXPECTED_ENV: 'staging',
      FAKE_DIR: dir,
      FAKE_DUMP: 'ok',
      IMAGE: 'ghcr.io/example/postgres:18',
      OBJECT: 'staging/2026-10-24T00-00-00Z.dump.gpg',
      PATH: `${join(dir, 'bin')}:${process.env.PATH ?? ''}`,
      ...fake,
    },
  });
  const uploaded = join(dir, 'uploaded');
  return {
    ...result,
    out: `${result.stdout}${result.stderr}`,
    uploaded: existsSync(uploaded) ? uploaded : undefined,
  };
}

// @traces 1371-FR-005
describe('sandbox-backup.sh', () => {
  it('encrypts the decoded dump, uploads it and reports its head and size', () => {
    const r = backup();

    expect(r.status).toBe(0);
    expect(r.uploaded).toBeDefined();
    expect(readFileSync(r.uploaded as string, 'utf8')).toBe(
      'GPG:custom-format dump',
    );
    expect(r.stdout).toContain(`BACKUP_HEAD ${HEAD}\n`);
    expect(r.stdout).toContain(
      `BACKUP_SIZE ${statSync(r.uploaded as string).size}\n`,
    );
  });

  it('runs dump.sh as it was handed over', () => {
    backup();

    expect(readFileSync(join(dir, 'dump-seen'), 'utf8')).toBe('echo dump\n');
  });

  it('hands gpg the passphrase byte for byte and never prints it or a key', () => {
    const r = backup();

    expect(readFileSync(join(dir, 'passphrase-seen'), 'utf8')).toBe(PASSPHRASE);
    expect(r.out).not.toContain('pass phrase');
    expect(r.out).not.toContain('key-secret');
  });

  it.each([
    ['the dump exits non-zero after its head', { FAKE_DUMP: 'exit' }],
    ['the dump ends in its failure mark', { FAKE_DUMP: 'marked' }],
    ['gpg fails', { FAKE_GPG: 'fail' }],
    ['the dump prints nothing', { FAKE_DUMP: 'none' }],
  ])('fails and uploads nothing when %s', (_why, fake) => {
    const r = backup(fake);

    expect(r.status).not.toBe(0);
    expect(r.uploaded).toBeUndefined();
    expect(r.stdout).not.toContain('BACKUP_SIZE');
  });

  it('never starts gpg when the dump prints nothing', () => {
    backup({ FAKE_DUMP: 'none' });

    expect(existsSync(join(dir, 'passphrase-seen'))).toBe(false);
  });

  it('fails with no size line when the upload fails', () => {
    const r = backup({ FAKE_UPLOAD: 'fail' });

    expect(r.status).not.toBe(0);
    expect(r.stdout).not.toContain('BACKUP_SIZE');
  });
});
