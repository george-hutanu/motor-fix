import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import {
  CHECK_DETAIL_MAX,
  lamp,
  RECORDED_RESULTS,
  RecordVerificationCheckDto,
  VERIFICATION_CHECK_KINDS,
  VERIFICATION_CHECK_RESULTS,
} from './verification-checks';
import { VERIFICATION_TIMELINE_MAX } from './verification-file.dto';

// @traces 302-FR-001 302-FR-002 302-FR-007 302-FR-012

const errorsFor = (plain: unknown) =>
  validate(plainToInstance(RecordVerificationCheckDto, plain));

const openapi = JSON.parse(
  readFileSync(
    join(__dirname, '..', '..', '..', 'apps', 'api', 'openapi.json'),
    'utf8',
  ),
);

describe('the check detail limit', () => {
  it('is 200 characters and the timeline holds 50 entries', () => {
    expect(CHECK_DETAIL_MAX).toBe(200);
    expect(VERIFICATION_TIMELINE_MAX).toBe(50);
  });

  it('accepts a detail of exactly 200 characters and refuses 201', async () => {
    expect(
      await errorsFor({ detail: 'x'.repeat(200), result: 'failed' }),
    ).toEqual([]);
    expect(
      (await errorsFor({ detail: 'x'.repeat(201), result: 'failed' })).map(
        (e) => e.property,
      ),
    ).toEqual(['detail']);
  });

  it('counts the limit after trimming', async () => {
    expect(
      await errorsFor({
        detail: `  ${'x'.repeat(200)}  `,
        result: 'warning',
      }),
    ).toEqual([]);
  });

  it('refuses a detail of whitespace only', async () => {
    expect(
      (await errorsFor({ detail: '   ', result: 'warning' })).length,
    ).toBeGreaterThan(0);
  });

  it('refuses an empty detail', async () => {
    expect(
      (await errorsFor({ detail: '', result: 'failed' })).map(
        (e) => e.property,
      ),
    ).toEqual(['detail']);
  });

  it('refuses a null detail where undefined was meant', async () => {
    expect(
      (await errorsFor({ detail: null, result: 'failed' })).map(
        (e) => e.property,
      ),
    ).toEqual(['detail']);
  });

  it.each([
    ['a line break', 'a\nb'],
    ['a tab', 'a\tb'],
    ['a null byte', 'a\u0000b'],
    ['an escape', 'a\u001bb'],
  ])('refuses %s inside the detail', async (_name, detail) => {
    expect(
      (await errorsFor({ detail, result: 'failed' })).map((e) => e.property),
    ).toEqual(['detail']);
  });

  it('accepts Romanian diacritics and emoji', async () => {
    expect(
      await errorsFor({ detail: 'Țeavă ștearsă ăîâ 🚗', result: 'warning' }),
    ).toEqual([]);
  });

  it.each([
    ['a number', 12],
    ['an array', ['x']],
    ['an object', { a: 1 }],
    ['a boolean', true],
  ])('refuses %s as the detail', async (_name, detail) => {
    expect(
      (await errorsFor({ detail, result: 'failed' })).map((e) => e.property),
    ).toEqual(['detail']);
  });
});

describe('the recorded results', () => {
  it('are ok, warning, failed and not_run, with not_run also a stored result', () => {
    expect([...RECORDED_RESULTS].sort()).toEqual(
      ['failed', 'not_run', 'ok', 'warning'].sort(),
    );
    expect(VERIFICATION_CHECK_RESULTS).toEqual(
      expect.arrayContaining([...RECORDED_RESULTS]),
    );
  });

  it.each(['OK', 'Ok', 'pending', '', null, 1, undefined, ['ok']])(
    'refuses %p as the result',
    async (result) => {
      expect((await errorsFor({ result })).map((e) => e.property)).toContain(
        'result',
      );
    },
  );

  it('accepts a bare not_run, as an untick sends', async () => {
    expect(await errorsFor({ result: 'not_run' })).toEqual([]);
  });

  it('accepts a bare ok, as a tick sends', async () => {
    expect(await errorsFor({ result: 'ok' })).toEqual([]);
  });

  it('refuses an empty body', async () => {
    expect((await errorsFor({})).map((e) => e.property)).toContain('result');
  });

  it('refuses more than 50 activities', async () => {
    expect(
      (
        await errorsFor({
          activities: Array.from({ length: 51 }, (_, i) => `a${i}`),
          result: 'ok',
        })
      ).map((e) => e.property),
    ).toEqual(['activities']);
  });
});

describe('the lamp', () => {
  it('gives each result its own colour', () => {
    const lamps = VERIFICATION_CHECK_RESULTS.map((result) => lamp(result));
    expect(new Set(lamps).size).toBe(VERIFICATION_CHECK_RESULTS.length);
    expect(lamp('not_run')).toBe('grey');
  });
});

describe('the file routes in the OpenAPI document', () => {
  const read = openapi.paths['/api/v1/admin/verification-files/{id}']?.get;
  const open =
    openapi.paths['/api/v1/admin/verification-files/{id}/open']?.post;

  it('lists the read and the open call', () => {
    expect(read).toBeDefined();
    expect(open).toBeDefined();
  });

  it.each([
    ['read', read],
    ['open', open],
  ])('answers the %s with the file and documents a 404', (_n, route) => {
    expect(route.responses['200'].content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/VerificationFileDto',
    });
    expect(route.responses['404']).toBeDefined();
    expect(route.security).toEqual([{ bearer: [] }]);
  });

  it('refuses nothing the spec says it answers with 409', () => {
    expect(read.responses['409']).toBeUndefined();
    expect(open.responses['409']).toBeUndefined();
  });

  it('describes every field of the file, so the generated client is complete', () => {
    const file = openapi.components.schemas.VerificationFileDto;
    expect(file.required).toEqual(
      expect.arrayContaining([
        'file',
        'garage',
        'checks',
        'activities',
        'documents',
        'storageReady',
        'reports',
        'previousRejection',
        'timeline',
      ]),
    );
  });

  it('names the 8 check kinds the file carries', () => {
    expect(VERIFICATION_CHECK_KINDS).toHaveLength(8);
  });
});
