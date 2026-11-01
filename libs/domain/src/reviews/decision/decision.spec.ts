import { refusalOf } from './decision';

const at = (iso: string) => new Date(iso);
const one = (
  status: 'pending' | 'decided' | 'closed',
  createdAt: string,
  id = createdAt,
) => ({ createdAt: at(createdAt), id, status });

// @traces 179-FR-002
describe('why a decision was refused once nothing was written', () => {
  it('answers not_found for a review that does not exist', () => {
    expect(refusalOf(null)).toEqual({ code: 'not_found' });
  });

  it('answers no_pending_report for a review with no report', () => {
    expect(refusalOf([])).toEqual({ code: 'no_pending_report' });
  });

  it('answers no_pending_report when every report is closed', () => {
    expect(
      refusalOf([
        one('closed', '2026-10-20T10:00:00Z'),
        one('closed', '2026-10-21T10:00:00Z'),
      ]),
    ).toEqual({ code: 'no_pending_report' });
  });

  it('answers already_decided with the latest report when it is decided', () => {
    const latest = one('decided', '2026-10-21T10:00:00Z');

    expect(refusalOf([latest, one('closed', '2026-10-20T10:00:00Z')])).toEqual({
      code: 'already_decided',
      report: latest,
    });
  });

  it('reads the latest by createdAt, whatever the order it was given in', () => {
    const latest = one('decided', '2026-10-22T10:00:00Z');

    expect(
      refusalOf([
        one('closed', '2026-10-20T10:00:00Z'),
        latest,
        one('closed', '2026-10-21T10:00:00Z'),
      ]),
    ).toEqual({ code: 'already_decided', report: latest });
  });

  it('answers no_pending_report when an earlier report was decided and the latest closed', () => {
    expect(
      refusalOf([
        one('decided', '2026-10-20T10:00:00Z'),
        one('closed', '2026-10-21T10:00:00Z'),
      ]),
    ).toEqual({ code: 'no_pending_report' });
  });
});
