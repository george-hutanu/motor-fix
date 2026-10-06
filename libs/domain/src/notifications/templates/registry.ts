import { EMAIL_CHECK, PASSWORD_CHANGED, PASSWORD_RESET } from './account-email';
import { DUE_ITP } from './due-itp';
import { GENERIC, GENERIC_GROUPED } from './generic';
import { NEWS } from './news';
import { PUSH_TEST } from './push-test';
import { QUOTE_RECEIVED_GROUPED } from './quote-received';
import {
  STAFF_INVITE_MECHANIC,
  STAFF_INVITE_RECEPTIONIST,
  STAFF_JOINED,
} from './staff';
import { TEST_MESSAGE } from './test-message';
import type { Registry } from '../templates';

// Keyed by notification type, or `<type>.<variant>`; GENERIC fills in for a
// type with no e-mail or bell text.
export const TEMPLATES: Registry = {
  'ACCOUNT_EMAIL.email_check': EMAIL_CHECK,
  'ACCOUNT_EMAIL.password_changed': PASSWORD_CHANGED,
  'ACCOUNT_EMAIL.password_reset': PASSWORD_RESET,
  DUE_ITP,
  GENERIC,
  'GENERIC.grouped': GENERIC_GROUPED,
  NEWS,
  PUSH_TEST,
  'QUOTE_RECEIVED.grouped': QUOTE_RECEIVED_GROUPED,
  'STAFF_INVITE.mechanic': STAFF_INVITE_MECHANIC,
  'STAFF_INVITE.receptionist': STAFF_INVITE_RECEPTIONIST,
  STAFF_JOINED,
  TEST_MESSAGE,
};
