import { NOTIFICATION_TYPES, notificationType, sendsEmail } from './catalogue';

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
const CHANNELS = ['email', 'push', 'sms', 'whatsapp'];
const GROUPS = [
  'offers',
  'bookings',
  'due_dates',
  'news',
  'reviews_history',
  null,
];

describe('the notification catalogue under hostile lookups', () => {
  it.each([
    '',
    ' ',
    'quote_received',
    'QUOTE_RECEIVED ',
    'NOPE',
    '__proto__',
    'constructor',
    'toString',
    'hasOwnProperty',
  ])('refuses the unknown type %j', (name) => {
    expect(() => notificationType(name)).toThrow();
  });

  it.each([null, undefined, 7, {}])('refuses a non-string type %j', (name) => {
    expect(() => notificationType(name as unknown as string)).toThrow();
  });

  it('holds every type the feature names, with the test message and the account e-mail', () => {
    for (const name of [
      'TEST_MESSAGE',
      'ACCOUNT_EMAIL',
      'QUOTE_RECEIVED',
      'JOB_READY',
      'VERIFICATION_RESULT',
      'SIGN_IN_CODE',
      'BOOKING_CONFIRM_REMINDER',
      'GARAGE_SUSPENDED',
      ...NOT_URGENT,
    ]) {
      expect(NOTIFICATION_TYPES).toHaveProperty(name);
      expect(notificationType(name)).toBe(NOTIFICATION_TYPES[name]);
    }
  });
});

describe('the notification catalogue as a whole', () => {
  const entries = Object.entries(NOTIFICATION_TYPES);

  it('has at least the 75 catalogue rows plus the test message', () => {
    expect(entries.length).toBeGreaterThanOrEqual(76);
  });

  it.each(entries)('%s has a well-formed entry', (_name, entry) => {
    expect(['event', 'timer', 'direct']).toContain(entry.trigger);
    expect(Array.isArray(entry.channels)).toBe(true);
    for (const channel of entry.channels) expect(CHANNELS).toContain(channel);
    expect(new Set(entry.channels).size).toBe(entry.channels.length);
    expect(GROUPS).toContain(entry.group);
    expect(typeof entry.templateKey).toBe('string');
    expect(entry.templateKey.trim().length).toBeGreaterThan(0);
    for (const flag of [
      'alwaysSent',
      'transactional',
      'groupable',
      'urgent',
    ] as const) {
      expect(typeof entry[flag]).toBe('boolean');
    }
  });

  it('never makes an always-sent or transactional type groupable', () => {
    const bad = entries
      .filter(([, e]) => (e.alwaysSent || e.transactional) && e.groupable)
      .map(([n]) => n);
    expect(bad).toEqual([]);
  });

  it('lists exactly the named types as not urgent', () => {
    const notUrgent = entries.filter(([, e]) => !e.urgent).map(([n]) => n);
    expect(notUrgent.sort()).toEqual([...NOT_URGENT].sort());
  });

  it('gives each template key to one type only', () => {
    const keys = entries.map(([, e]) => e.templateKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('makes the test message and the account e-mail e-mail-capable, transactional, urgent and ungrouped', () => {
    for (const name of ['TEST_MESSAGE', 'ACCOUNT_EMAIL']) {
      const entry = notificationType(name);
      expect(entry.channels).toContain('email');
      expect(entry.transactional).toBe(true);
      expect(entry.groupable).toBe(false);
      expect(entry.urgent).toBe(true);
    }
  });

  it('allows no e-mail for a type that is WhatsApp only', () => {
    const entry = notificationType('SIGN_IN_CODE');
    expect(entry.channels).toEqual(['whatsapp']);
    expect(sendsEmail(entry)).toBe(false);
  });
});

describe('the e-mail channel choice', () => {
  const muted = new Set(['email']) as unknown as ReadonlySet<'email'>;

  it('sends e-mail for an e-mail type when nothing is muted, with or without a set', () => {
    const entry = notificationType('QUOTE_RECEIVED');
    expect(sendsEmail(entry)).toBe(true);
    expect(sendsEmail(entry, new Set())).toBe(true);
  });

  it('does not send e-mail for an ordinary type when e-mail is muted', () => {
    expect(sendsEmail(notificationType('QUOTE_RECEIVED'), muted)).toBe(false);
  });

  it('sends an always-sent type even when every channel is muted', () => {
    const all = new Set(CHANNELS) as unknown as ReadonlySet<'email'>;
    expect(sendsEmail(notificationType('VERIFICATION_RESULT'), all)).toBe(true);
  });

  it('does not invent e-mail for an always-sent type that disallows it', () => {
    const entries = Object.values(NOTIFICATION_TYPES).filter(
      (e) => e.alwaysSent && !e.channels.includes('email'),
    );
    for (const entry of entries) expect(sendsEmail(entry)).toBe(false);
  });

  it('ignores a muted channel other than e-mail', () => {
    const others = new Set(['push', 'sms']) as unknown as ReadonlySet<'email'>;
    expect(sendsEmail(notificationType('QUOTE_RECEIVED'), others)).toBe(true);
  });

  it('does not let the account e-mail be muted', () => {
    expect(sendsEmail(notificationType('ACCOUNT_EMAIL'), muted)).toBe(true);
  });
});
