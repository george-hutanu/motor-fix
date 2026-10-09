import type {
  OAuthCompleteDto,
  OAuthPendingDto,
  OAuthProvider,
  ProvidersDto,
} from '@motor-fix/contracts';
import {
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Redis } from 'ioredis';

import {
  appleClientSecret,
  authorizationUrl,
  OpenIdClient,
  OpenIdError,
  type Person,
  pkce,
  randomToken,
  verifyIdToken,
} from './openid/openid';
import type { ProviderSettings } from './providers';
import { AUDIT_PORT, type AuditPort } from '../../audit/audit.port';
import { Prisma, type PrismaClient } from '../../generated/prisma/client';
import { countSignIn } from '../../metrics/product-counters';
import { AccountsService } from '../accounts.service';
import { AUTH_OPTIONS, type AuthOptions } from '../actor.guard';
import { AUTH_REDIS } from '../attempts';
import type { Role } from '../capabilities';
import { consentRequired, isCurrentConsent } from '../consent';
import { MAINTENANCE, type Maintenance } from '../maintenance';
import { roleInUse } from '../policy';
import { PRISMA } from '../prisma';
import { type Issued, SignInService } from '../sign-in.service';
import { refusal } from '../sign-up.service';

// What the web's return page shows.
export type Result =
  | 'signed-in'
  | 'consent'
  | 'cancelled'
  | 'failed'
  | 'maintenance'
  | 'suspended'
  | 'email_taken';

export interface Outcome {
  language: 'ro' | 'en';
  result: Result;
  issued?: Issued;
  // The new person's pending sign-up, for the browser's cookie.
  pending?: string;
}

interface Flow {
  provider: OAuthProvider;
  verifier: string;
  nonce: string;
  language: 'ro' | 'en';
  remember: boolean;
}

interface Pending extends Person {
  provider: OAuthProvider;
  name: string;
  remember: boolean;
}

// A flow and a pending sign-up each live this long, in seconds.
export const FLOW_TTL_S = 600;
const TOKEN = /^[\w-]{43}$/;
const CANCELS = new Set(['access_denied', 'user_cancelled_authorize']);
const NAME_MAX = 80;

const flowKey = (state: string) => `auth:oauth:flow:${state}`;
const pendingKey = (token: string) => `auth:oauth:pending:${token}`;

const providerFailed = () =>
  refusal(
    HttpStatus.BAD_REQUEST,
    'provider_failed',
    'The sign-in with the provider has expired; start again',
  );

const taken = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  error.code === 'P2002';

const reasonOf = (failure: unknown) =>
  failure instanceof OpenIdError
    ? failure.message
    : `unexpected ${failure instanceof Error ? failure.name : 'error'}`;

// Apple sends the name once, on the first approval, as JSON in a form field.
function appleName(user: string | undefined): string | undefined {
  if (!user) return undefined;
  try {
    const { name } = JSON.parse(user) as {
      name?: { firstName?: unknown; lastName?: unknown };
    };
    const full = [name?.firstName, name?.lastName]
      .filter((part): part is string => typeof part === 'string')
      .join(' ')
      .trim();
    return full || undefined;
  } catch {
    return undefined;
  }
}

@Injectable()
export class OAuthService {
  private readonly logger = new Logger('OAuth');
  private readonly openId = new OpenIdClient();

  constructor(
    @Inject(AUTH_OPTIONS) private readonly options: AuthOptions,
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(AUTH_REDIS) private readonly redis: Redis,
    @Inject(MAINTENANCE) private readonly maintenance: Maintenance,
    @Inject(AUDIT_PORT) private readonly audit: AuditPort,
    private readonly accounts: AccountsService,
    private readonly signIns: SignInService,
  ) {}

  configured(): ProvidersDto {
    return {
      apple: Boolean(this.options.oauth?.apple),
      google: Boolean(this.options.oauth?.google),
    };
  }

  // The provider's authorisation address, and the state the browser keeps;
  // null when the provider cannot be reached.
  async start(
    provider: OAuthProvider,
    choice: { language: 'ro' | 'en'; remember: boolean },
  ): Promise<{ state: string; url: string } | null> {
    const settings = this.settingsOf(provider);
    if (!settings) throw new NotFoundException();
    try {
      return await this.begin(settings, choice);
    } catch (failure) {
      this.logger.warn(`${provider} start failed: ${reasonOf(failure)}`);
      return null;
    }
  }

  private async begin(
    settings: ProviderSettings,
    choice: { language: 'ro' | 'en'; remember: boolean },
  ): Promise<{ state: string; url: string }> {
    const { authorizationEndpoint } = await this.openId.discover(
      settings.issuer,
    );
    const { challenge, verifier } = pkce();
    const state = randomToken();
    const nonce = randomToken();
    const flow: Flow = {
      ...choice,
      nonce,
      provider: settings.provider,
      verifier,
    };
    await this.redis.set(
      flowKey(state),
      JSON.stringify(flow),
      'EX',
      FLOW_TTL_S,
    );
    return {
      state,
      url: authorizationUrl(settings.provider, {
        challenge,
        clientId: settings.clientId,
        endpoint: authorizationEndpoint,
        nonce,
        redirectUri: settings.redirectUri,
        state,
      }),
    };
  }

  // The provider's return, whatever it holds: never throws.
  async finish(
    provider: OAuthProvider,
    flowCookie: string | undefined,
    fields: Record<string, unknown>,
  ): Promise<Outcome> {
    const field = (name: string) =>
      typeof fields[name] === 'string' ? (fields[name] as string) : undefined;
    let language: Outcome['language'] = 'ro';
    try {
      const flow = await this.takeFlow(provider, flowCookie, field('state'));
      if (!flow) {
        this.logger.warn(`${provider} return refused: no matching flow`);
        return { language, result: 'failed' };
      }
      language = flow.language;
      const error = field('error');
      if (error) return { language, result: this.refused(provider, error) };
      const person = await this.person(provider, flow, field('code'));
      return {
        language,
        ...(await this.signInOrKeep(provider, flow, person, field('user'))),
      };
    } catch (failure) {
      this.logger.warn(`${provider} return failed: ${reasonOf(failure)}`);
      return { language, result: 'failed' };
    }
  }

  private refused(provider: OAuthProvider, error: string): Result {
    const cancelled = CANCELS.has(error);
    this.logger.warn(
      `${provider} return: ${cancelled ? 'cancelled' : 'provider refused'}`,
    );
    return cancelled ? 'cancelled' : 'failed';
  }

  async pending(token: string | undefined): Promise<OAuthPendingDto> {
    const raw =
      token && TOKEN.test(token)
        ? await this.redis.get(pendingKey(token))
        : null;
    if (!raw) throw new NotFoundException();
    const { email, name, provider } = JSON.parse(raw) as Pending;
    return { name, provider, ...(email && { email }) };
  }

  // The new person's account, once they accepted the terms.
  async complete(
    token: string | undefined,
    input: OAuthCompleteDto,
  ): Promise<Issued> {
    if (await this.maintenance.on()) {
      throw refusal(
        HttpStatus.SERVICE_UNAVAILABLE,
        'maintenance',
        'MotorFix is down for maintenance',
      );
    }
    if (!isCurrentConsent(input.consent)) throw consentRequired();
    const raw =
      token && TOKEN.test(token)
        ? await this.redis.getdel(pendingKey(token))
        : null;
    if (!raw) throw providerFailed();
    const pending = JSON.parse(raw) as Pending;
    let id: string;
    try {
      ({ id } = await this.accounts.createAccount({
        consent: input.consent,
        email: pending.email,
        emailVerified: pending.emailVerified,
        identity: { method: pending.provider, subject: pending.subject },
        language: input.language,
        name: input.name.trim(),
        roles: ['driver'],
      }));
    } catch (error) {
      if (!taken(error)) throw error;
      throw refusal(
        HttpStatus.CONFLICT,
        'email_taken',
        'An account with this e-mail already exists',
      );
    }
    this.logger.log(`account created: driver, ${pending.provider}`);
    return this.signIns.openSession(id, 'driver', pending.remember);
  }

  private settingsOf(provider: OAuthProvider): ProviderSettings | undefined {
    return this.options.oauth?.[provider];
  }

  // The stored flow the browser's cookie and the returned state both name,
  // used up whatever happens next.
  private async takeFlow(
    provider: OAuthProvider,
    cookie: string | undefined,
    state: string | undefined,
  ): Promise<Flow | null> {
    if (!state || !TOKEN.test(state) || cookie !== state) return null;
    const raw = await this.redis.getdel(flowKey(state));
    if (!raw) return null;
    const flow = JSON.parse(raw) as Flow;
    return flow.provider === provider ? flow : null;
  }

  private async person(
    provider: OAuthProvider,
    flow: Flow,
    code: string | undefined,
  ): Promise<Person> {
    const settings = this.settingsOf(provider);
    if (!settings) throw new OpenIdError('provider not configured');
    if (!code) throw new OpenIdError('no code');
    const clientSecret = settings.apple
      ? appleClientSecret({
          ...settings.apple,
          audience: settings.issuer,
          clientId: settings.clientId,
          now: Date.now(),
        })
      : (settings.clientSecret ?? '');
    const idToken = await this.openId.exchange(settings.issuer, {
      client_id: settings.clientId,
      client_secret: clientSecret,
      code,
      code_verifier: flow.verifier,
      grant_type: 'authorization_code',
      redirect_uri: settings.redirectUri,
    });
    const check = (keys: Awaited<ReturnType<OpenIdClient['keys']>>) =>
      verifyIdToken(idToken, {
        audience: settings.clientId,
        issuers: settings.issuers,
        keys,
        nonce: flow.nonce,
        now: Date.now(),
      });
    try {
      return check(await this.openId.keys(settings.issuer));
    } catch (error) {
      if (
        !(error instanceof OpenIdError) ||
        error.message !== 'unknown signing key'
      ) {
        throw error;
      }
      return check(await this.openId.keys(settings.issuer, true));
    }
  }

  private async signInOrKeep(
    provider: OAuthProvider,
    flow: Flow,
    person: Person,
    appleUser: string | undefined,
  ): Promise<Omit<Outcome, 'language'>> {
    const match = await this.match(provider, person);
    if (match === 'email_taken') {
      this.logger.warn(
        `${provider} return refused: e-mail taken and not confirmed on both sides`,
      );
      return { result: 'email_taken' };
    }
    if (!match) return this.keep(provider, flow, person, appleUser);
    const { account, link } = match;
    if (account.status !== 'active') {
      this.logger.warn(`${provider} return refused: account ${account.status}`);
      return {
        result: account.status === 'suspended' ? 'suspended' : 'failed',
      };
    }
    const roles = account.roles.map((r) => r.role as Role);
    const role = roleInUse(null, account.lastRole as Role, roles);
    if (!role) return { result: 'failed' };
    if (!roles.includes('admin') && (await this.maintenance.on())) {
      return { result: 'maintenance' };
    }
    if (link) await this.link(account.id, role, provider, person.subject);
    const issued = await this.signIns.openSession(
      account.id,
      role,
      flow.remember,
    );
    countSignIn(provider);
    return { issued, result: 'signed-in' };
  }

  // The account of the provider identity, else the one holding the e-mail the
  // provider vouches for, to be linked: only when that account confirmed the
  // e-mail too, so nobody can register someone else's address and wait.
  private async match(provider: OAuthProvider, person: Person) {
    const include = { roles: true } as const;
    const byIdentity = await this.prisma.accountIdentity.findUnique({
      include: { account: { include } },
      where: { method_subject: { method: provider, subject: person.subject } },
    });
    if (byIdentity) return { account: byIdentity.account, link: false };
    const email = person.email?.trim().toLowerCase();
    const account = email
      ? await this.prisma.account.findUnique({ include, where: { email } })
      : null;
    if (!account) return null;
    return person.emailVerified && account.emailVerifiedAt
      ? { account, link: true }
      : 'email_taken';
  }

  // One transaction: the identity and the audit entry. A return racing this
  // one may have linked the same identity first: then there is nothing to do.
  private async link(
    accountId: string,
    role: Role,
    method: OAuthProvider,
    subject: string,
  ) {
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.accountIdentity.create({
          data: { accountId, method, subject },
        });
        await this.audit.record(tx, {
          action: 'create',
          actorId: accountId,
          actorRole: role,
          field: 'identity',
          newValue: method,
          subjectId: accountId,
          subjectType: 'account',
        });
      });
    } catch (error) {
      if (!taken(error)) throw error;
      return;
    }
    this.logger.log(`${method} linked to an account`);
  }

  private async keep(
    provider: OAuthProvider,
    flow: Flow,
    person: Person,
    appleUser: string | undefined,
  ): Promise<Omit<Outcome, 'language'>> {
    if (await this.maintenance.on()) return { result: 'maintenance' };
    // Cut by characters, never inside an emoji's surrogate pair.
    const name = Array.from(appleName(appleUser) ?? person.name ?? '')
      .slice(0, NAME_MAX)
      .join('');
    const pending: Pending = {
      ...person,
      email: person.email?.trim().toLowerCase(),
      name,
      provider,
      remember: flow.remember,
    };
    const token = randomToken();
    await this.redis.set(
      pendingKey(token),
      JSON.stringify(pending),
      'EX',
      FLOW_TTL_S,
    );
    return { pending: token, result: 'consent' };
  }
}
