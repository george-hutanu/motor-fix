import { HttpException, HttpStatus } from '@nestjs/common';

import type { Actor } from '../auth/policy';

type Language = NonNullable<Actor['language']>;
type Words = Record<Language, string>;

// Why a quote cannot be accepted or declined, as the driver reads it.
const QUOTE_IS: Record<string, Words> = {
  accepted: {
    en: 'The quote was already accepted',
    ro: 'Oferta a fost deja acceptată',
  },
  declined_by_driver: {
    en: 'You already declined this quote',
    ro: 'Ai refuzat deja această ofertă',
  },
  expired: { en: 'The quote has expired', ro: 'Oferta a expirat' },
  lost: {
    en: 'The quote is no longer available',
    ro: 'Oferta nu mai este disponibilă',
  },
  withdrawn: {
    en: 'The garage withdrew the quote',
    ro: 'Service‑ul a retras oferta',
  },
};

export const SUSPENDED: Words = {
  en: 'This garage no longer takes requests',
  ro: 'Service‑ul nu mai primește cereri',
};

const REQUEST_CLOSED: Words = {
  en: 'The request no longer takes quotes',
  ro: 'Cererea nu mai primește oferte',
};

export const said = (words: Words, actor: Pick<Actor, 'language'>) =>
  words[actor.language ?? 'ro'];

// A move refused, the state named for the client and worded for the driver,
// in the shape `invalidTransition` answers.
const refused = (
  entity: 'booking' | 'quote' | 'quote_request',
  currentStatus: string,
  to: string,
  message: string | undefined,
) =>
  new HttpException(
    { code: 'invalid_transition', currentStatus, entity, message, to },
    HttpStatus.CONFLICT,
  );

// A suspended garage's quote reads as withdrawn, in its own words.
export const quoteRefused = (
  actor: Pick<Actor, 'language'>,
  currentStatus: string,
  to: string,
  words: Words | undefined = QUOTE_IS[currentStatus],
) => refused('quote', currentStatus, to, words && said(words, actor));

export const requestRefused = (
  actor: Pick<Actor, 'language'>,
  currentStatus: string,
) =>
  refused(
    'quote_request',
    currentStatus,
    'booked',
    said(REQUEST_CLOSED, actor),
  );

// Why the driver can no longer cancel: the request is booked or done, or the
// booking has started, passed or ended.
const CANCEL_TOO_LATE: Record<'booking' | 'quote_request', Words> = {
  booking: {
    en: 'The booking can no longer be cancelled',
    ro: 'Programarea nu mai poate fi anulată',
  },
  quote_request: {
    en: 'The request can no longer be cancelled',
    ro: 'Cererea nu mai poate fi anulată',
  },
};

export const cancelRefused = (
  actor: Pick<Actor, 'language'>,
  entity: 'booking' | 'quote_request',
  currentStatus: string,
) =>
  refused(
    entity,
    currentStatus,
    entity === 'booking' ? 'cancelled' : 'closed',
    said(CANCEL_TOO_LATE[entity], actor),
  );
