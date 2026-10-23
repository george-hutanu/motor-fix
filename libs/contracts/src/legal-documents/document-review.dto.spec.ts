import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import {
  DOCUMENT_REFUSAL_NOTE_MAX,
  DOCUMENT_REFUSAL_REASONS,
  DocumentRefusalDto,
} from './document-cycle.dto';
import { legalCheckRows } from '../legal-check.dto';

// As the API's ValidationPipe checks a body: unknown fields refused.
function check(body: object) {
  const dto = plainToInstance(DocumentRefusalDto, body);
  const errors = validateSync(dto, {
    forbidNonWhitelisted: true,
    whitelist: true,
  });
  return { dto, failed: errors.map((e) => e.property) };
}

// @traces 068-FR-010
// @traces 068-FR-015
describe('refusing a yearly document', () => {
  it('takes one of the two reasons and a note', () => {
    expect(DOCUMENT_REFUSAL_REASONS).toEqual(['documents', 'other']);
    for (const reason of DOCUMENT_REFUSAL_REASONS) {
      expect(check({ note: 'Certificatul e ilizibil', reason }).failed).toEqual(
        [],
      );
    }
  });

  it('trims the note', () => {
    const { dto, failed } = check({
      note: '  Pagina 2 lipsește  ',
      reason: 'documents',
    });
    expect(failed).toEqual([]);
    expect(dto.note).toBe('Pagina 2 lipsește');
  });

  it('keeps line breaks in the note', () => {
    expect(
      check({ note: 'Pagina 1 neclară.\nPagina 2 lipsește.', reason: 'other' })
        .failed,
    ).toEqual([]);
  });

  it('refuses a missing reason or one outside the two', () => {
    expect(check({ note: 'Notă' }).failed).toEqual(['reason']);
    expect(check({ note: 'Notă', reason: 'expired' }).failed).toEqual([
      'reason',
    ]);
  });

  it('refuses a missing, blank or over-long note', () => {
    expect(check({ reason: 'other' }).failed).toEqual(['note']);
    expect(check({ note: '   ', reason: 'other' }).failed).toEqual(['note']);
    expect(
      check({ note: 'a'.repeat(DOCUMENT_REFUSAL_NOTE_MAX), reason: 'other' })
        .failed,
    ).toEqual([]);
    expect(
      check({
        note: 'a'.repeat(DOCUMENT_REFUSAL_NOTE_MAX + 1),
        reason: 'other',
      }).failed,
    ).toEqual(['note']);
    expect(DOCUMENT_REFUSAL_NOTE_MAX).toBe(500);
  });

  it('refuses a note holding a control character', () => {
    expect(
      check({ note: 'Notă\u0000ascunsă', reason: 'other' }).failed,
    ).toEqual(['note']);
    expect(
      check({ note: 'Notă\u001bascunsă', reason: 'other' }).failed,
    ).toEqual(['note']);
  });

  it('refuses a field it does not know', () => {
    expect(
      check({ note: 'Notă', reason: 'other', status: 'valid' }).failed,
    ).toEqual(['status']);
  });
});

const VALID = [
  { kind: 'onrc_certificate', status: 'valid' },
  { kind: 'rar_authorisation', status: 'valid' },
];
const documentsRow = (row: Parameters<typeof legalCheckRows>[0]['cycleRow']) =>
  legalCheckRows({
    checks: [],
    cycleRow: row,
    documents: VALID,
    lastCheckedOn: '2026-10-01',
  })[3];

// @traces 068-FR-005
describe('the documents row of the legal check, by the yearly cycle', () => {
  it('is ok while the documents are valid and not near their due date', () => {
    expect(documentsRow('valid')?.state).toBe('ok');
  });

  it('is a warning near the due date and while a document is in review', () => {
    expect(documentsRow('due')?.state).toBe('warning');
    expect(documentsRow('in_review')?.state).toBe('warning');
  });

  it('is failed once overdue or after a refusal', () => {
    expect(documentsRow('overdue')?.state).toBe('failed');
    expect(documentsRow('refused')?.state).toBe('failed');
  });
});
