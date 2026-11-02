import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { GaragePickQueryDto } from './garage-pick.dto';

const query = (raw: Record<string, unknown>) =>
  plainToInstance(GaragePickQueryDto, raw);
const problems = (dto: object) =>
  validateSync(dto, { forbidNonWhitelisted: true, whitelist: true }).map(
    (e) => e.property,
  );

// @traces 062-FR-009
describe('GaragePickQueryDto', () => {
  it('trims the text and takes eight by default', () => {
    const dto = query({ q: '  Popescu  ' });
    expect(problems(dto)).toEqual([]);
    expect(dto.q).toBe('Popescu');
    expect(dto.limit).toBe(8);
  });

  it.each([
    [{ q: 'Po' }],
    [{ q: 'x'.repeat(80) }],
    [{ limit: '1', q: 'Popescu' }],
    [{ limit: '8', q: 'Popescu' }],
  ])('accepts %p', (raw) => {
    expect(problems(query(raw))).toEqual([]);
  });

  it('reads the limit sent in the query as a number', () => {
    expect(query({ limit: '3', q: 'Popescu' }).limit).toBe(3);
  });

  it.each([
    ['q', {}],
    ['q', { q: 'P' }],
    ['q', { q: '  P  ' }],
    ['q', { q: 'x'.repeat(81) }],
    ['q', { q: 'ab\u0000cd' }],
    ['q', { q: 'ab\tcd' }],
    ['q', { q: 'ab\ud800cd' }],
    ['limit', { limit: '0', q: 'Popescu' }],
    ['limit', { limit: '9', q: 'Popescu' }],
    ['limit', { limit: '2.5', q: 'Popescu' }],
    ['limit', { limit: 'many', q: 'Popescu' }],
  ])('refuses %s in %p', (field, raw) => {
    expect(problems(query(raw))).toEqual([field]);
  });

  it('refuses any other parameter', () => {
    expect(problems(query({ city: 'Cluj', q: 'Popescu' }))).toEqual(['city']);
  });
});
