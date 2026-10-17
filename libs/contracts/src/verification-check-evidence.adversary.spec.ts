import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { RecordVerificationCheckDto } from './verification-checks';

// @traces 203-FR-001

function check(body: unknown) {
  const dto = plainToInstance(RecordVerificationCheckDto, body as object);
  const failed = validateSync(dto, {
    forbidNonWhitelisted: true,
    whitelist: true,
  }).map((error) => error.property);
  return { dto, failed };
}

describe('the record body with evidence, attacked', () => {
  it('refuses a null evidence', () => {
    expect(check({ evidence: null, result: 'ok' }).failed).toContain(
      'evidence',
    );
  });

  it('refuses an array as evidence', () => {
    expect(check({ evidence: [], result: 'ok' }).failed).toContain('evidence');
    expect(check({ evidence: [{ name: 'X' }], result: 'ok' }).failed).toContain(
      'evidence',
    );
  });

  it('refuses a null name and a numeric name', () => {
    expect(check({ evidence: { name: null }, result: 'ok' }).failed).toContain(
      'evidence',
    );
    expect(check({ evidence: { name: 42 }, result: 'ok' }).failed).toContain(
      'evidence',
    );
  });

  it('refuses a null tick and a string tick', () => {
    expect(check({ evidence: { onrc: null }, result: 'ok' }).failed).toContain(
      'evidence',
    );
    expect(
      check({ evidence: { address: 'true' }, result: 'ok' }).failed,
    ).toContain('evidence');
    expect(
      check({ evidence: { certificate: 1 }, result: 'ok' }).failed,
    ).toContain('evidence');
  });

  it('accepts a name of exactly 200 characters and refuses 201', () => {
    expect(
      check({ evidence: { name: 'a'.repeat(200) }, result: 'ok' }).failed,
    ).toEqual([]);
    expect(
      check({ evidence: { name: 'a'.repeat(201) }, result: 'ok' }).failed,
    ).toContain('evidence');
  });

  it('counts a name by characters, not UTF-16 units', () => {
    expect(
      check({ evidence: { name: '🔧'.repeat(200) }, result: 'ok' }).failed,
    ).toEqual([]);
  });

  it('refuses a tab, a newline and a C1 control inside the name', () => {
    for (const bad of [
      'Auto\tVest',
      'Auto\nVest',
      'Auto\u0085Vest',
      'A\u0000',
    ]) {
      expect(check({ evidence: { name: bad }, result: 'ok' }).failed).toContain(
        'evidence',
      );
    }
  });

  it('keeps diacritics and inner spacing of the name as typed', () => {
    const { dto, failed } = check({
      evidence: { name: '  Șoșoacă  Auto  SRL  ' },
      result: 'ok',
    });
    expect(failed).toEqual([]);
    expect(dto.evidence?.name?.startsWith('Șoșoacă  Auto')).toBe(true);
  });

  it('refuses the server-written fields on every kind of body', () => {
    for (const extra of [
      { certificateUploaded: true },
      { lookedUpOn: '2026-10-17' },
      { __proto__: { admin: true }, isAdmin: true },
    ]) {
      expect(
        check({ evidence: { name: 'X', ...extra }, result: 'ok' }).failed,
      ).toContain('evidence');
    }
  });

  it('refuses a result in the wrong case or of the wrong type', () => {
    for (const result of ['OK', 'Ok', ' ok', null, 1, ['ok'], {}]) {
      expect(check({ result }).failed).toContain('result');
    }
  });

  it('refuses a body with no result', () => {
    expect(check({ evidence: { name: 'X' } }).failed).toContain('result');
  });

  it('refuses a null detail', () => {
    expect(check({ detail: null, result: 'warning' }).failed).toContain(
      'detail',
    );
  });
});
