import {
  DECLINE_REASON_CODES,
  DECLINE_REASON_TEXTS,
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
// @traces 345-FR-012
describe('the reasons a garage’s request closed', () => {
  it('are tried in this order, the garage’s own decline first', () => {
    expect(GARAGE_CLOSE_REASONS).toEqual([
      'declined',
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
        declined: 'Declined',
        expired: 'Request expired',
        garage_suspended: 'Garage suspended',
      },
      ro: {
        accepted_elsewhere: 'Clientul a acceptat altă ofertă',
        account_closed: 'Cerere închisă',
        cancelled: 'Cerere anulată de client',
        declined: 'Refuzată',
        expired: 'Cerere expirată',
        garage_suspended: 'Service suspendat',
      },
    });
  });
});

// @traces 345-FR-010
// @traces 345-FR-014
describe('the reasons a garage declines', () => {
  it('have a label and a clause in both languages for every reason, and nothing else', () => {
    expect(Object.keys(DECLINE_REASON_TEXTS).sort()).toEqual(
      [...DECLINE_REASON_CODES].sort(),
    );
    for (const code of DECLINE_REASON_CODES) {
      for (const lang of ['ro', 'en'] as const) {
        expect(DECLINE_REASON_TEXTS[code].label[lang]).toMatch(/\S/);
        expect(DECLINE_REASON_TEXTS[code].clause[lang]).toMatch(/\S/);
      }
    }
  });

  it('read as the spec words them', () => {
    expect(DECLINE_REASON_TEXTS).toEqual({
      fully_booked: {
        clause: { en: 'it is fully booked', ro: 'este ocupat complet' },
        label: { en: 'We are fully booked', ro: 'Suntem ocupați complet' },
      },
      job_not_done: {
        clause: {
          en: 'it does not do this job',
          ro: 'nu face această lucrare',
        },
        label: { en: "We don't do this job", ro: 'Nu facem această lucrare' },
      },
      make_model_engine_not_done: {
        clause: {
          en: 'it does not work on this make, model or engine',
          ro: 'nu lucrează pe această marcă, model sau motor',
        },
        label: {
          en: "We don't work on this make, model or engine",
          ro: 'Nu lucrăm pe această marcă, model sau motor',
        },
      },
      need_to_see_car: {
        clause: {
          en: 'it needs to see the car first',
          ro: 'trebuie să vadă mașina mai întâi',
        },
        label: {
          en: 'We need to see the car first',
          ro: 'Trebuie să vedem mașina mai întâi',
        },
      },
    });
  });
});
