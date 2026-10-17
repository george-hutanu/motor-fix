import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { AdminGaragesQueryDto } from './suspended-garages';

function errorsOf(input: Record<string, unknown>): string[] {
  return validateSync(plainToInstance(AdminGaragesQueryDto, input)).map(
    (e) => e.property,
  );
}

describe('AdminGaragesQueryDto', () => {
  // @traces 066-FR-002
  it('accepts status suspended alone', () => {
    expect(errorsOf({ status: 'suspended' })).toEqual([]);
  });

  // @traces 066-FR-002
  it('rejects a missing status', () => {
    expect(errorsOf({})).toEqual(['status']);
  });

  // @traces 066-FR-002
  it.each([
    'approved',
    'Suspended',
    'SUSPENDED',
    ' suspended',
    'suspended ',
    '',
    'suspended,approved',
    'draft',
  ])('rejects status %j', (status) => {
    expect(errorsOf({ status })).toEqual(['status']);
  });

  // @traces 066-FR-002
  it.each([null, undefined, 0, true, ['suspended'], { a: 1 }])(
    'rejects non-string status %j',
    (status) => {
      expect(errorsOf({ status })).toEqual(['status']);
    },
  );

  // @traces 066-FR-002
  it.each(['0', '1', '10000', 0, 10000])('accepts offset %j', (offset) => {
    expect(errorsOf({ offset, status: 'suspended' })).toEqual([]);
  });

  // @traces 066-FR-002
  it.each(['-1', '10001', '1.5', 'abc', '1e9', 'NaN', 'Infinity', -1, 10001])(
    'rejects offset %j',
    (offset) => {
      expect(errorsOf({ offset, status: 'suspended' })).toEqual(['offset']);
    },
  );

  // @traces 066-FR-002
  it.each(['1', '20', '200', 1, 200])('accepts limit %j', (limit) => {
    expect(errorsOf({ limit, status: 'suspended' })).toEqual([]);
  });

  // @traces 066-FR-002
  it.each(['0', '201', '-5', '2.5', 'ten', '1e3', 0, 201])(
    'rejects limit %j',
    (limit) => {
      expect(errorsOf({ limit, status: 'suspended' })).toEqual(['limit']);
    },
  );

  // @traces 066-FR-002
  it('reports offset and limit together when both are out of range', () => {
    expect(
      errorsOf({ limit: '0', offset: '-1', status: 'suspended' }).sort(),
    ).toEqual(['limit', 'offset']);
  });

  // @traces 066-FR-002
  it('rejects an array-valued limit from a repeated query key', () => {
    expect(errorsOf({ limit: ['5', '6'], status: 'suspended' })).toEqual([
      'limit',
    ]);
  });

  // @traces 066-FR-002
  it('rejects an empty-string limit instead of reading it as zero or default', () => {
    expect(errorsOf({ limit: '', status: 'suspended' })).toEqual(['limit']);
  });

  // @traces 066-FR-002
  it('rejects an empty-string offset', () => {
    expect(errorsOf({ offset: '', status: 'suspended' })).toEqual(['offset']);
  });

  // @traces 066-FR-002
  it('rejects the text null as an offset', () => {
    expect(errorsOf({ offset: 'null', status: 'suspended' })).toEqual([
      'offset',
    ]);
  });
});
