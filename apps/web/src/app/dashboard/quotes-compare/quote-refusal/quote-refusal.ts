import { HttpErrorResponse } from '@angular/common/http';
import type { I18n } from '@motor-fix/i18n';

const KEYS = 'driver.quotes.problem';

// What an accept or a decline that failed tells the driver: no answer at
// all is the network, and the call may be sent again; a refusal is said in
// the server's words when it gives them, else by its code and the quote's
// state.
export function quoteRefusal(
  i18n: Pick<I18n, 't'>,
  error: unknown,
): { network: boolean; text: string } {
  if (!(error instanceof HttpErrorResponse) || error.status === 0) {
    return { network: true, text: i18n.t(`${KEYS}.network`) };
  }
  const body = (
    typeof error.error === 'object' && error.error !== null ? error.error : {}
  ) as { code?: string; currentStatus?: string; message?: unknown };
  if (typeof body.message === 'string' && body.message) {
    return { network: false, text: body.message };
  }
  const code = body.code ?? (error.status === 404 ? 'not_found' : 'error');
  const key =
    code === 'invalid_transition'
      ? `${KEYS}.state.${body.currentStatus}`
      : `${KEYS}.${code}`;
  const text = i18n.t(key);
  return {
    network: false,
    text: text === key ? i18n.t(`${KEYS}.error`) : text,
  };
}
