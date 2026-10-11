import { bellLink, VIEW_OF_KIND } from './bell.link';
import { NOTIFICATION_TYPES } from '../catalogue';

const CAR = '6f1c2a3e-1d4b-4a8e-9c1f-2b3d4e5f6a7b';
const REQUEST = '0a9b8c7d-6e5f-4a3b-8c2d-1e0f9a8b7c6d';
const requestLink = `https://motorfix.ro/app/driver/requests/${REQUEST}`;

const CAR_KINDS = [
  'DUE_ITP',
  'DUE_RCA',
  'DUE_ROVINIETA',
  'TYRES_SEASON',
  'SERVICE_DUE',
  'REPAIR_UPDATED',
  'CAR_TRANSFER_ACCEPTED',
];
const REQUEST_KINDS = [
  'QUOTE_RECEIVED',
  'QUOTE_CHANGED',
  'QUOTE_WITHDRAWN',
  'QUOTE_EXPIRED',
  'REQUEST_DECLINED',
  'REQUEST_EXPIRED',
  'MESSAGE_RECEIVED',
  'NO_SHOW_RECORDED',
  'FINAL_PRICE_CORRECTED',
  'LIVE_STARTED',
  'GARAGE_SUSPENDED_NOTICE',
  'BOOKING_CANCELLED',
  'BOOKING_CONFIRMED',
  'BOOKING_LAPSED',
  'BOOKING_MOVE_LAPSED',
  'BOOKING_MOVE_REFUSED',
  'BOOKING_MOVE_REQUESTED',
  'BOOKING_MOVED',
  'BOOKING_REMINDER',
  'BOOKING_TIME_PROPOSED',
  'JOB_ETA_CHANGED',
  'JOB_READY',
  'JOB_STARTED',
  'MEDIA_ADDED',
  'MEDIA_REMOVED',
];
const REVIEW_KINDS = [
  'REVIEW_INVITE',
  'REVIEW_REPLIED',
  'REVIEW_DECIDED',
  'REVIEW_APPEAL_DECIDED',
];

// @traces 032-FR-001 032-FR-003
describe('the view a bell row opens', () => {
  it.each(CAR_KINDS)('opens %s at its car in Mașinile mele', (kind) => {
    expect(bellLink({ kind, params: {}, subjectId: CAR })).toBe(
      `/app/driver/cars/${CAR}`,
    );
  });

  it.each(REQUEST_KINDS)(
    'opens %s at the request its e-mail links to in Cererile mele',
    (kind) => {
      expect(
        bellLink({ kind, params: { link: requestLink }, subjectId: CAR }),
      ).toBe(`/app/driver/requests/${REQUEST}`);
    },
  );

  it.each(REVIEW_KINDS)('opens %s on Recenziile mele', (kind) => {
    expect(bellLink({ kind, params: {}, subjectId: CAR })).toBe(
      '/app/driver/reviews',
    );
  });

  it('maps exactly the kinds named, each one a catalogue type', () => {
    expect(Object.keys(VIEW_OF_KIND).sort()).toEqual(
      [...CAR_KINDS, ...REQUEST_KINDS, ...REVIEW_KINDS].sort(),
    );
    for (const kind of Object.keys(VIEW_OF_KIND))
      expect(Object.hasOwn(NOTIFICATION_TYPES, kind)).toBe(true);
  });
});

// @traces 032-FR-002
describe('a row that opens nothing', () => {
  it.each([
    'TEST_MESSAGE',
    'NEWS',
    'REQUEST_RECEIVED',
    'STAFF_JOINED',
    'ADMIN_GARAGE_REPORTED',
    'BOOKING_SOMETHING_NEW',
    'constructor',
  ])('gives %s no link', (kind) => {
    expect(
      bellLink({ kind, params: { link: requestLink }, subjectId: CAR }),
    ).toBeNull();
  });
});

// @traces 032-FR-005
describe('a row whose subject cannot be named', () => {
  it('opens Mașinile mele at the top for a car reminder with no car', () => {
    expect(bellLink({ kind: 'DUE_ITP', params: {}, subjectId: null })).toBe(
      '/app/driver/cars',
    );
  });

  it.each([
    ['no link', {}],
    ['a link that is not a URL', { link: 'not a url' }],
    [
      'a link to another view',
      { link: 'https://motorfix.ro/app/driver/cars/x' },
    ],
    ['a request link with more after it', { link: `${requestLink}/quotes` }],
    [
      'a request id that is not an id',
      { link: 'https://motorfix.ro/app/driver/requests/..' },
    ],
    ['a link that is not text', { link: 42 }],
  ])('opens Cererile mele at the top for %s', (_, params) => {
    expect(bellLink({ kind: 'QUOTE_RECEIVED', params, subjectId: CAR })).toBe(
      '/app/driver/requests',
    );
  });

  it('opens Cererile mele at the top when the row has no parameters', () => {
    expect(
      bellLink({ kind: 'QUOTE_RECEIVED', params: null, subjectId: CAR }),
    ).toBe('/app/driver/requests');
  });
});
