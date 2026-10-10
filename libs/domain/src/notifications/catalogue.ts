import type {
  NotificationGroupKey as DriverGroup,
  OutsideChannel,
} from '@motor-fix/contracts';

export interface NotificationType {
  trigger: 'event' | 'timer' | 'direct';
  channels: readonly OutsideChannel[];
  alwaysSent: boolean;
  transactional: boolean;
  groupable: boolean;
  // Sent by the channels the person left on, of which at least one must stay.
  keepOne: boolean;
  urgent: boolean;
  group: DriverGroup | null;
  templateKey: string;
}

// The feature's quiet-hours rule: only these wait for 08:00.
const NOT_URGENT = new Set([
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
]);

const EPW = ['email', 'push', 'whatsapp'] as const;
const EPSW = ['email', 'push', 'sms', 'whatsapp'] as const;

type Entry = [
  NotificationType['trigger'],
  readonly OutsideChannel[],
  DriverGroup | null,
  ('always' | 'transactional' | 'single' | 'keep_one')?,
];

const ENTRIES: Record<string, Entry> = {
  ACCOUNT_EMAIL: ['direct', ['email'], null, 'transactional'],
  ADMIN_APPEAL_RECEIVED: ['event', EPW, null],
  ADMIN_CATALOGUE_JOB_PENDING: ['event', EPW, null],
  ADMIN_FACILITY_REQUEST: ['event', EPW, null],
  ADMIN_GARAGE_REPORTED: ['event', ['email', 'push'], null],
  ADMIN_OUTAGE_ALERT: ['direct', ['email', 'push'], null, 'always'],
  ADMIN_RECHECK_DUE: ['timer', EPW, null],
  ADMIN_REVIEW_REPORTED: ['event', EPW, null],
  ADMIN_RULE_APPROVAL_NEEDED: ['event', ['email', 'push'], null],
  ADMIN_STATUS_ALERT: ['event', ['email', 'push'], null, 'always'],
  ADMIN_VERIFICATION_QUEUED: ['event', EPW, null],
  ASSISTANT_APPROVAL_NEEDED: ['event', ['push'], null, 'transactional'],
  BOOKING_CANCELLED: ['event', EPW, 'bookings', 'always'],
  BOOKING_CONFIRM_REMINDER: ['timer', EPW, null, 'always'],
  BOOKING_CONFIRMED: ['event', EPW, 'bookings', 'always'],
  BOOKING_LAPSED: ['event', EPW, 'bookings', 'always'],
  BOOKING_MOVE_LAPSED: ['event', EPW, 'bookings', 'always'],
  BOOKING_MOVE_REFUSED: ['event', EPW, 'bookings', 'always'],
  BOOKING_MOVE_REQUESTED: ['event', EPW, null],
  BOOKING_MOVED: ['event', EPW, 'bookings'],
  BOOKING_REMINDER: ['timer', EPSW, 'bookings'],
  BOOKING_TIME_PROPOSED: ['event', EPW, 'bookings', 'always'],
  CAR_TRANSFER_ACCEPTED: ['event', EPW, 'reviews_history'],
  CAR_TRANSFER_LINK: ['event', ['whatsapp'], null, 'transactional'],
  CATALOGUE_JOB_DECIDED: ['event', EPW, null],
  DATA_EXPORT_READY: ['event', ['email'], null, 'transactional'],
  // The whole sheet is sent again after a change, so it is never grouped.
  DAY_SHEET: ['timer', ['whatsapp'], null, 'single'],
  DAY_SHEET_NOT_SENT: ['event', ['email'], null],
  DAY_SHEET_OUTDATED: ['event', [], null],
  DIRECT_REQUEST: ['event', EPW, null],
  DOCUMENT_DUE: ['event', EPW, null, 'keep_one'],
  DOCUMENT_OVERDUE: ['event', EPW, null, 'keep_one'],
  DUE_ITP: ['timer', EPSW, 'due_dates'],
  DUE_RCA: ['timer', EPSW, 'due_dates'],
  DUE_ROVINIETA: ['timer', EPSW, 'due_dates'],
  FACILITY_RE_ADD_DECIDED: ['event', EPW, null],
  FACILITY_REMOVED: ['event', EPW, null, 'always'],
  FINAL_PRICE_CORRECTED: ['event', EPW, 'bookings'],
  GARAGE_RESTORED: ['event', EPW, null, 'always'],
  GARAGE_SUSPENDED: ['event', EPW, null, 'always'],
  GARAGE_SUSPENDED_NOTICE: ['event', EPW, 'bookings', 'always'],
  JOB_ETA_CHANGED: ['event', EPW, 'bookings'],
  JOB_READY: ['event', EPW, 'bookings', 'always'],
  JOB_STARTED: ['event', EPW, 'bookings'],
  LISTING_CONTINUE_LINK: ['direct', ['email'], null, 'transactional'],
  LISTING_REMINDER: ['timer', ['email'], null, 'single'],
  LIVE_STARTED: ['event', EPW, 'bookings'],
  MEDIA_ADDED: ['event', EPW, 'bookings'],
  MEDIA_REMOVED: ['event', EPW, 'bookings'],
  MESSAGE_RECEIVED: ['event', EPW, 'offers'],
  NEWS: ['timer', ['email'], 'news'],
  NO_SHOW_RECORDED: ['event', EPW, 'bookings'],
  PHONE_CHANGE_CODE: ['direct', ['whatsapp'], null, 'transactional'],
  PUSH_TEST: ['direct', ['push'], null, 'transactional'],
  QUOTE_ACCEPTED: ['event', EPW, null],
  QUOTE_CHANGED: ['event', EPW, 'offers'],
  QUOTE_DECLINED_BY_DRIVER: ['event', EPW, null],
  QUOTE_EXPIRED: ['event', EPW, 'offers'],
  QUOTE_LOST: ['event', EPW, null],
  QUOTE_RECEIVED: ['event', EPW, 'offers'],
  QUOTE_WITHDRAWN: ['event', EPW, 'offers'],
  REPAIR_UPDATED: ['event', EPW, 'reviews_history'],
  REQUEST_CANCELLED: ['event', EPW, null],
  REQUEST_DECLINED: ['event', EPW, 'offers'],
  REQUEST_EXPIRED: ['event', EPW, 'offers'],
  REQUEST_RECEIVED: ['event', EPW, null],
  REQUEST_REMINDER: ['timer', EPW, null],
  REVIEW_APPEAL_DECIDED: ['event', EPW, 'reviews_history'],
  REVIEW_DECIDED: ['event', EPW, 'reviews_history'],
  REVIEW_EDITED: ['event', EPW, null],
  REVIEW_INVITE: ['timer', EPW, 'reviews_history'],
  REVIEW_POSTED: ['event', EPW, null],
  REVIEW_REPLIED: ['event', EPW, 'reviews_history'],
  SERVICE_DUE: ['timer', EPSW, 'due_dates'],
  SIGN_IN_CODE: ['direct', ['whatsapp'], null, 'transactional'],
  STAFF_INVITE: ['event', ['email', 'whatsapp'], null, 'transactional'],
  STAFF_JOINED: ['event', EPW, null],
  SUPPORT_ACKNOWLEDGEMENT: ['event', ['email'], null, 'transactional'],
  TEST_MESSAGE: ['direct', ['email', 'push'], null, 'transactional'],
  TYRES_SEASON: ['timer', EPSW, 'due_dates'],
  VERIFICATION_RESULT: ['event', EPW, null, 'always'],
};

export const NOTIFICATION_TYPES: Readonly<Record<string, NotificationType>> =
  Object.fromEntries(
    Object.entries(ENTRIES).map(([name, [trigger, channels, group, kind]]) => [
      name,
      {
        alwaysSent: kind === 'always',
        channels,
        group,
        groupable: kind === undefined && channels.length > 0,
        keepOne: kind === 'keep_one',
        templateKey: `notifications.${name.toLowerCase()}`,
        transactional: kind === 'transactional',
        trigger,
        urgent: !NOT_URGENT.has(name),
      },
    ]),
  );

export function notificationType(name: string): NotificationType {
  if (!Object.hasOwn(NOTIFICATION_TYPES, name)) {
    throw new Error(`unknown notification type ${name}`);
  }
  return NOTIFICATION_TYPES[name];
}

// `muted` is what the person switched off (preferences.ts); an always-sent or
// transactional type still goes by e-mail.
export function sendsEmail(
  type: NotificationType,
  muted: ReadonlySet<OutsideChannel> = new Set(),
): boolean {
  if (!type.channels.includes('email')) return false;
  return type.alwaysSent || type.transactional || !muted.has('email');
}
