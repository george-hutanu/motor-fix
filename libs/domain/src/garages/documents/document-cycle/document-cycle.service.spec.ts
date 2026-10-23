import { type CycleDocument, rowOf } from './document-cycle.service';

// @traces 068-FR-002
// @traces 068-FR-005

const TODAY = '2026-10-23';
const due = (dueOn: string) => ({ dueOn, state: 'due' as const });
const overdue = { dueOn: '2026-10-01', state: 'overdue' as const };

const doc = (
  kind: CycleDocument['kind'],
  status: CycleDocument['status'],
  createdAt: string,
): CycleDocument => ({ createdAt: new Date(createdAt), kind, status });

const VALID = [
  doc('onrc_certificate', 'valid', '2026-01-10'),
  doc('rar_authorisation', 'valid', '2026-01-10'),
];

describe('the documents row of a garage', () => {
  it('reads valid while the due date is more than 30 days away', () => {
    expect(rowOf(due('2026-11-23'), VALID, TODAY)).toEqual({
      canUpload: true,
      row: 'valid',
    });
  });

  it('reads due from 30 days before the due date to the due day', () => {
    expect(rowOf(due('2026-11-22'), VALID, TODAY).row).toBe('due');
    expect(rowOf(due(TODAY), VALID, TODAY).row).toBe('due');
  });

  it('reads in review, with no upload, while a document waits for an admin', () => {
    const waiting = [
      ...VALID,
      doc('onrc_certificate', 'in_review', '2026-10-20'),
    ];
    expect(rowOf(due('2026-11-01'), waiting, TODAY)).toEqual({
      canUpload: false,
      row: 'in_review',
    });
    expect(rowOf(overdue, waiting, TODAY)).toEqual({
      canUpload: false,
      row: 'in_review',
    });
  });

  it('reads refused while the newest document of a kind is refused', () => {
    const refused = [
      ...VALID,
      doc('rar_authorisation', 'refused', '2026-10-20'),
    ];
    expect(rowOf(due('2026-11-01'), refused, TODAY)).toEqual({
      canUpload: true,
      row: 'refused',
    });
  });

  it('stops reading refused once the kind is uploaded again and accepted', () => {
    const accepted = [
      ...VALID,
      doc('rar_authorisation', 'refused', '2026-10-20'),
      doc('rar_authorisation', 'valid', '2026-10-21'),
    ];
    expect(rowOf(due('2027-10-21'), accepted, TODAY).row).toBe('valid');
  });

  it('reads overdue once the cycle is overdue and nothing is in review', () => {
    expect(rowOf(overdue, VALID, TODAY)).toEqual({
      canUpload: true,
      row: 'overdue',
    });
    const refused = [
      ...VALID,
      doc('rar_authorisation', 'refused', '2026-10-20'),
    ];
    expect(rowOf(overdue, refused, TODAY).row).toBe('overdue');
  });
});
