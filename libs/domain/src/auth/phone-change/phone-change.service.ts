import {
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { AUDIT_PORT, type AuditPort } from '../../audit/audit.port';
import { EVENT_PORT, type EventPort } from '../../events/event.port';
import { Prisma, type PrismaClient } from '../../generated/prisma/client';
import { countAccountChange } from '../../metrics/product-counters';
import type { Brevo } from '../../notifications/brevo/brevo';
import {
  PHONE_CONFIG,
  type PhoneConfig,
} from '../../notifications/phone-config';
import { AUTH_OPTIONS, type AuthOptions } from '../actor.guard';
import { Attempts } from '../attempts';
import {
  CODE_ATTEMPTS,
  CODE_TTL_MS,
  checkCode,
  codeHash,
  newCode,
} from '../phone-sign-in/phone-sign-in';
import { PHONE_BREVO } from '../phone-sign-in/phone-sign-in.service';
import { sendWhatsAppCode } from '../phone-sign-in/whatsapp-code';
import type { Actor } from '../policy';
import { PRISMA } from '../prisma';
import { refusal } from '../sign-up.service';

type Db = PrismaClient | Prisma.TransactionClient;

const tooMany = () =>
  refusal(
    HttpStatus.TOO_MANY_REQUESTS,
    'too_many_attempts',
    'Too many tries; try again later',
  );

const expired = () =>
  refusal(HttpStatus.GONE, 'code_expired', 'The code has expired');

// A new number for the account: a code goes to it by WhatsApp, and the number
// changes only once the code comes back. Neither the number nor the code is
// ever logged.
@Injectable()
export class PhoneChangeService {
  private readonly logger = new Logger('PhoneChange');

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(AUTH_OPTIONS) private readonly options: AuthOptions,
    @Inject(PHONE_BREVO) private readonly brevo: Brevo,
    @Inject(PHONE_CONFIG) private readonly phone: PhoneConfig,
    @Inject(AUDIT_PORT) private readonly audit: AuditPort,
    @Inject(EVENT_PORT) private readonly events: EventPort,
    private readonly attempts: Attempts,
  ) {}

  // Sent first, so a code that cannot leave keeps no change; a new ask
  // replaces the account's older code.
  async request(actor: Actor, phone: string): Promise<void> {
    // Not something an assistant can do for the account.
    if (actor.via === 'assistant') throw new NotFoundException();
    const { accountId } = actor;
    const account = await this.prisma.account.findUniqueOrThrow({
      select: { language: true, phone: true },
      where: { id: accountId },
    });
    if (account.phone === phone) {
      this.logger.warn('phone change refused: phone_unchanged');
      throw refusal(
        HttpStatus.CONFLICT,
        'phone_unchanged',
        'This is already the account phone number',
      );
    }
    if (await this.taken(this.prisma, phone, accountId))
      throw this.phoneTaken();
    if (!(await this.attempts.admitContactChange(accountId))) {
      this.logger.warn('phone change refused: too_many_attempts');
      throw tooMany();
    }
    const code = newCode();
    try {
      await sendWhatsAppCode(
        { brevo: this.brevo, config: this.phone, logger: this.logger },
        'PHONE_CHANGE_CODE',
        phone,
        account.language,
        code,
      );
    } catch {
      throw refusal(
        HttpStatus.SERVICE_UNAVAILABLE,
        'send_failed',
        'The code could not be sent; try again',
      );
    }
    const createdAt = new Date();
    const live = {
      attempts: 0,
      codeHash: codeHash(code, this.options.tokenSecret),
      createdAt,
      expiresAt: new Date(createdAt.getTime() + CODE_TTL_MS),
      phone,
    };
    await this.prisma.phoneChange.upsert({
      create: { accountId, ...live },
      update: live,
      where: { accountId },
    });
  }

  // The right code of the live change sets the number, confirmed now.
  async confirm(actor: Actor, code: string): Promise<void> {
    if (actor.via === 'assistant') throw new NotFoundException();
    const { accountId } = actor;
    const row = await this.prisma.phoneChange.findUnique({
      where: { accountId },
    });
    if (!row) throw this.refused(expired());
    const at = new Date();
    const check = checkCode(
      { ...row, usedAt: null },
      code,
      this.options.tokenSecret,
      at,
    );
    if (check === 'too_many_attempts') throw this.refused(tooMany());
    if (check === 'code_expired') throw this.refused(expired());
    if (check !== 'right') throw this.refused(await this.wrongTry(row));
    try {
      await this.prisma.$transaction((tx) => this.apply(tx, actor, row, at));
    } catch (error) {
      // Another account took the number between the check and the write.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw this.phoneTaken();
      }
      throw error;
    }
    countAccountChange('phone');
  }

  // A wrong code counts a try; the fifth voids the code.
  private async wrongTry(row: {
    accountId: string;
    attempts: number;
    codeHash: string;
  }) {
    await this.prisma.phoneChange.updateMany({
      data: { attempts: { increment: 1 } },
      where: { accountId: row.accountId, codeHash: row.codeHash },
    });
    return row.attempts + 1 >= CODE_ATTEMPTS
      ? tooMany()
      : refusal(HttpStatus.UNAUTHORIZED, 'code_invalid', 'Wrong code');
  }

  private async apply(
    tx: Prisma.TransactionClient,
    actor: Actor,
    row: { accountId: string; codeHash: string; phone: string },
    at: Date,
  ) {
    const { accountId, phone } = row;
    // Of two confirms at once, only the one that takes the change goes on.
    const { count } = await tx.phoneChange.deleteMany({
      where: {
        accountId,
        attempts: { lt: CODE_ATTEMPTS },
        codeHash: row.codeHash,
        expiresAt: { gt: at },
      },
    });
    if (count === 0) throw this.refused(expired());
    if (await this.taken(tx, phone, accountId)) throw this.phoneTaken();
    const before = await tx.account.findUniqueOrThrow({
      select: { phone: true },
      where: { id: accountId },
    });
    await tx.account.update({
      data: { phone, phoneVerifiedAt: at },
      where: { id: accountId },
    });
    await tx.accountIdentity.updateMany({
      data: { subject: phone },
      where: { accountId, method: 'whatsapp_phone' },
    });
    await this.audit.record(tx, {
      action: 'update',
      actorId: accountId,
      actorRole: actor.role,
      field: 'phone',
      newValue: phone,
      oldValue: before.phone,
      subjectId: accountId,
      subjectType: 'account',
    });
    await this.events.record(tx, {
      audience: { accountId, type: 'account' },
      kind: 'account.updated',
      payload: { accountId, fields: ['phone'] },
      subjectId: accountId,
    });
  }

  // Whether another account holds the number or signs in with it.
  private async taken(db: Db, phone: string, accountId: string) {
    const [holder, identity] = await Promise.all([
      db.account.findFirst({
        select: { id: true },
        where: { id: { not: accountId }, phone },
      }),
      db.accountIdentity.findFirst({
        select: { id: true },
        where: {
          accountId: { not: accountId },
          method: 'whatsapp_phone',
          subject: phone,
        },
      }),
    ]);
    return holder !== null || identity !== null;
  }

  private phoneTaken() {
    this.logger.warn('phone change refused: phone_taken');
    return refusal(
      HttpStatus.CONFLICT,
      'phone_taken',
      'Another account uses this phone number',
    );
  }

  private refused<T extends { getResponse(): unknown }>(error: T): T {
    const { code } = error.getResponse() as { code: string };
    this.logger.warn(`phone change refused: ${code}`);
    return error;
  }
}
