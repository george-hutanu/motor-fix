import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const text = readFileSync(
  join(__dirname, '..', 'infra', 'keycloak', 'Dockerfile'),
  'utf8',
);
const lines = text
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith('#'));

// @traces 1178-FR-001
// @traces 1178-FR-002
// @traces 1178-FR-004
describe('the Keycloak Dockerfile', () => {
  it('sets no heap size in bytes anywhere', () => {
    expect(
      lines.filter((l) => /-Xm[sx]|-XX:(Max|Initial)HeapSize/i.test(l)),
    ).toEqual([]);
  });

  it('sizes the heap by percentage in one runtime-stage variable', () => {
    expect(lines).toContain(
      'ENV JAVA_OPTS_KC_HEAP="-XX:MaxRAMPercentage=70 -XX:MinRAMPercentage=70 -XX:InitialRAMPercentage=50"',
    );
    expect(lines.filter((l) => l.includes('RAMPercentage'))).toHaveLength(1);
  });

  it('has exactly two stages, the runtime one copying the builder', () => {
    expect(lines.filter((l) => /^FROM /.test(l))).toEqual([
      'FROM quay.io/keycloak/keycloak:26.8 AS builder',
      'FROM quay.io/keycloak/keycloak:26.8',
    ]);
    expect(lines.some((l) => l.startsWith('COPY --from=builder'))).toBe(true);
  });

  it('builds with the options baked and starts optimized without rebuilding', () => {
    expect(lines.some((l) => /^RUN .*kc\.sh build$/.test(l))).toBe(true);
    const cmd = lines.find((l) => l.startsWith('CMD')) ?? '';
    expect(cmd).toContain('"--optimized"');
    expect(cmd).toContain('"--import-realm"');
    expect(cmd).not.toContain('"build"');
  });

  it('keeps the realm path, port 8080 and no secret value', () => {
    expect(lines).toContain(
      'COPY realm-motorfix-assistants.json /opt/keycloak/data/import/',
    );
    expect(lines).toContain('EXPOSE 8080');
    expect(lines.filter((l) => /^EXPOSE/.test(l))).toEqual(['EXPOSE 8080']);
    expect(text).not.toMatch(
      /KC_DB_PASSWORD=|KEYCLOAK_ADMIN_PASSWORD=|KC_BOOTSTRAP_ADMIN_PASSWORD=/,
    );
  });

  it('turns persistent sessions off nowhere', () => {
    expect(text).not.toMatch(
      /persistent-user-sessions|PERSISTENT_USER_SESSIONS/i,
    );
  });
});
