import { NOTIFICATION_TYPES, notificationType, sendsEmail } from './catalogue';
import { render } from './templates';
import { TEMPLATES } from './templates/registry';

const NOT_URGENT = [
  'DUE_ITP',
  'DUE_RCA',
  'DUE_ROVINIETA',
  'TYRES_SEASON',
  'SERVICE_DUE',
  'BOOKING_REMINDER',
  'REQUEST_REMINDER',
  'DOCUMENT_DUE',
  'LISTING_REMINDER',
  'NEWS',
  'REVIEW_INVITE',
];

const ALWAYS_SENT = [
  'VERIFICATION_RESULT',
  'GARAGE_SUSPENDED',
  'GARAGE_RESTORED',
  'JOB_READY',
  'BOOKING_CONFIRMED',
  'BOOKING_TIME_PROPOSED',
  'BOOKING_CANCELLED',
  'BOOKING_LAPSED',
  'GARAGE_SUSPENDED_NOTICE',
  'BOOKING_MOVE_REFUSED',
  'BOOKING_MOVE_LAPSED',
  'DOCUMENT_DUE',
  'DOCUMENT_OVERDUE',
];

const TRANSACTIONAL = [
  'SIGN_IN_CODE',
  'PHONE_CHANGE_CODE',
  'ACCOUNT_EMAIL',
  'DATA_EXPORT_READY',
  'LISTING_CONTINUE_LINK',
  'STAFF_INVITE',
  'CAR_TRANSFER_LINK',
  'ASSISTANT_APPROVAL_NEEDED',
  'SUPPORT_ACKNOWLEDGEMENT',
  'TEST_MESSAGE',
];

const names = Object.keys(NOTIFICATION_TYPES);

describe('the notification catalogue', () => {
  it('lists every type of the feature catalogue and the test message', () => {
    for (const name of [
      'QUOTE_RECEIVED',
      'QUOTE_CHANGED',
      'MESSAGE_RECEIVED',
      'BOOKING_MOVED',
      'JOB_STARTED',
      'MEDIA_REMOVED',
      'REVIEW_REPLIED',
      'CAR_TRANSFER_ACCEPTED',
      'REQUEST_RECEIVED',
      'BOOKING_CONFIRM_REMINDER',
      'DAY_SHEET',
      'DAY_SHEET_OUTDATED',
      'DAY_SHEET_NOT_SENT',
      'DIRECT_REQUEST',
      'FACILITY_RE_ADD_DECIDED',
      'ADMIN_OUTAGE_ALERT',
      'ADMIN_STATUS_ALERT',
      'ADMIN_RECHECK_DUE',
      ...NOT_URGENT,
      ...ALWAYS_SENT,
      ...TRANSACTIONAL,
    ]) {
      expect(names).toContain(name);
    }
    expect(names.length).toBeGreaterThanOrEqual(79);
  });

  it('gives every type a trigger, channels, its flags, a group and a template key', () => {
    for (const name of names) {
      const type = NOTIFICATION_TYPES[name];
      expect(['event', 'timer', 'direct']).toContain(type.trigger);
      for (const channel of type.channels) {
        expect(['email', 'push', 'sms', 'whatsapp']).toContain(channel);
      }
      expect(typeof type.alwaysSent).toBe('boolean');
      expect(typeof type.transactional).toBe('boolean');
      expect(typeof type.groupable).toBe('boolean');
      expect(typeof type.urgent).toBe('boolean');
      expect([
        null,
        'offers',
        'bookings',
        'due_dates',
        'news',
        'reviews_history',
      ]).toContain(type.group);
      expect(type.templateKey).toMatch(/^[a-z_.]+$/);
    }
  });

  it('never groups an always-sent or transactional type', () => {
    for (const name of [...ALWAYS_SENT, ...TRANSACTIONAL]) {
      expect(NOTIFICATION_TYPES[name].groupable).toBe(false);
    }
    expect(NOTIFICATION_TYPES['QUOTE_RECEIVED'].groupable).toBe(true);
  });

  it('marks always-sent and transactional types as the feature lists them', () => {
    for (const name of ALWAYS_SENT) {
      expect(NOTIFICATION_TYPES[name].alwaysSent).toBe(true);
    }
    for (const name of TRANSACTIONAL) {
      expect(NOTIFICATION_TYPES[name].transactional).toBe(true);
    }
    expect(NOTIFICATION_TYPES['QUOTE_RECEIVED'].alwaysSent).toBe(false);
  });

  it('holds only the listed types in quiet hours', () => {
    for (const name of names) {
      expect(NOTIFICATION_TYPES[name].urgent).toBe(!NOT_URGENT.includes(name));
    }
  });

  it('keeps reviews, repair history and car transfers in the reviews and history group', () => {
    for (const name of [
      'REVIEW_INVITE',
      'REVIEW_REPLIED',
      'REVIEW_DECIDED',
      'REVIEW_APPEAL_DECIDED',
      'REPAIR_UPDATED',
      'CAR_TRANSFER_ACCEPTED',
    ]) {
      expect(NOTIFICATION_TYPES[name].group).toBe('reviews_history');
    }
    expect(NOTIFICATION_TYPES['QUOTE_RECEIVED'].group).toBe('offers');
    expect(NOTIFICATION_TYPES['BOOKING_REMINDER'].group).toBe('bookings');
    expect(NOTIFICATION_TYPES['DUE_ITP'].group).toBe('due_dates');
    expect(NOTIFICATION_TYPES['NEWS'].group).toBe('news');
  });

  it('sends the test message and account e-mails by e-mail only', () => {
    expect(NOTIFICATION_TYPES['TEST_MESSAGE'].channels).toEqual(['email']);
    expect(NOTIFICATION_TYPES['ACCOUNT_EMAIL'].channels).toEqual(['email']);
    expect(NOTIFICATION_TYPES['SIGN_IN_CODE'].channels).toEqual(['whatsapp']);
    expect(NOTIFICATION_TYPES['REVIEW_INVITE'].channels).not.toContain('sms');
    expect(NOTIFICATION_TYPES['DAY_SHEET_OUTDATED'].channels).toEqual([]);
  });

  it('refuses an unknown type', () => {
    expect(() => notificationType('NOT_A_TYPE')).toThrow(/NOT_A_TYPE/);
    expect(notificationType('JOB_READY').alwaysSent).toBe(true);
  });
});

describe('choosing e-mail', () => {
  const muted = new Set(['email'] as const);

  it('sends e-mail for a type that allows it when nothing is muted', () => {
    expect(sendsEmail(notificationType('QUOTE_RECEIVED'))).toBe(true);
  });

  it('skips e-mail for a type that does not allow it', () => {
    expect(sendsEmail(notificationType('SIGN_IN_CODE'))).toBe(false);
  });

  it('respects a muted e-mail for an ordinary type', () => {
    expect(sendsEmail(notificationType('QUOTE_RECEIVED'), muted)).toBe(false);
  });

  it('always includes e-mail for an always-sent type, even when muted', () => {
    expect(sendsEmail(notificationType('VERIFICATION_RESULT'), muted)).toBe(
      true,
    );
  });

  it('ignores mutes for a transactional type', () => {
    expect(sendsEmail(notificationType('ACCOUNT_EMAIL'), muted)).toBe(true);
  });
});

describe('the sign-in code message', () => {
  it.each([
    ['ro', 'motorfix_sign_in_code_ro'],
    ['en', 'motorfix_sign_in_code_en'],
  ])(
    'fills the %s WhatsApp template with the code and its minutes',
    (language, name) => {
      expect(
        render('SIGN_IN_CODE', 'whatsapp', language, {
          code: '012345',
          minutes: 5,
        }),
      ).toEqual({ name, params: ['012345', '5'] });
    },
  );

  it('holds the code and the minutes and nothing else: no link, no name', () => {
    expect(TEMPLATES['SIGN_IN_CODE']?.values).toEqual({
      code: 'text',
      minutes: 'num',
    });
    expect(Object.keys(TEMPLATES['SIGN_IN_CODE'] ?? {}).sort()).toEqual([
      'audience',
      'example',
      'values',
      'whatsapp',
    ]);
  });
});
