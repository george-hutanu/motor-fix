import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { copyVoiceOrUndefined } from './copy-voices.dto';
import { CreateListingDraftDto } from './listing-drafts.dto';
import { CreateQuoteRequestDto } from './quote-requests.dto';

const CAR = '0f1e2d3c-0000-4000-8000-000000000001';
const GARAGE = '0f1e2d3c-0000-4000-8000-000000000101';
const JOB = '0f1e2d3c-0000-4000-8000-000000000004';
const options = { forbidNonWhitelisted: true, whitelist: true };

const request = (copyVoice?: unknown, extra: Record<string, unknown> = {}) => {
  const dto = plainToInstance(CreateQuoteRequestDto, {
    carId: CAR,
    garageIds: [GARAGE],
    jobTypeIds: [JOB],
    sources: ['profile_direct'],
    ...(copyVoice === undefined ? {} : { copyVoice }),
    ...extra,
  });
  return { dto, failed: validateSync(dto, options).map((e) => e.property) };
};

const draft = (copyVoice?: unknown) => {
  const dto = plainToInstance(CreateListingDraftDto, {
    data: { steps: {} },
    email: 'owner@example.test',
    language: 'ro',
    step: 1,
    ...(copyVoice === undefined ? {} : { copyVoice }),
  });
  return { dto, failed: validateSync(dto, options).map((e) => e.property) };
};

const HOSTILE: [string, unknown][] = [
  ['zero', 0],
  ['six', 6],
  ['seven', 7],
  ['negative', -1],
  ['a decimal', 2.5],
  ['a decimal that looks whole', 3.0000001],
  ['a numeric text', '3'],
  ['text', 'x'],
  ['an empty text', ''],
  ['null', null],
  ['NaN', Number.NaN],
  ['infinity', Number.POSITIVE_INFINITY],
  ['a huge number', 1e21],
  ['an array', [3]],
  ['an object', { n: 3 }],
  ['a boolean', true],
  ['a bigger-than-safe integer', 2 ** 60],
];

// @traces 009-FR-005
describe('copyVoiceOrUndefined', () => {
  it.each([1, 2, 3, 4, 5])('keeps %p', (value) => {
    expect(copyVoiceOrUndefined({ value })).toBe(value);
  });

  it.each(HOSTILE)('drops %s', (_name, value) => {
    expect(copyVoiceOrUndefined({ value })).toBeUndefined();
  });

  it('drops an absent value', () => {
    expect(copyVoiceOrUndefined({ value: undefined })).toBeUndefined();
  });
});

// @traces 009-FR-005
describe('a quote request with a hostile copy voice', () => {
  it.each(HOSTILE)('is created as without a voice for %s', (_name, value) => {
    const { dto, failed } = request(value);

    expect(failed).toEqual([]);
    expect(dto.copyVoice).toBeUndefined();
  });

  it.each([1, 5])('keeps the edge voice %p', (value) => {
    const { dto, failed } = request(value);

    expect(failed).toEqual([]);
    expect(dto.copyVoice).toBe(value);
  });

  it('does not let a bad voice hide a real validation error', () => {
    expect(request(7, { carId: 'not-a-uuid' }).failed).toEqual(['carId']);
  });
});

// @traces 009-FR-007
describe('a listing draft with a hostile copy voice', () => {
  it.each(HOSTILE)('is created as without a voice for %s', (_name, value) => {
    const { dto, failed } = draft(value);

    expect(failed).toEqual([]);
    expect(dto.copyVoice).toBeUndefined();
  });

  it.each([1, 5])('keeps the edge voice %p', (value) => {
    const { dto, failed } = draft(value);

    expect(failed).toEqual([]);
    expect(dto.copyVoice).toBe(value);
  });

  it('takes a body with no voice', () => {
    const { dto, failed } = draft();

    expect(failed).toEqual([]);
    expect(dto.copyVoice).toBeUndefined();
  });
});
