import {
  RECHECK_DETAIL_MAX,
  RECHECK_DUE_AFTER_DAYS,
  RECHECK_MAX_AGE_DAYS,
  type RecheckDueListDto,
  type RecordRecheckDto,
} from '@motor-fix/contracts';
import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { isUUID } from 'class-validator';

import { type Actor, requireCapability } from '../../../auth/policy';
import { PRISMA } from '../../../auth/prisma';
import { refusal } from '../../../auth/sign-up.service';
import { addDays, daysBetween, localDay } from '../../../bucharest';
import { Prisma, type PrismaClient } from '../../../generated/prisma/client';

type Language = 'ro' | 'en';
type Said = Record<Language, string>;

const notFound = () =>
  refusal(HttpStatus.NOT_FOUND, 'not_found', 'No such garage');

const conflict = (code: string, message: string) =>
  refusal(HttpStatus.CONFLICT, code, message);

// The dialog marks the control the refusal names.
const invalid = (code: string, field: string, message: string) =>
  new HttpException({ code, field, message }, HttpStatus.UNPROCESSABLE_ENTITY);

const SAID = {
  activitiesEmpty: {
    en: 'Tick at least one activity; an authorisation that covers nothing is recorded as failed',
    ro: 'Bifează cel puțin o activitate; o autorizație care nu acoperă nimic se înregistrează ca eșuată',
  },
  date: {
    en: 'The date checked must be after the last check and no later than today',
    ro: 'Data verificării trebuie să fie după ultima verificare și cel mult azi',
  },
  detail: {
    en: `A failed re-check needs a detail of at most ${RECHECK_DETAIL_MAX} characters; a valid one takes none`,
    ro: `O reverificare eșuată cere un detaliu de cel mult ${RECHECK_DETAIL_MAX} de caractere; una valabilă nu are detaliu`,
  },
  notDue: {
    en: 'The garage is not due',
    ro: 'Service-ul nu e de reverificat',
  },
} satisfies Record<string, Said>;

interface Locked {
  status: string;
  lastCheckedOn: string | null;
  activities: string[];
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

// The monthly look-up of a published garage in the RAR register, done by an
// admin by hand: the list of garages due, and the record of each look-up.
@Injectable()
export class RecheckService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async due(actor: Actor): Promise<RecheckDueListDto> {
    requireCapability(actor, 'admin.garages');
    const today = localDay(new Date());
    const rows = await this.prisma.$queryRaw<
      {
        id: string;
        name: string;
        lastCheckedOn: string | null;
        activities: string[];
        rarNumber: string | null;
      }[]
    >`
      SELECT g.id::text, g.name, g.last_checked_on::text AS "lastCheckedOn",
        g.rar_activities AS activities,
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
  ): Promise<never> {
    requireCapability(actor, 'admin.garages');
    if (!isUUID(garageId)) throw notFound();
    const language = await this.languageOf(actor.accountId);
    await this.prisma.$transaction(async (tx) => {
      const [garage] = await tx.$queryRaw<Locked[]>`
        SELECT status::text AS status,
          last_checked_on::text AS "lastCheckedOn",
          rar_activities AS activities
        FROM garage WHERE id = ${garageId}::uuid
        FOR UPDATE`;
      if (!garage) throw notFound();
      const today = localDay(new Date());
      if (!isDue(garage, today)) {
        throw conflict('recheck_not_due', SAID.notDue[language]);
      }
      this.validate(body, garage, today, language);
    });
    throw refusal(
      HttpStatus.NOT_IMPLEMENTED,
      'not_implemented',
      'A re-check cannot be recorded yet',
    );
  }

  private async languageOf(accountId: string): Promise<Language> {
    const account = await this.prisma.account.findUnique({
      select: { language: true },
      where: { id: accountId },
    });
    return account?.language === 'en' ? 'en' : 'ro';
  }

  // The rules that need the locked garage, or that the story answers as 422.
  private validate(
    body: RecordRecheckDto,
    garage: Locked,
    today: string,
    language: Language,
  ) {
    if (
      body.checkedOn > today ||
      (garage.lastCheckedOn !== null && body.checkedOn <= garage.lastCheckedOn)
    ) {
      throw invalid('recheck_date_invalid', 'checkedOn', SAID.date[language]);
    }
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
        SAID.activitiesEmpty[language],
      );
    }
  }
}
