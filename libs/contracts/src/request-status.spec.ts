import { REQUEST_STATUS_LABELS, REQUEST_STATUSES } from './request-status';

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
