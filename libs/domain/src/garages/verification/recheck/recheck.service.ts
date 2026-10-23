import {
  type RarActivityNameDto,
  RECHECK_DETAIL_MAX,
  RECHECK_DUE_AFTER_DAYS,
  RECHECK_MAX_AGE_DAYS,
  type RecheckDueListDto,
  type RecheckRecordedDto,
  type RecordRecheckDto,
  SUSPENSION_REASON_MAX,
} from '@motor-fix/contracts';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { isUUID } from 'class-validator';

import {
  checkedOnRule,
  invalid,
  type Language,
  type Locked,
  languageOf,
  OK_SAID,
  recordOk,
} from './recheck-ok';
import { AUDIT_PORT, type AuditPort } from '../../../audit/audit.port';
import { type Actor, requireCapability } from '../../../auth/policy';
import { PRISMA } from '../../../auth/prisma';
import { refusal } from '../../../auth/sign-up.service';
import { addDays, daysBetween, localDay } from '../../../bucharest';
import { EVENT_PORT, type EventPort } from '../../../events/event.port';
import { Prisma, type PrismaClient } from '../../../generated/prisma/client';
import { countRecheck } from '../../../metrics/product-counters';
import { shortName } from '../../../quotes/reads';
import { SuspensionService } from '../suspension/suspension.service';

type Said = Record<Language, string>;

const notFound = () =>
  refusal(HttpStatus.NOT_FOUND, 'not_found', 'No such garage');

const conflict = (code: string, message: string) =>
  refusal(HttpStatus.CONFLICT, code, message);

const SAID = {
  detail: {
    en: `A failed re-check needs a detail of at most ${RECHECK_DETAIL_MAX} characters; a valid one takes none`,
    ro: `O reverificare eșuată cere un detaliu de cel mult ${RECHECK_DETAIL_MAX} de caractere; una valabilă nu are detaliu`,
  },
  notDue: {
    en: 'The garage is not due',
    ro: 'Service-ul nu e de reverificat',
  },
  stale: {
    en: "The garage's details changed. Reload the list.",
    ro: 'Datele service-ului s-au schimbat. Reîncarcă lista.',
  },
} satisfies Record<string, Said>;

// The suspension reason the garage's history and its owner read.
const FAILURE_WORD = {
  expired: 'expirată',
  suspended: 'suspendată',
  withdrawn: 'retrasă',
} as const;

const TIME_ZONE = 'Europe/Bucharest';
const clock = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  hourCycle: 'h23',
  minute: '2-digit',
  timeZone: TIME_ZONE,
});
const dayMonth: Record<Language, Intl.DateTimeFormat> = {
  en: new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: TIME_ZONE,
  }),
  ro: new Intl.DateTimeFormat('ro-RO', {
    day: 'numeric',
    month: 'short',
    timeZone: TIME_ZONE,
  }),
};

// "Deja reverificat de Ana P. la 10:42", with "pe 3 oct." before "la" when
// the re-check was not today's.
function alreadyChecked(
  language: Language,
  name: string,
  at: Date,
  today: string,
) {
  const time = clock.format(at);
  const day = localDay(at) === today ? null : dayMonth[language].format(at);
  return language === 'en'
    ? `Already re-checked by ${name}${day ? ` on ${day}` : ''} at ${time}`
    : `Deja reverificat de ${name}${day ? ` pe ${day}` : ''} la ${time}`;
}

const isDue = (garage: Locked, today: string) =>
  garage.status === 'approved' &&
  (garage.lastCheckedOn === null ||
    daysBetween(garage.lastCheckedOn, today) >= RECHECK_DUE_AFTER_DAYS);

// The one rule the list and the morning count read: approved, and last
// checked 28 or more Bucharest days ago, or never.
const due = (today: string) => Prisma.sql`
  g.status = 'approved'
  AND (g.last_checked_on IS NULL
    OR g.last_checked_on <= ${addDays(today, -RECHECK_DUE_AFTER_DAYS)}::date)`;

export async function countDue(prisma: PrismaClient, today: string) {
  const [row] = await prisma.$queryRaw<{ n: number }[]>`
    SELECT count(*)::int AS n FROM garage g WHERE ${due(today)}`;
  return row?.n ?? 0;
}

// The monthly look-up of a published garage in the RAR register, done by an
// admin by hand: the list of garages due, and the record of each look-up.
@Injectable()
export class RecheckService {
  private readonly logger = new Logger('Recheck');

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(AUDIT_PORT) private readonly audit: AuditPort,
    @Inject(EVENT_PORT) private readonly events: EventPort,
    private readonly suspensions: SuspensionService,
  ) {}

  async due(actor: Actor): Promise<RecheckDueListDto> {
    requireCapability(actor, 'admin.garages');
    const today = localDay(new Date());
    const rows = await this.prisma.$queryRaw<
      {
        id: string;
        name: string;
        lastCheckedOn: string | null;
        activities: string[];
        activityNames: RarActivityNameDto[];
        rarNumber: string | null;
      }[]
    >`
      SELECT g.id::text, g.name, to_char(g.last_checked_on, 'YYYY-MM-DD') AS "lastCheckedOn",
        g.rar_activities AS activities,
        (SELECT coalesce(jsonb_agg(jsonb_build_object('code', a.code,
            'nameRo', a.name_ro, 'nameEn', a.name_en)
            ORDER BY array_position(g.rar_activities, a.code)), '[]')
          FROM rar_activity a
          WHERE a.code = ANY(g.rar_activities)) AS "activityNames",
        (SELECT f.rar_number FROM verification_file f
          WHERE f.garage_id = g.id
          ORDER BY f.created_at DESC, f.id DESC LIMIT 1) AS "rarNumber"
      FROM garage g
      WHERE ${due(today)}
      ORDER BY g.last_checked_on ASC NULLS FIRST, g.name, g.id`;
    return {
      items: rows.map((row) => {
        const days =
          row.lastCheckedOn === null
            ? null
            : daysBetween(row.lastCheckedOn, today);
        return {
          activities: row.activities,
          activityNames: row.activityNames,
          daysSince: days,
          garageId: row.id,
          lastCheckedOn: row.lastCheckedOn,
          name: row.name,
          overdue: days === null || days > RECHECK_MAX_AGE_DAYS,
          rarNumber: row.rarNumber,
        };
      }),
      today,
    };
  }

  async record(
    actor: Actor,
    garageId: string,
    body: RecordRecheckDto,
  ): Promise<RecheckRecordedDto> {
    requireCapability(actor, 'admin.garages');
    if (!isUUID(garageId)) throw notFound();
    const done = await this.prisma
      .$transaction(async (tx) => {
        const [garage] = await tx.$queryRaw<Locked[]>`
          SELECT status::text AS status,
            (SELECT language::text FROM account WHERE id = ${actor.accountId}::uuid) AS language,
            to_char(last_checked_on, 'YYYY-MM-DD') AS "lastCheckedOn",
            rar_activities AS activities
          FROM garage WHERE id = ${garageId}::uuid
          FOR UPDATE`;
        if (!garage) throw notFound();
        // The admin's language rides the locked read: only a refusal uses it.
        const language = languageOf(garage.language);
        const today = localDay(new Date());
        // The moved date first, so the second of two admins learns who
        // recorded before learning that the garage is no longer due.
        if (garage.lastCheckedOn !== body.lastCheckedOn) {
          throw await this.moved(
            tx,
            garageId,
            body.lastCheckedOn,
            today,
            language,
          );
        }
        if (!isDue(garage, today)) {
          throw conflict('recheck_not_due', SAID.notDue[language]);
        }
        this.validate(body, garage, today, language);
        return body.result === 'ok'
          ? recordOk(
              tx,
              { audit: this.audit, events: this.events },
              actor,
              garageId,
              garage,
              { activities: body.activities ?? [], checkedOn: body.checkedOn },
              language,
            )
          : this.recordFailed(tx, actor, garageId, garage, body);
      })
      .catch(async (error: unknown) => {
        // A suspension refused inside the rolled-back transaction still
        // owes the history its attempt.
        throw await this.suspensions.refused(
          error,
          garageId,
          'recheck_failed',
          actor.role,
        );
      });
    if (done.result === 'failed') {
      this.suspensions.committed(garageId, 'recheck_failed', actor.role);
    }
    countRecheck(done.result);
    this.logger.log(
      `recorded garage=${garageId} result=${done.result} admin=${actor.accountId}`,
    );
    return done;
  }

  // Another admin's valid re-check moved the date: name them; otherwise the
  // date moved some other way (an approval) and the row is just stale.
  private async moved(
    tx: Prisma.TransactionClient,
    garageId: string,
    carried: string | null,
    today: string,
    language: Language,
  ) {
    const newer = await tx.recheck.findFirst({
      orderBy: { recordedAt: 'desc' },
      select: { recordedAt: true, recordedBy: true },
      where: {
        garageId,
        result: 'ok',
        ...(carried !== null && { checkedOn: { gt: new Date(carried) } }),
      },
    });
    const recorder =
      newer?.recordedBy &&
      (await tx.account.findUnique({
        select: { name: true },
        where: { id: newer.recordedBy },
      }));
    if (!newer || !recorder) {
      return conflict('recheck_stale', SAID.stale[language]);
    }
    return conflict(
      'recheck_conflict',
      alreadyChecked(
        language,
        shortName(recorder.name),
        newer.recordedAt,
        today,
      ),
    );
  }

  // The rules that need the locked garage, or that the story answers as 422.
  private validate(
    body: RecordRecheckDto,
    garage: Locked,
    today: string,
    language: Language,
  ) {
    checkedOnRule(body.checkedOn, garage.lastCheckedOn, today, language);
    const detail = body.detail ?? '';
    const detailFits =
      body.result === 'ok'
        ? body.detail === undefined
        : detail.length > 0 && [...detail].length <= RECHECK_DETAIL_MAX;
    if (!detailFits) {
      throw invalid('recheck_detail_invalid', 'detail', SAID.detail[language]);
    }
    if (body.result === 'ok' && body.activities?.length === 0) {
      throw invalid(
        'recheck_activities_empty',
        'activities',
        OK_SAID.activitiesEmpty[language],
      );
    }
  }

  // The garage leaves the map in the same transaction: the date and the
  // activities stay as the last valid check left them.
  private async recordFailed(
    tx: Prisma.TransactionClient,
    actor: Actor,
    garageId: string,
    garage: Locked,
    body: RecordRecheckDto,
  ): Promise<RecheckRecordedDto> {
    // The edge requires the failure on a failed result, validate() the detail.
    const failure = body.failure!;
    const detail = body.detail!;
    const row = await tx.recheck.create({
      data: {
        checkedOn: new Date(body.checkedOn),
        detail,
        failure,
        garageId,
        recordedBy: actor.accountId,
        result: 'failed',
      },
    });
    const reason = [...`Autorizație RAR ${FAILURE_WORD[failure]} · ${detail}`]
      .slice(0, SUSPENSION_REASON_MAX)
      .join('');
    await this.suspensions.suspendIn(
      tx,
      actor,
      garageId,
      'recheck_failed',
      reason,
    );
    await this.audit.record(tx, {
      action: 'update',
      actorId: actor.accountId,
      actorRole: actor.role,
      field: 'status',
      garageId,
      kind: 'recheck_recorded',
      newValue: { checkedOn: body.checkedOn, failure, result: 'failed' },
      oldValue: { checkedOn: garage.lastCheckedOn },
      subjectId: garageId,
      subjectType: 'garage',
      text: detail,
    });
    await this.events.record(tx, {
      audience: { garageId, published: true, type: 'verification' },
      kind: 'recheck.recorded',
      payload: { garageId, result: 'failed' },
      subjectId: garageId,
    });
    return {
      checkedOn: body.checkedOn,
      garageId,
      id: row.id,
      lastCheckedOn: garage.lastCheckedOn,
      result: 'failed',
      status: 'suspended',
    };
  }
}
