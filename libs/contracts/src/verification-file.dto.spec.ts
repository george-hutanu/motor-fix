import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import {
  ReportDecisionDto,
  VerificationFileDto,
  VerificationFileGarageDto,
  VerificationFileSuspensionDto,
} from './verification-file.dto';
import { VerificationQueueRowDto } from './verification-queue';

// @traces 069-FR-001 069-FR-008

const read = (plain: unknown) => plainToInstance(ReportDecisionDto, plain);
const errorsFor = async (plain: unknown) =>
  (await validate(read(plain))).map((error) => error.property);

describe('ReportDecisionDto', () => {
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

// @traces 116-FR-018
describe('the stored CUI warning in the contract', () => {
  const description = (dto: object, name: string) =>
    (
      Reflect.getMetadata('swagger/apiModelProperties', dto, name) as {
        description: string;
      }
    ).description;

  it.each([
    ['the file', VerificationFileGarageDto.prototype],
    ['the queue row', VerificationQueueRowDto.prototype],
  ])('names the marker a client replaces on %s', (_, dto) => {
    expect(description(dto, 'cuiWarning')).toContain('U+FFFC');
  });
});

// @traces 067-FR-010
describe("the file's latest suspension in the contract", () => {
  const property = (dto: object, name: string) =>
    Reflect.getMetadata('swagger/apiModelProperties', dto, name) as
      | { nullable?: boolean; type?: unknown; enum?: unknown }
      | undefined;

  it('carries the cause, reason, start, end, lifter and note', () => {
    const fields = Reflect.getMetadata(
      'swagger/apiModelPropertiesArray',
      VerificationFileSuspensionDto.prototype,
    ) as string[];

    expect(fields.map((field) => field.replace(/^:/, '')).sort()).toEqual([
      'cause',
      'fromTime',
      'liftedBy',
      'note',
      'reason',
      'untilTime',
    ]);
    for (const open of ['untilTime', 'liftedBy', 'note']) {
      expect(
        property(VerificationFileSuspensionDto.prototype, open)?.nullable,
      ).toBe(true);
    }
    expect(
      property(VerificationFileSuspensionDto.prototype, 'cause')?.enum,
    ).toEqual([
      'recheck_failed',
      'documents_overdue',
      'admin',
      'report_confirmed',
    ]);
  });

  it('is null on a file whose garage was never suspended', () => {
    expect(property(VerificationFileDto.prototype, 'suspension')).toMatchObject(
      { nullable: true, type: VerificationFileSuspensionDto },
    );
  });
});
