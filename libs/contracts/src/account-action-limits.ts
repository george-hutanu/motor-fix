// What an admin's account action may hold, read by the API's checks and the
// web's account dialogs alike.
export const SUSPEND_REASON_MIN = 10;
export const ACCOUNT_NOTE_MAX = 500;
// A data request's reference: DR-<four-digit year>-<four or more digits>.
export const DATA_REQUEST_REFERENCE = /^DR-\d{4}-\d{4,}$/;
