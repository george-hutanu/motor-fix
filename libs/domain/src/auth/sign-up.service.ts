import type { SignUpDto } from '@motor-fix/contracts';
import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';

import { AccountsService } from './accounts.service';
import { Attempts } from './attempts';
import { isCommonPassword } from './common-passwords';
import { MAINTENANCE, type Maintenance } from './maintenance';
import { hashPassword } from './password';
import { type Issued, SignInService } from './sign-in.service';
import { Prisma } from '../generated/prisma/client';

const MIN_PASSWORD = 8;
const MAX_PASSWORD = 128;

const refusal = (
  status: HttpStatus,
  code: string,
  message: string,
  errors?: { code: string; field: string }[],
) => new HttpException({ code, message, ...(errors && { errors }) }, status);

// Counted in code points, so "8 characters" means what a person typed.
const weak = (password: string) => {
  const length = [...password].length;
  return (
    length < MIN_PASSWORD || length > MAX_PASSWORD || isCommonPassword(password)
  );
};

const taken = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  error.code === 'P2002';

// Public sign-up: a driver account with a password, signed in at once.
@Injectable()
export class SignUpService {
  private readonly logger = new Logger('SignUp');

  constructor(
    private readonly accounts: AccountsService,
    private readonly attempts: Attempts,
    private readonly signIns: SignInService,
    @Inject(MAINTENANCE) private readonly maintenance: Maintenance,
  ) {}

  async signUp(input: SignUpDto, address: string): Promise<Issued> {
    if (!(await this.attempts.admitSignUp(address))) {
      throw this.refused(
        refusal(
          HttpStatus.TOO_MANY_REQUESTS,
          'too_many_attempts',
          'Too many attempts; try again in an hour',
        ),
      );
    }
    if (await this.maintenance.on()) {
      throw this.refused(
        refusal(
          HttpStatus.SERVICE_UNAVAILABLE,
          'maintenance',
          'MotorFix is down for maintenance',
        ),
      );
    }
    if (weak(input.password)) {
      throw this.refused(
        refusal(
          HttpStatus.BAD_REQUEST,
          'weak_password',
          'Choose a password of 8 to 128 characters that is not a common one',
          [{ code: 'weak_password', field: 'password' }],
        ),
      );
    }
    const email = input.email.trim().toLowerCase();
    const passwordHash = await hashPassword(input.password);
    let id: string;
    try {
      ({ id } = await this.accounts.createAccount({
        email,
        identity: { method: 'password', passwordHash, subject: email },
        language: input.language,
        name: input.name.trim(),
        roles: ['driver'],
      }));
    } catch (error) {
      if (!taken(error)) throw error;
      throw this.refused(
        refusal(
          HttpStatus.CONFLICT,
          'email_taken',
          'An account with this e-mail already exists',
        ),
      );
    }
    this.logger.log('account created: driver, password');
    return this.signIns.openSession(id, 'driver', true);
  }

  private refused(error: HttpException) {
    const { code } = error.getResponse() as { code: string };
    this.logger.warn(`sign-up refused: ${code}`);
    return error;
  }
}
