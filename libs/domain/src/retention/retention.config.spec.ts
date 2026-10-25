import {
  ANONYMISED,
  RETENTION,
  RETENTION_BATCH,
  RETENTION_DECIDED,
  RETENTION_KINDS,
  retentionCutoff,
} from './retention.config';

// @traces 1156-FR-001
describe('the retention config', () => {
  it("holds the owner's periods in whole days", () => {
    expect(
      Object.fromEntries(
        Object.entries(RETENTION).map(([name, { days }]) => [name, days]),
      ),
    ).toEqual({
      auditHistory: 1826,
      daySheetPdfs: 30,
      legalDocuments: 1826,
      media: 90,
      notifications: 365,
    });
    for (const { covers, days } of Object.values(RETENTION)) {
      expect(Number.isInteger(days) && days > 0).toBe(true);
      expect(covers.length).toBeGreaterThan(0);
    }
  });

  it('cites the decision, the batch size and the anonymised marker', () => {
    expect(RETENTION_DECIDED).toBe('T10, 2026-10-16');
    expect(RETENTION_BATCH).toBe(1000);
    expect(ANONYMISED).toBe('anonymised');
  });

  it('names the eight kinds the nightly run sweeps, in their order', () => {
    expect(RETENTION_KINDS).toEqual([
      'sign_in_code',
      'phone_change',
      'account_token',
      'refresh_token',
      'staff_invite',
      'notification',
      'legal_document',
      'audit_entry',
    ]);
  });

  it('cuts off exactly the period before now', () => {
    const now = new Date('2026-10-24T10:00:00.000Z');
    expect(retentionCutoff(now, 30)).toEqual(
      new Date('2026-09-24T10:00:00.000Z'),
    );
  });
});
