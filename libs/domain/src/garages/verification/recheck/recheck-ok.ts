import type { RecheckRecordedDto } from '@motor-fix/contracts';
import { HttpException, HttpStatus } from '@nestjs/common';

import type { AuditPort } from '../../../audit/audit.port';
import type { Actor } from '../../../auth/policy';
import type { EventPort } from '../../../events/event.port';
import type { Prisma } from '../../../generated/prisma/client';

// What records a valid RAR look-up: the re-check list's own answer and the
// restore's inline re-check share it, so both apply the same rules.

export type Language = 'ro' | 'en';

export const languageOf = (value: string | null | undefined): Language =>
  value === 'en' ? 'en' : 'ro';

// The dialog marks the control the refusal names.
export const invalid = (code: string, field: string, message: string) =>
  new HttpException({ code, field, message }, HttpStatus.UNPROCESSABLE_ENTITY);

export const OK_SAID = {
  activitiesEmpty: {
    en: 'Tick at least one activity; an authorisation that covers nothing is recorded as failed',
    ro: 'Bifează cel puțin o activitate; o autorizație care nu acoperă nimic se înregistrează ca eșuată',
  },
  activitiesWider: {
    en: 'A wider authorisation is recorded through a change of details',
    ro: 'O autorizație mai largă se înregistrează printr-o modificare a datelor',
  },
  activityUnknown: {
    en: 'Unknown RAR activity',
    ro: 'Activitate RAR necunoscută',
  },
  date: {
    en: 'The date checked must be after the last check and no later than today',
    ro: 'Data verificării trebuie să fie după ultima verificare și cel mult azi',
  },
} satisfies Record<string, Record<Language, string>>;

export interface Locked {
  language: string;
  status: string;
  lastCheckedOn: string | null;
  activities: string[];
}

interface Ports {
  audit: AuditPort;
  events: EventPort;
}

// A look-up is dated after the last check and no later than today.
export function checkedOnRule(
  checkedOn: string,
  lastCheckedOn: string | null,
  today: string,
  language: Language,
) {
  if (
    checkedOn > today ||
    (lastCheckedOn !== null && checkedOn <= lastCheckedOn)
  ) {
    throw invalid('recheck_date_invalid', 'checkedOn', OK_SAID.date[language]);
  }
}

// Writes the valid re-check: its row, the garage's date and activities, the
// history entry and the events, after refusing an unknown or wider set.
export async function recordOk(
  tx: Prisma.TransactionClient,
  { audit, events }: Ports,
  actor: Actor,
  garageId: string,
  garage: Locked,
  look: { checkedOn: string; activities: string[] },
  language: Language,
): Promise<RecheckRecordedDto> {
  const after = [...new Set(look.activities)];
  const known = await tx.rarActivity.count({
    where: { code: { in: after } },
  });
  if (known !== after.length) {
    throw invalid(
      'recheck_activity_unknown',
      'activities',
      OK_SAID.activityUnknown[language],
    );
  }
  if (after.some((code) => !garage.activities.includes(code))) {
    throw invalid(
      'recheck_activities_wider',
      'activities',
      OK_SAID.activitiesWider[language],
    );
  }

  const row = await tx.recheck.create({
    data: {
      checkedOn: new Date(look.checkedOn),
      garageId,
      rarActivities: after,
      recordedBy: actor.accountId,
      result: 'ok',
    },
  });
  await tx.garage.update({
    data: { lastCheckedOn: new Date(look.checkedOn), rarActivities: after },
    where: { id: garageId },
  });
  await audit.record(tx, {
    action: 'update',
    actorId: actor.accountId,
    actorRole: actor.role,
    field: 'last_checked_on',
    garageId,
    kind: 'recheck_recorded',
    newValue: {
      activities: after,
      checkedOn: look.checkedOn,
      result: 'ok',
    },
    oldValue: {
      activities: garage.activities,
      checkedOn: garage.lastCheckedOn,
    },
    subjectId: garageId,
    subjectType: 'garage',
  });
  await events.record(tx, {
    audience: { garageId, published: true, type: 'verification' },
    kind: 'recheck.recorded',
    payload: { garageId, result: 'ok' },
    subjectId: garageId,
  });
  // The price list hides the jobs a narrower set no longer covers on its
  // own reads; its readers only need telling.
  if (after.length < garage.activities.length) {
    await events.record(tx, {
      audience: { garageId, results: false, type: 'public_garage' },
      kind: 'price_list.updated',
      payload: {},
      subjectId: garageId,
    });
  }
  return {
    checkedOn: look.checkedOn,
    garageId,
    id: row.id,
    lastCheckedOn: look.checkedOn,
    result: 'ok',
    status: 'approved',
  };
}
