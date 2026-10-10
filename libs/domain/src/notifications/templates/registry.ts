import { EMAIL_CHECK, PASSWORD_CHANGED, PASSWORD_RESET } from './account-email';
import { ADMIN_GARAGE_REPORTED } from './admin-garage-reported';
import { ADMIN_RULE_APPROVAL_NEEDED } from './admin-rule';
import { DUE_ITP } from './due-itp';
import { GENERIC, GENERIC_GROUPED } from './generic';
import { LISTING_CONTINUE_LINK, LISTING_REMINDER } from './listing';
import { NEWS } from './news';
import { PUSH_TEST } from './push-test';
import { QUOTE_RECEIVED, QUOTE_RECEIVED_GROUPED } from './quote-received';
import { REQUEST_RECEIVED } from './request-received';
import { SIGN_IN_CODE } from './sign-in-code';
import {
  STAFF_INVITE_MECHANIC,
  STAFF_INVITE_RECEPTIONIST,
  STAFF_JOINED,
} from './staff';
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
  'ACCOUNT_EMAIL.email_check': EMAIL_CHECK,
  'ACCOUNT_EMAIL.password_changed': PASSWORD_CHANGED,
  'ACCOUNT_EMAIL.password_reset': PASSWORD_RESET,
  ADMIN_GARAGE_REPORTED,
  ADMIN_RULE_APPROVAL_NEEDED,
  DUE_ITP,
  GENERIC,
  'GENERIC.grouped': GENERIC_GROUPED,
  LISTING_CONTINUE_LINK,
  LISTING_REMINDER,
  NEWS,
  PUSH_TEST,
  QUOTE_RECEIVED,
  'QUOTE_RECEIVED.grouped': QUOTE_RECEIVED_GROUPED,
  REQUEST_RECEIVED,
  SIGN_IN_CODE,
  'STAFF_INVITE.mechanic': STAFF_INVITE_MECHANIC,
  'STAFF_INVITE.receptionist': STAFF_INVITE_RECEPTIONIST,
  STAFF_JOINED,
  TEST_MESSAGE,
  'VERIFICATION_RESULT.approved': VERIFICATION_APPROVED,
  'VERIFICATION_RESULT.more_requested': VERIFICATION_MORE_REQUESTED,
  'VERIFICATION_RESULT.rejected': VERIFICATION_REJECTED,
};
