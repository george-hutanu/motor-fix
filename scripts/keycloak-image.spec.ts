// @traces 1178-FR-001 1178-FR-002 1178-FR-003 1178-FR-004
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Read as text, like postgres-image.spec.ts: the image builds only on
// Docker. The local run that proves the heap it gets is in quickstart.md.
const root = join(__dirname, '..');
const read = (...path: string[]) => readFileSync(join(root, ...path), 'utf8');

const BASE = 'quay.io/keycloak/keycloak:26.8';
const dockerfile = read('infra', 'keycloak', 'Dockerfile');

// The instructions of the Dockerfile, comments and continuations folded.
const instructions = dockerfile
  .replace(/\\\n/g, ' ')
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith('#'));

// The instructions of each stage, split at its FROM.
const stages = instructions.reduce<string[][]>((all, line) => {
  if (line.startsWith('FROM ')) all.push([]);
  all.at(-1)?.push(line);
  return all;
}, []);
const [builder = [], runtime = []] = stages;

// `ENV A=1 B=2` and `ENV A="x y"` as their pairs.
const env = (lines: string[]) =>
  Object.fromEntries(
    lines
      .filter((line) => line.startsWith('ENV '))
      .flatMap((line) => [...line.slice(4).matchAll(/(\w+)=("[^"]*"|\S+)/g)])
      .map(([, name, value]) => [name, value?.replace(/^"|"$/g, '')]),
  );

const cmd = (): string[] => {
  const line = runtime.find((l) => l.startsWith('CMD '));
  return line ? JSON.parse(line.slice(4)) : [];
};

describe('the Keycloak image', () => {
  it('builds in two stages on Keycloak 26.8, the first named builder', () => {
    expect(instructions.filter((line) => line.startsWith('FROM '))).toEqual([
      `FROM ${BASE} AS builder`,
      `FROM ${BASE}`,
    ]);
  });

  it('gives the build stage exactly the four build options and runs kc.sh build once', () => {
    expect(env(builder)).toEqual({
      KC_DB: 'postgres',
      KC_FEATURES: 'cimd,resource-indicators',
      KC_HEALTH_ENABLED: 'true',
      KC_METRICS_ENABLED: 'true',
    });
    expect(instructions.filter((line) => line.startsWith('RUN '))).toEqual([
      'RUN /opt/keycloak/bin/kc.sh build',
    ]);
    expect(builder.at(-1)).toBe('RUN /opt/keycloak/bin/kc.sh build');
  });

  it('copies the built server and the realm into the runtime stage', () => {
    expect(runtime).toContain(
      'COPY --from=builder /opt/keycloak/ /opt/keycloak/',
    );
    expect(runtime).toContain(
      'COPY realm-motorfix-assistants.json /opt/keycloak/data/import/',
    );
    expect(instructions.filter((line) => line.startsWith('EXPOSE'))).toEqual([
      'EXPOSE 8080',
    ]);
  });

  it('holds no secret value', () => {
    expect(dockerfile).not.toMatch(
      /KC_DB_PASSWORD=|KEYCLOAK_ADMIN_PASSWORD=|KC_BOOTSTRAP_ADMIN_PASSWORD=/,
    );
  });

  it('sizes the heap from the container limit, never in bytes', () => {
    expect(env(runtime)).toEqual({
      JAVA_OPTS_KC_HEAP:
        '-XX:MaxRAMPercentage=70 -XX:MinRAMPercentage=70 -XX:InitialRAMPercentage=50',
    });
    expect(dockerfile).not.toMatch(/-Xm[sx]|-XX:(Max|Initial)HeapSize/i);
  });

  it('starts the built server behind the proxy, importing the realm', () => {
    expect(cmd()).toEqual([
      'start',
      '--optimized',
      '--import-realm',
      '--proxy-headers=xforwarded',
      '--http-enabled=true',
    ]);
  });

  it('leaves the build options and the address out of the start, and persistent sessions on', () => {
    const start = cmd().join(' ');

    expect(start).not.toMatch(/--features|--db|--health|--metrics/);
    expect(dockerfile).not.toContain('--hostname');
    expect(dockerfile).not.toMatch(
      /persistent-user-sessions|PERSISTENT_USER_SESSIONS|features-disabled/i,
    );
  });
});

describe('the local identity server', () => {
  it('keeps start-dev in compose, built at start with its own options', () => {
    const compose = read('docker-compose.yml');
    const service = compose.match(/^ {2}keycloak:\n((?: {4}.*\n|\n)+)/m)?.[1];

    expect(service).toMatch(/^ {6}- start-dev$/m);
    expect(service).not.toMatch(/--optimized/);
  });
});
