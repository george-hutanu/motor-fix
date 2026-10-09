import type { PhoneSignInDto } from '@motor-fix/contracts';
import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';

import {
  CODE_ATTEMPTS,
  CODE_TTL_MS,
  type CodeCheck,
  checkCode,
  codeHash,
  newCode,
} from './phone-sign-in';
import type { Prisma, PrismaClient } from '../../generated/prisma/client';
import { countSignIn } from '../../metrics/product-counters';
import { type Brevo, BrevoError } from '../../notifications/brevo/brevo';
import {
  PHONE_CONFIG,
  type PhoneConfig,
  phoneBlockedReason,
} from '../../notifications/phone-config';
import { render } from '../../notifications/templates';
import { AccountsService } from '../accounts.service';
import { AUTH_OPTIONS, type AuthOptions } from '../actor.guard';
import { Attempts } from '../attempts';
import { consentRequired, isCurrentConsent } from '../consent';
import { MAINTENANCE, type Maintenance } from '../maintenance';
import { roleInUse } from '../policy';
import { PRISMA } from '../prisma';
import { type Issued, SignInService } from '../sign-in.service';
import { refusal, taken } from '../sign-up.service';

export const PHONE_BREVO = Symbol('PHONE_BREVO');

const REFUSALS: Record<
  Exclude<CodeCheck, 'right'>,
  [HttpStatus, string, string]
> = {
  code_expired: [HttpStatus.GONE, 'code_expired', 'The code has expired'],
  code_invalid: [HttpStatus.UNAUTHORIZED, 'code_invalid', 'Wrong code'],
  too_many_attempts: [
    HttpStatus.TOO_MANY_REQUESTS,
    'too_many_attempts',
    'Too many wrong codes; ask for a new one',
  ],
  wrong: [HttpStatus.UNAUTHORIZED, 'code_invalid', 'Wrong code'],
};

const maintenance = () =>
  refusal(
    HttpStatus.SERVICE_UNAVAILABLE,
    'maintenance',
    'MotorFix is down for maintenance',
  );

// Why a code was not sent, for the log: never the number.
function failureKind(error: unknown): string {
  return error instanceof BrevoError ? error.reason : 'provider_error';
}

// Sign-in with a code sent by WhatsApp. Neither the number nor the code is
// ever logged.
@Injectable()
export class PhoneSignInService {
  private readonly logger = new Logger('PhoneSignIn');

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(AUTH_OPTIONS) private readonly options: AuthOptions,
    @Inject(PHONE_BREVO) private readonly brevo: Brevo,
    @Inject(PHONE_CONFIG) private readonly phone: PhoneConfig,
    @Inject(MAINTENANCE) private readonly maintenance: Maintenance,
    private readonly accounts: AccountsService,
    private readonly attempts: Attempts,
    private readonly sessions: SignInService,
  ) {}

  async issue(phone: string, language: 'ro' | 'en', address: string) {
    if ((await this.maintenance.on()) && !(await this.holder(phone))?.admin) {
      this.logger.warn('phone code refused: maintenance');
      throw maintenance();
    }
    if (!(await this.attempts.admitPhoneCode(phone, address))) {
      this.logger.warn('phone code refused: too_many_attempts');
      throw refusal(
        HttpStatus.TOO_MANY_REQUESTS,
        'too_many_attempts',
        'Too many codes asked for; try again later',
      );
    }
    const code = newCode();
    try {
      await this.send(phone, language, code);
    } catch (error) {
      // A code that never left does not use up the number's hourly share.
      await this.attempts.uncountPhoneCode(phone);
      throw error;
    }
    const createdAt = new Date();
    const live = {
      attempts: 0,
      codeHash: codeHash(code, this.options.tokenSecret),
      createdAt,
      expiresAt: new Date(createdAt.getTime() + CODE_TTL_MS),
      usedAt: null,
    };
    await this.prisma.signInCode.upsert({
      create: { phone, ...live },
      update: live,
      where: { phone },
    });
  }

  // A session, or 'profile' when the right code meets a number no account
  // holds and the body carries no name and consent to create one.
  async signIn(body: PhoneSignInDto): Promise<Issued | 'profile'> {
    const { phone } = body;
    const row = await this.rightCode(phone, body.code);
    const spend = (db: Prisma.TransactionClient) =>
      this.claim(db, phone, row.codeHash);
    const found = await this.holder(phone);
    if (!found) {
      if (await this.maintenance.on()) {
        await spend(this.prisma);
        throw this.underMaintenance();
      }
      if (body.name === undefined || body.consent === undefined) {
        return 'profile';
      }
      return this.create(body, spend);
    }
    await spend(this.prisma);
    return this.open(found, body.remember ?? true);
  }

  // A session for the account holding the number, its code already spent.
  private async open(
    found: NonNullable<Awaited<ReturnType<PhoneSignInService['holder']>>>,
    remember: boolean,
  ) {
    if (!found.role) throw this.phoneTaken();
    if (found.suspended) {
      this.logger.warn('phone sign-in refused: account_suspended');
      throw refusal(
        HttpStatus.FORBIDDEN,
        'account_suspended',
        'This account is suspended',
      );
    }
    if (!found.admin && (await this.maintenance.on())) {
      throw this.underMaintenance();
    }
    const issued = await this.sessions.openSession(
      found.id,
      found.role,
      remember,
    );
    countSignIn('phone');
    return issued;
  }

  // The number's current code when `code` is it; otherwise the refusal, a
  // wrong code counting one attempt and saying how many are left.
  private async rightCode(phone: string, code: string) {
    const row = await this.prisma.signInCode.findUnique({ where: { phone } });
    if (!row) throw this.refused('code_invalid');
    const check = checkCode(row, code, this.options.tokenSecret, new Date());
    if (check === 'right') return row;
    if (check !== 'wrong') throw this.refused(check);
    await this.prisma.signInCode.updateMany({
      data: { attempts: { increment: 1 } },
      where: { codeHash: row.codeHash, phone, usedAt: null },
    });
    throw this.refused(check, Math.max(0, CODE_ATTEMPTS - row.attempts - 1));
  }

  private async create(
    body: PhoneSignInDto,
    spend: (db: Prisma.TransactionClient) => Promise<void>,
  ): Promise<Issued> {
    if (!isCurrentConsent(body.consent)) {
      this.logger.warn('phone sign-in refused: consent_required');
      throw consentRequired();
    }
    let id: string;
    try {
      ({ id } = await this.accounts.createAccount(
        {
          consent: body.consent,
          identity: { method: 'whatsapp_phone', subject: body.phone },
          language: body.language ?? 'ro',
          name: body.name ?? '',
          phone: body.phone,
          roles: ['driver'],
        },
        spend,
      ));
    } catch (error) {
      if (taken(error)) throw this.phoneTaken();
      throw error;
    }
    this.logger.log('account created: driver, whatsapp_phone');
    return this.sessions.openSession(id, 'driver', body.remember ?? true);
  }

  // Only one request spends a code: the others find it used.
  private async claim(
    db: Prisma.TransactionClient,
    phone: string,
    codeHash: string,
  ) {
    const { count } = await db.signInCode.updateMany({
      data: { usedAt: new Date() },
      where: {
        attempts: { lt: CODE_ATTEMPTS },
        codeHash,
        expiresAt: { gt: new Date() },
        phone,
        usedAt: null,
      },
    });
    if (count === 0) throw this.refused('code_invalid');
  }

  private async send(phone: string, language: 'ro' | 'en', code: string) {
    const message = render('SIGN_IN_CODE', 'whatsapp', language, {
      code,
      minutes: CODE_TTL_MS / 60_000,
    });
    const templateId = Object.hasOwn(this.phone.whatsappTemplates, message.name)
      ? this.phone.whatsappTemplates[message.name]
      : undefined;
    const kind =
      phoneBlockedReason(this.phone, phone) ??
      (templateId === undefined
        ? 'template_missing'
        : await this.brevo
            .sendWhatsApp({
              params: message.params,
              sender: this.phone.whatsappSender,
              templateId,
              to: phone,
            })
            .then(() => null, failureKind));
    if (kind === null) return;
    this.logger.error(`phone code not sent: whatsapp_failed (${kind})`);
    throw refusal(
      HttpStatus.BAD_GATEWAY,
      'whatsapp_failed',
      'The code could not be sent by WhatsApp',
    );
  }

  // The account holding the number: by its WhatsApp sign-in identity, else
  // by its phone. Its role is null when it cannot sign in with it: deleted,
  // or a phone it never verified.
  private async holder(phone: string) {
    const include = { roles: true } as const;
    const identity = await this.prisma.accountIdentity.findFirst({
      include: { account: { include } },
      where: { method: 'whatsapp_phone', subject: phone },
    });
    const account =
      identity?.account ??
      (await this.prisma.account.findUnique({ include, where: { phone } }));
    if (!account) return null;
    const usable =
      account.status !== 'deleted' &&
      (identity !== null || account.phoneVerifiedAt !== null);
    const role = usable
      ? roleInUse(
          null,
          account.lastRole,
          account.roles.map((r) => r.role),
        )
      : null;
    const roles = account.roles.map((r) => r.role);
    return {
      admin: role !== null && roles.includes('admin'),
      id: account.id,
      role,
      suspended: account.status === 'suspended',
    };
  }

  private phoneTaken() {
    this.logger.warn('phone sign-in refused: phone_taken');
    return refusal(
      HttpStatus.CONFLICT,
      'phone_taken',
      'This number belongs to an account that cannot sign in with it',
    );
  }

  private underMaintenance() {
    this.logger.warn('phone sign-in refused: maintenance');
    return maintenance();
  }

  // A wrong code also says how many tries the code has left.
  private refused(check: Exclude<CodeCheck, 'right'>, attemptsLeft?: number) {
    const [status, code, message] = REFUSALS[check];
    this.logger.warn(`phone sign-in refused: ${code}`);
    return attemptsLeft === undefined
      ? refusal(status, code, message)
      : new HttpException({ attemptsLeft, code, message }, status);
  }
}
