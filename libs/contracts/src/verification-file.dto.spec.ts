import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import {
  REPORT_DECISIONS,
  REPORT_STATUSES,
  ReportDecisionDto,
} from './verification-file.dto';

// @traces 069-report-decision-FR-001 069-report-decision-FR-008

const read = (plain: unknown) => plainToInstance(ReportDecisionDto, plain);
const errorsFor = async (plain: unknown) =>
  (await validate(read(plain))).map((error) => error.property);

describe('ReportDecisionDto', () => {
  it('takes the two decisions and no other', () => {
    expect([...REPORT_DECISIONS]).toEqual(['unfounded', 'confirmed']);
  });

  it('names the three states a report can be in', () => {
    expect([...REPORT_STATUSES]).toEqual(['open', 'unfounded', 'confirmed']);
  });

  it.each([
    ['an unfounded decision with no note', { decision: 'unfounded' }],
    [
      'an unfounded decision with a 1,000-character note',
      { decision: 'unfounded', note: 'ă'.repeat(1000) },
    ],
    [
      'a note with line breaks and tabs',
      { decision: 'unfounded', note: 'Am sunat.\n\tNimic.' },
    ],
    [
      'a confirmed decision with a 200-character reason',
      { decision: 'confirmed', reason: 'ș'.repeat(200) },
    ],
    // The use case answers 422 to a confirmation without its reason.
    ['a confirmed decision with no reason', { decision: 'confirmed' }],
    // A field the decision does not read is ignored, whatever it holds.
    [
      'an unfounded decision carrying a long reason',
      { decision: 'unfounded', reason: 'a'.repeat(500) },
    ],
    [
      'a confirmed decision carrying a long note',
      { decision: 'confirmed', note: 'a'.repeat(5000), reason: 'RAR' },
    ],
  ])('accepts %s', async (_, body) => {
    expect(await errorsFor(body)).toEqual([]);
  });

  it('trims the note and the reason, and makes a blank one none', () => {
    expect(read({ decision: 'unfounded', note: '  Am sunat.\n' }).note).toBe(
      'Am sunat.',
    );
    expect(read({ decision: 'confirmed', reason: ' RAR ' }).reason).toBe('RAR');
    expect(read({ decision: 'confirmed', reason: ' \t ' }).reason).toBe(
      undefined,
    );
    expect(read({ decision: 'unfounded', note: '   ' }).note).toBe(undefined);
  });

  it.each([
    ['an unknown decision', { decision: 'dismissed' }, 'decision'],
    ['a decision in capitals', { decision: 'UNFOUNDED' }, 'decision'],
    ['no decision', { note: 'x' }, 'decision'],
    [
      'a 1,001-character note',
      { decision: 'unfounded', note: 'a'.repeat(1001) },
      'note',
    ],
    ['a note that is a number', { decision: 'unfounded', note: 42 }, 'note'],
    [
      'a note with a control character',
      { decision: 'unfounded', note: 'Am\u0007 sunat' },
      'note',
    ],
    [
      'a 201-character reason',
      { decision: 'confirmed', reason: 'a'.repeat(201) },
      'reason',
    ],
    [
      'a reason that is an array',
      { decision: 'confirmed', reason: ['RAR'] },
      'reason',
    ],
    [
      'a reason with a line break',
      { decision: 'confirmed', reason: 'RAR\nexpirat' },
      'reason',
    ],
  ])('refuses %s', async (_, body, field) => {
    expect(await errorsFor(body)).toContain(field);
  });
});
