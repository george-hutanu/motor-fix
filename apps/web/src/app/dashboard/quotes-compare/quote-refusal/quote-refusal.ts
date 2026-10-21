import type { I18n } from '@motor-fix/i18n';
import { toProblem } from '@motor-fix/overlays';

const KEYS = 'driver.quotes.problem';

// What an accept or a decline that failed tells the driver: no answer at
// all is the network, and the call may be sent again; a refusal is said in
// the server's words, already in the driver's language; a quote gone is
// said here; anything else is a plain failure.
export function quoteRefusal(
  i18n: Pick<I18n, 't'>,
  error: unknown,
): { network: boolean; text: string } {
  const { detail, status } = toProblem(error);
  if (status === 0) return { network: true, text: i18n.t(`${KEYS}.network`) };
  const text =
    status === 409 && detail
      ? detail
      : i18n.t(`${KEYS}.${status === 404 ? 'not_found' : 'error'}`);
  return { network: false, text };
}
