import type { I18n } from '@motor-fix/i18n';

// What a cancel dialog toasts for a refusal that ends it: the dialog's own
// text for the problem's code, else the shared form's, else nothing (the
// caller falls back to the server's detail).
export function refusalText(
  i18n: Pick<I18n, 't'>,
  messages: string,
  code: string,
): string | undefined {
  for (const key of [
    `${messages}.problem.${code}`,
    `shell.form.problem.${code}`,
  ]) {
    const text = i18n.t(key);
    if (text !== key) return text;
  }
  return undefined;
}
