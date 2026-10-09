import {
  GARAGE_CLOSE_REASON_LABELS,
  GARAGE_CLOSE_REASONS,
  REQUEST_STATUS_LABELS,
  REQUEST_STATUSES,
} from './request-status';

// @traces 220-FR-003
describe('the request status labels', () => {
  it.each(['ro', 'en'] as const)('names every status once in %s', (lang) => {
    expect(Object.keys(REQUEST_STATUS_LABELS[lang]).sort()).toEqual(
      [...REQUEST_STATUSES].sort(),
    );
    expect(REQUEST_STATUSES).toHaveLength(6);
  });

  it('reads the same words on both sides', () => {
    expect(REQUEST_STATUS_LABELS).toEqual({
      en: {
        booked: 'Booked',
        closed: 'Closed',
        done: 'Done',
        in_work: 'In progress',
        quoted: 'Quote received',
        sent: 'Sent',
      },
      ro: {
        booked: 'Programată',
        closed: 'Încheiată',
        done: 'Gata',
        in_work: 'În lucru',
        quoted: 'Ofertă',
        sent: 'Trimisă',
      },
    });
  });
});

// @traces 343-FR-004
describe('the reasons a garage’s request closed', () => {
  it('are tried in this order', () => {
    expect(GARAGE_CLOSE_REASONS).toEqual([
      'expired',
      'garage_suspended',
      'cancelled',
      'account_closed',
      'accepted_elsewhere',
    ]);
  });

  it.each(['ro', 'en'] as const)('each have a label in %s', (lang) => {
    for (const reason of GARAGE_CLOSE_REASONS) {
      expect(GARAGE_CLOSE_REASON_LABELS[lang][reason]).toEqual(
        expect.any(String),
      );
    }
    expect(Object.keys(GARAGE_CLOSE_REASON_LABELS[lang]).sort()).toEqual(
      [...GARAGE_CLOSE_REASONS].sort(),
    );
  });

  it('read as the spec words them', () => {
    expect(GARAGE_CLOSE_REASON_LABELS).toEqual({
      en: {
        accepted_elsewhere: 'The customer accepted another quote',
        account_closed: 'Request closed',
        cancelled: 'Request cancelled by the customer',
        expired: 'Request expired',
        garage_suspended: 'Garage suspended',
      },
      ro: {
        accepted_elsewhere: 'Clientul a acceptat altă ofertă',
        account_closed: 'Cerere închisă',
        cancelled: 'Cerere anulată de client',
        expired: 'Cerere expirată',
        garage_suspended: 'Service suspendat',
      },
    });
  });
});
