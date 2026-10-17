import { Logger } from '@nestjs/common';

import { awayAhead, realDay } from './promise/promise';
import { localDay } from '../bucharest';
import { supportAddress } from '../notifications/email-config';

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
// one is logged and left out. A warning, not an error: the API reads it too,
// where nothing is sent; the worker logs each unsent e-mail as an error.
// A past away date is logged here and read as unset at each send.
export function supportConfig(
  source: Record<string, string | undefined>,
  now: Date = new Date(),
): SupportConfig {
  const logger = new Logger('Support');
  const config: SupportConfig = {};
  const email = supportAddress(source);
  if (email) config.email = email;
  else
    logger.warn(
      'Neither SUPPORT_EMAIL nor EMAIL_DOMAIN is set: support e-mails wait unsent',
    );
  const away = source['SUPPORT_AWAY_UNTIL']?.trim();
  if (away && realDay(away)) {
    config.awayUntil = away;
    if (!awayAhead(away, localDay(now))) {
      logger.warn(
        `SUPPORT_AWAY_UNTIL ${away} is not after today: read as unset`,
      );
    }
  } else if (away) {
    config.awayUnreadable = true;
    logger.warn('SUPPORT_AWAY_UNTIL is not a YYYY-MM-DD day: read as unset');
  }
  return config;
}

export const SUPPORT_CONFIG = Symbol('SUPPORT_CONFIG');
