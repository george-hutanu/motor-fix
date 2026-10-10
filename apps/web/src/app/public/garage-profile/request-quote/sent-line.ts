import type { RequestDto } from '@motor-fix/data-access';
import type { I18n } from '@motor-fix/i18n';

// "Trimis către Service Auto Militari." or "Trimis către 3 service-uri."
export function sentLine(i18n: I18n, request: RequestDto) {
  const names = request.recipients.map((r) => r.garage.name);
  return names.length === 1
    ? i18n.t('public.requestQuote.sentOne', { garage: names[0] })
    : i18n.t('public.requestQuote.sentMany', { count: names.length });
}

// "Atelier Dinamo răspunde de obicei în aceeași zi.", or nothing for a
// garage the API does not say usually answers the same day.
export function answersLine(
  i18n: I18n,
  recipient: RequestDto['recipients'][number],
) {
  return recipient.answersSameDay
    ? i18n.t('public.requestQuote.answersSameDay', {
        garage: recipient.garage.name,
      })
    : null;
}
