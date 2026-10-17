import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { RecordVerificationCheckDto } from './verification-checks';

// @traces 203-FR-001

// The property paths that failed, nested ones as `evidence.<field>`.
function failures(body: unknown) {
  const dto = plainToInstance(RecordVerificationCheckDto, body as object);
  const paths = validateSync(dto, {
    forbidNonWhitelisted: true,
    whitelist: true,
  }).flatMap((error) =>
    error.children?.length
      ? error.children.map((child) => `${error.property}.${child.property}`)
      : [error.property],
  );
  return { dto, paths };
}

describe('the record body with evidence', () => {
  it('accepts the company name, trimmed', () => {
    const { dto, paths } = failures({
      evidence: { name: '  Auto Vest Motors SRL ' },
      result: 'ok',
    });
    expect(paths).toEqual([]);
    expect(dto.evidence?.name).toBe('Auto Vest Motors SRL');
  });

  it('accepts the three CAEN ticks as booleans', () => {
    expect(
      failures({
        evidence: { address: true, certificate: false, onrc: true },
        result: 'ok',
      }).paths,
    ).toEqual([]);
  });

  it('refuses a name of spaces only, one over 200 characters, or one with control characters', () => {
    for (const name of ['   ', 'a'.repeat(201), 'Auto\u0007Vest']) {
      expect(failures({ evidence: { name }, result: 'ok' }).paths).toEqual([
        'evidence.name',
      ]);
    }
    expect(
      failures({ evidence: { name: 'a'.repeat(200) }, result: 'ok' }).paths,
    ).toEqual([]);
  });

  it('refuses a tick that is not a boolean', () => {
    expect(failures({ evidence: { onrc: 'yes' }, result: 'ok' }).paths).toEqual(
      ['evidence.onrc'],
    );
  });

  it('refuses the fields the server writes, and any other key', () => {
    for (const key of ['certificateUploaded', 'lookedUpOn', 'active']) {
      expect(
        failures({ evidence: { [key]: true, onrc: true }, result: 'ok' }).paths,
      ).toEqual([`evidence.${key}`]);
    }
  });

  it('refuses evidence that is not an object', () => {
    expect(failures({ evidence: 'all good', result: 'ok' }).paths).toEqual([
      'evidence',
    ]);
  });

  it('keeps a body without evidence valid', () => {
    expect(
      failures({ detail: 'Firmă radiată', result: 'failed' }).paths,
    ).toEqual([]);
  });
});
