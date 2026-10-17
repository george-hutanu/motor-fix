import { EMAIL_PATTERN } from '@motor-fix/contracts/email';
import { Logger } from '@nestjs/common';

import { realDay } from './promise/promise';

export interface SupportConfig {
  // Where the support e-mail goes; unset, it waits and the alert says so.
  email?: string;
  // The owner is away until this Bucharest day (YYYY-MM-DD).
  awayUntil?: string;
  // SUPPORT_AWAY_UNTIL was set to something that is no day, logged at each
  // send as well as at start.
  awayUnreadable?: true;
}

// Read once at boot. Neither setting is ever assumed: an unset or unreadable
// one is logged and left out.
export function supportConfig(
  source: Record<string, string | undefined>,
): SupportConfig {
  const logger = new Logger('Support');
  const config: SupportConfig = {};
  const email = source['SUPPORT_EMAIL']?.trim() ?? '';
  if (EMAIL_PATTERN.test(email)) config.email = email;
  else
    logger.error(
      'SUPPORT_EMAIL is not set to an address: support e-mails wait unsent',
    );
  const away = source['SUPPORT_AWAY_UNTIL']?.trim();
  if (away && realDay(away)) config.awayUntil = away;
  else if (away) {
    config.awayUnreadable = true;
    logger.error('SUPPORT_AWAY_UNTIL is not a YYYY-MM-DD day: read as unset');
  }
  return config;
}

export const SUPPORT_CONFIG = Symbol('SUPPORT_CONFIG');
