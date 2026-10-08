import type { AdminAccountDto } from '@motor-fix/data-access';
import {
  calendarNames,
  formatDay,
  formatNum,
  type I18n,
  type Language,
} from '@motor-fix/i18n';

export interface AccountRow {
  detail: string;
  lamp: 'green' | 'red';
  state: string;
  count: string;
}

const monthParts = new Intl.DateTimeFormat('en-GB', {
  month: 'numeric',
  timeZone: 'Europe/Bucharest',
  year: 'numeric',
});

// "martie 2026": the month the account began, as Bucharest reads it.
function month(iso: string, language: Language) {
  const { month, year } = Object.fromEntries(
    monthParts.formatToParts(new Date(iso)).map((p) => [p.type, p.value]),
  );
  return `${calendarNames(language).months[Number(month) - 1]} ${year}`;
}

// The texts of one row of the recent accounts, in the language now shown.
export function accountRow(item: AdminAccountDto, i18n: I18n): AccountRow {
  const language = i18n.language();
  const t = (key: string, params?: Record<string, string | number>) =>
    i18n.t(`admin.users.${key}`, params);
  const plural = (key: string, value: number) =>
    t(key, { count: value, n: formatNum(value, language) });

  const roles = item.roles.map((role) => t(`roles.${role}`)).join(' + ');
  const after =
    item.roles[0] === 'driver' && item.roles.length === 1
      ? item.carsCount === 0
        ? t('cars.none')
        : plural('cars.count', item.carsCount)
      : item.garageName;

  const word = t(`state.${item.status}`);
  const when =
    item.since === null
      ? null
      : item.status === 'active'
        ? month(item.since, language)
        : formatDay(item.since, language);

  return {
    count: plural(`count.${item.count.kind}`, item.count.value),
    detail: after ? `${roles} · ${after}` : roles,
    lamp: item.status === 'active' ? 'green' : 'red',
    state: when === null ? word : t('state.since', { state: word, when }),
  };
}
