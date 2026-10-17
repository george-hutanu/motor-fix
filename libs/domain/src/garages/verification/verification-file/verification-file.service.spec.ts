import { certificateStale, timelineWhere } from './verification-file.service';

// @traces 302-FR-001 302-FR-010

describe('certificateStale', () => {
  const sent = new Date('2026-10-15T10:00:00+03:00');

  it.each([
    ['2026-10-15', false],
    ['2026-09-15', false],
    ['2026-09-14', true],
    ['2026-10-16', true],
  ])('judges a certificate issued on %s', (issuedOn, stale) => {
    expect(certificateStale(new Date(issuedOn), sent)).toBe(stale);
  });

  it('counts a missing issue date as stale', () => {
    expect(certificateStale(null, sent)).toBe(true);
  });

  it("takes the sending's day in Bucharest, not in UTC", () => {
    // 00:30 on 15 October in Bucharest is still 14 October in UTC.
    const justAfterMidnight = new Date('2026-10-14T21:30:00Z');

    expect(certificateStale(new Date('2026-09-15'), justAfterMidnight)).toBe(
      false,
    );
  });
});

describe('timelineWhere', () => {
  it("keeps the file's sending and status changes, its checks' records and its documents' openings", () => {
    expect(timelineWhere('f', ['c1', 'c2'], ['d1'])).toEqual({
      OR: [
        {
          OR: [{ action: 'create' }, { action: 'update', field: 'status' }],
          subjectId: 'f',
          subjectType: 'verification_file',
        },
        { subjectId: { in: ['c1', 'c2'] }, subjectType: 'verification_check' },
        {
          action: 'open',
          subjectId: { in: ['d1'] },
          subjectType: 'legal_document',
        },
      ],
    });
  });
});
