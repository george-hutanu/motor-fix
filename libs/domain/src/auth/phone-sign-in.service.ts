import type { PhoneSignInDto } from '@motor-fix/contracts';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';

import { AUTH_OPTIONS, type AuthOptions } from './actor.guard';
import { Attempts } from './attempts';
import {
  CODE_ATTEMPTS,
  CODE_TTL_MS,
  type CodeCheck,
  checkCode,
  codeHash,
  newCode,
} from './phone-sign-in';
import { roleInUse } from './policy';
import { PRISMA } from './prisma';
import { type Issued, SignInService } from './sign-in.service';
import { refusal } from './sign-up.service';
import type { PrismaClient } from '../generated/prisma/client';
import type { Brevo } from '../notifications/brevo';
import {
  PHONE_CONFIG,
  type PhoneConfig,
  phoneBlockedReason,
} from '../notifications/phone-config';
import { render } from '../notifications/templates';

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
    private readonly attempts: Attempts,
    private readonly sessions: SignInService,
  ) {}

  async issue(phone: string, language: 'ro' | 'en', address: string) {
    if (!(await this.attempts.admitPhoneCode(phone, address))) {
      this.logger.warn('phone code refused: too_many_attempts');
      throw refusal(
        HttpStatus.TOO_MANY_REQUESTS,
        'too_many_attempts',
        'Too many codes asked for; try again later',
      );
    }
    const code = newCode();
    await this.send(phone, language, code);
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

  async signIn(body: PhoneSignInDto): Promise<Issued> {
    const { phone, code } = body;
    const row = await this.prisma.signInCode.findUnique({ where: { phone } });
    const check = checkCode(row, code, this.options.tokenSecret, new Date());
    if (check === 'wrong') {
      await this.prisma.signInCode.updateMany({
        data: { attempts: { increment: 1 } },
        where: { phone, usedAt: null },
      });
    }
    if (check !== 'right') throw this.refused(check);
    if (!row) throw this.refused('code_invalid');
    const holder = await this.holder(phone);
    if (!holder) throw this.refused('code_invalid');
    const claimed = await this.prisma.signInCode.updateMany({
      data: { usedAt: new Date() },
      where: {
        attempts: { lt: CODE_ATTEMPTS },
        codeHash: row.codeHash,
        phone,
        usedAt: null,
      },
    });
    if (claimed.count === 0) throw this.refused('code_invalid');
    return this.sessions.openSession(
      holder.id,
      holder.role,
      body.remember ?? true,
    );
  }

  private async send(phone: string, language: 'ro' | 'en', code: string) {
    const message = render('SIGN_IN_CODE', 'whatsapp', language, {
      code,
      minutes: CODE_TTL_MS / 60_000,
    });
    const templateId = Object.hasOwn(this.phone.whatsappTemplates, message.name)
      ? this.phone.whatsappTemplates[message.name]
      : undefined;
    const blocked = phoneBlockedReason(this.phone, phone);
    try {
      if (blocked || templateId === undefined) throw new Error('not sendable');
      await this.brevo.sendWhatsApp({
        params: message.params,
        sender: this.phone.whatsappSender,
        templateId,
        to: phone,
      });
    } catch {
      this.logger.error('phone code not sent: whatsapp_failed');
      throw refusal(
        HttpStatus.BAD_GATEWAY,
        'whatsapp_failed',
        'The code could not be sent by WhatsApp',
      );
    }
  }

  // The account the number signs in: its WhatsApp sign-in identity first,
  // then an account that verified it.
  private async holder(phone: string) {
    const include = { roles: true } as const;
    const identity = await this.prisma.accountIdentity.findFirst({
      include: { account: { include } },
      where: { method: 'whatsapp_phone', subject: phone },
    });
    const account =
      identity?.account ??
      (await this.prisma.account.findFirst({
        include,
        where: { phone, phoneVerifiedAt: { not: null } },
      }));
    if (!account || account.status === 'deleted') return null;
    const role = roleInUse(
      null,
      account.lastRole,
      account.roles.map((r) => r.role),
    );
    return role ? { id: account.id, role } : null;
  }

  private refused(check: Exclude<CodeCheck, 'right'>) {
    const [status, code, message] = REFUSALS[check];
    this.logger.warn(`phone sign-in refused: ${code}`);
    return refusal(status, code, message);
  }
}
