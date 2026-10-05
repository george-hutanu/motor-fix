import { EMAIL_CHECK, PASSWORD_CHANGED, PASSWORD_RESET } from './account-email';
import { DUE_ITP } from './due-itp';
import { GENERIC, GENERIC_GROUPED } from './generic';
import { NEWS } from './news';
import { QUOTE_RECEIVED_GROUPED } from './quote-received';
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
  'QUOTE_RECEIVED.grouped': QUOTE_RECEIVED_GROUPED,
  TEST_MESSAGE,
};
