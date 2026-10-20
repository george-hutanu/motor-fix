import {
  EMAIL_CHANGE_NOTICE,
  EMAIL_CHECK,
  PASSWORD_CHANGED,
  PASSWORD_RESET,
} from './account-email';
import { ADMIN_CATALOGUE_JOB_PENDING } from './admin-catalogue-job-pending';
import { ADMIN_GARAGE_REPORTED } from './admin-garage-reported';
import {
  ADMIN_OUTAGE_ALERT_BACK,
  ADMIN_OUTAGE_ALERT_DOWN,
} from './admin-outage-alert';
import { ADMIN_RULE_APPROVAL_NEEDED } from './admin-rule';
import { ADMIN_VERIFICATION_QUEUED } from './admin-verification-queued';
import { DUE_ITP } from './due-itp';
import {
  GARAGE_REPORT_CONFIRMED,
  GARAGE_REPORT_UNFOUNDED,
} from './garage-report-decided';
import { GARAGE_SUSPENDED } from './garage-suspended';
import { GENERIC, GENERIC_GROUPED } from './generic';
import { LISTING_CONTINUE_LINK, LISTING_REMINDER } from './listing';
import { NEWS } from './news';
import { PHONE_CHANGE_CODE } from './phone-change-code';
import { PUSH_TEST } from './push-test';
import { QUOTE_ACCEPTED } from './quote-accepted';
import { QUOTE_RECEIVED, QUOTE_RECEIVED_GROUPED } from './quote-received';
import { REQUEST_DECLINED } from './request-declined';
import { REQUEST_RECEIVED } from './request-received';
import { SIGN_IN_CODE } from './sign-in-code';
import {
  STAFF_INVITE_MECHANIC,
  STAFF_INVITE_RECEPTIONIST,
  STAFF_JOINED,
} from './staff';
import { SUPPORT_ACKNOWLEDGEMENT, SUPPORT_MESSAGE } from './support';
import { TEST_MESSAGE } from './test-message';
import {
  VERIFICATION_APPROVED,
  VERIFICATION_MORE_REQUESTED,
  VERIFICATION_REJECTED,
} from './verification-result';
import type { Registry } from '../templates';

// Keyed by notification type, or `<type>.<variant>`; GENERIC fills in for a
// type with no e-mail or bell text.
export const TEMPLATES: Registry = {
  'ACCOUNT_EMAIL.email_change_notice': EMAIL_CHANGE_NOTICE,
  'ACCOUNT_EMAIL.email_check': EMAIL_CHECK,
  'ACCOUNT_EMAIL.password_changed': PASSWORD_CHANGED,
  'ACCOUNT_EMAIL.password_reset': PASSWORD_RESET,
  ADMIN_CATALOGUE_JOB_PENDING,
  ADMIN_GARAGE_REPORTED,
  'ADMIN_OUTAGE_ALERT.back': ADMIN_OUTAGE_ALERT_BACK,
  'ADMIN_OUTAGE_ALERT.down': ADMIN_OUTAGE_ALERT_DOWN,
  ADMIN_RULE_APPROVAL_NEEDED,
  ADMIN_VERIFICATION_QUEUED,
  DUE_ITP,
  'GARAGE_REPORT_DECIDED.confirmed': GARAGE_REPORT_CONFIRMED,
  'GARAGE_REPORT_DECIDED.unfounded': GARAGE_REPORT_UNFOUNDED,
  GARAGE_SUSPENDED,
  GENERIC,
  'GENERIC.grouped': GENERIC_GROUPED,
  LISTING_CONTINUE_LINK,
  LISTING_REMINDER,
  NEWS,
  PHONE_CHANGE_CODE,
  PUSH_TEST,
  QUOTE_ACCEPTED,
  QUOTE_RECEIVED,
  'QUOTE_RECEIVED.grouped': QUOTE_RECEIVED_GROUPED,
  REQUEST_DECLINED,
  REQUEST_RECEIVED,
  SIGN_IN_CODE,
  'STAFF_INVITE.mechanic': STAFF_INVITE_MECHANIC,
  'STAFF_INVITE.receptionist': STAFF_INVITE_RECEPTIONIST,
  STAFF_JOINED,
  SUPPORT_ACKNOWLEDGEMENT,
  SUPPORT_MESSAGE,
  TEST_MESSAGE,
  'VERIFICATION_RESULT.approved': VERIFICATION_APPROVED,
  'VERIFICATION_RESULT.more_requested': VERIFICATION_MORE_REQUESTED,
  'VERIFICATION_RESULT.rejected': VERIFICATION_REJECTED,
};
