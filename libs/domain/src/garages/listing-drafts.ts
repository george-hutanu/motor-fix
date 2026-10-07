// The numbers the listing draft lives by, in one place.
export const DRAFT_MAX_BYTES = 262_144;
export const LINKS_PER_HOUR = 5;
export const CREATE_PER_HOUR = 10;
export const REMIND_AFTER_DAYS = 3;
// The retention still to be confirmed by the lawyer; nothing else names it.
export const DELETE_AFTER_DAYS = 90;

export const continueLink = (
  webUrl: string,
  language: 'ro' | 'en',
  token: string,
) => `${webUrl}/${language}/list-your-garage?draft=${token}`;
