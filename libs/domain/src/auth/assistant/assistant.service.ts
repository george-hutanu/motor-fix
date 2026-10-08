import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

import { readEnv } from '@motor-fix/contracts';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { SignJWT } from 'jose';

import type { PrismaClient } from '../../generated/prisma/client';
import { AddressThrottle } from '../../rate-limit/address-throttle';
import { AUTH_OPTIONS, type AuthOptions } from '../actor.guard';
import { PRISMA } from '../prisma';
import { refusal } from '../sign-up.service';

// The identity server's client at these routes, and the web app that holds
// the connect page and names itself as the id token's issuer.
export interface AssistantBroker {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  webUrl: string;
}

export interface AssistantTokens {
  id_token: string;
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
}

const BROKER_ENV = [
  'ASSISTANT_BROKER_CLIENT_ID',
  'ASSISTANT_BROKER_CLIENT_SECRET',
  'ASSISTANT_BROKER_REDIRECT_URI',
  'PUBLIC_WEB_URL',
] as const;

// Off while no broker client is set; a partial set is a deployment error.
export function assistantBroker(
  source: Record<string, string | undefined> = process.env,
): AssistantBroker | undefined {
  if (!source['ASSISTANT_BROKER_CLIENT_ID']) return undefined;
  const env = readEnv(BROKER_ENV, source);
  return {
    clientId: env.ASSISTANT_BROKER_CLIENT_ID,
    clientSecret: env.ASSISTANT_BROKER_CLIENT_SECRET,
    redirectUri: env.ASSISTANT_BROKER_REDIRECT_URI,
    webUrl: env.PUBLIC_WEB_URL,
  };
}

export const ASSISTANT_THROTTLE = Symbol('ASSISTANT_THROTTLE');

// authorize and token per address a minute: well above what sign-ins need,
// since every token call comes from the identity server's one address.
export const assistantThrottle = (redis: Redis) =>
  new AddressThrottle(redis, {
    key: 'auth:assistant',
    limit: 120,
    name: 'AssistantSignIn',
    windowSeconds: 60,
  });

const REQUEST_TTL_S = 10 * 60;
const CODE_TTL_MS = 60_000;
const TOKEN_TTL_S = 300;
// Keeps a hand-off signature from ever matching another use of the secret.
const PURPOSE = 'assistant-sign-in-request';

interface HandOff {
  client_id: string;
  redirect_uri: string;
  state: string;
  nonce: string;
  exp: number;
}

const hmac = (data: string, secret: string) =>
  createHmac('sha256', secret).update(`${PURPOSE}.${data}`).digest('base64url');

const sha256 = (value: string) =>
  createHash('sha256').update(value).digest('hex');

// Digests first, so the comparison never depends on the given length.
const same = (given: string, expected: string) =>
  timingSafeEqual(
    createHash('sha256').update(given).digest(),
    createHash('sha256').update(expected).digest(),
  );

const text = (value: unknown) =>
  typeof value === 'string' && value.length > 0 && value.length <= 512
    ? value
    : undefined;

const invalidClient = (status: HttpStatus) =>
  refusal(status, 'invalid_client', 'The client is not the configured one');
const invalidRequest = () =>
  refusal(
    HttpStatus.BAD_REQUEST,
    'invalid_request',
    'The sign-in request is not valid',
  );
const invalidGrant = () =>
  refusal(
    HttpStatus.BAD_REQUEST,
    'invalid_grant',
    'The code is not valid; start the sign-in again',
  );

// The auth module as OpenID Connect provider for the identity server alone.
@Injectable()
export class AssistantService {
  private readonly logger = new Logger('AssistantSignIn');

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(AUTH_OPTIONS) private readonly options: AuthOptions,
  ) {}

  // The web connect page's address, carrying the signed hand-off.
  authorize(query: Record<string, unknown>, now = Date.now()): string {
    const broker = this.options.assistant;
    if (
      !broker ||
      text(query['client_id']) !== broker.clientId ||
      text(query['redirect_uri']) !== broker.redirectUri
    ) {
      this.logger.warn('authorize refused: invalid_client');
      throw invalidClient(HttpStatus.BAD_REQUEST);
    }
    if (query['response_type'] !== 'code') {
      throw refusal(
        HttpStatus.BAD_REQUEST,
        'unsupported_response_type',
        'Only the code response type is supported',
      );
    }
    const state = text(query['state']);
    const nonce = text(query['nonce']);
    if (!state || !nonce) throw invalidRequest();
    const handOff: HandOff = {
      client_id: broker.clientId,
      exp: Math.floor(now / 1000) + REQUEST_TTL_S,
      nonce,
      redirect_uri: broker.redirectUri,
      state,
    };
    const payload = Buffer.from(JSON.stringify(handOff)).toString('base64url');
    const signed = `${payload}.${hmac(payload, this.options.tokenSecret)}`;
    const target = new URL(
      `${broker.webUrl.replace(/\/+$/, '')}/app/assistant/connect`,
    );
    target.searchParams.set('request', signed);
    return target.toString();
  }

  // Binds a fresh single-use code to the approving account; answers where the
  // browser goes next.
  async approve(
    signed: string,
    accountId: string,
    now = Date.now(),
  ): Promise<string> {
    const handOff = this.read(signed, now);
    const code = randomBytes(32).toString('base64url');
    await this.prisma.assistantSignInCode.create({
      data: {
        accountId,
        clientId: handOff.client_id,
        codeHash: sha256(code),
        expiresAt: new Date(now + CODE_TTL_MS),
        nonce: handOff.nonce,
        redirectUri: handOff.redirect_uri,
      },
    });
    const redirect = new URL(handOff.redirect_uri);
    redirect.searchParams.set('code', code);
    redirect.searchParams.set('state', handOff.state);
    return redirect.toString();
  }

  async exchange(
    body: Record<string, unknown>,
    now = Date.now(),
  ): Promise<AssistantTokens> {
    const broker = this.options.assistant;
    const secret = text(body['client_secret']);
    if (
      !broker ||
      text(body['client_id']) !== broker.clientId ||
      !secret ||
      !same(secret, broker.clientSecret)
    ) {
      this.logger.warn('token refused: invalid_client');
      throw invalidClient(HttpStatus.UNAUTHORIZED);
    }
    if (body['grant_type'] !== 'authorization_code') {
      throw refusal(
        HttpStatus.BAD_REQUEST,
        'unsupported_grant_type',
        'Only the authorization code grant is supported',
      );
    }
    const code = text(body['code']);
    if (!code) throw this.refuseGrant();
    const codeHash = sha256(code);
    // The update decides between two callers of one code: only one sees it.
    const { count } = await this.prisma.assistantSignInCode.updateMany({
      data: { usedAt: new Date(now) },
      where: { codeHash, expiresAt: { gt: new Date(now) }, usedAt: null },
    });
    const row =
      count === 1
        ? await this.prisma.assistantSignInCode.findUnique({
            where: { codeHash },
          })
        : null;
    if (
      !row ||
      row.clientId !== broker.clientId ||
      row.redirectUri !== text(body['redirect_uri'])
    ) {
      throw this.refuseGrant();
    }
    const idToken = await new SignJWT({ nonce: row.nonce })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuer(broker.webUrl)
      .setSubject(row.accountId)
      .setAudience(broker.clientId)
      .setIssuedAt(Math.floor(now / 1000))
      .setExpirationTime(Math.floor(now / 1000) + TOKEN_TTL_S)
      .sign(new TextEncoder().encode(broker.clientSecret));
    return {
      access_token: idToken,
      expires_in: TOKEN_TTL_S,
      id_token: idToken,
      token_type: 'Bearer',
    };
  }

  private refuseGrant() {
    this.logger.warn('token refused: invalid_grant');
    return invalidGrant();
  }

  private read(signed: unknown, now: number): HandOff {
    const broker = this.options.assistant;
    const [payload, signature, ...rest] =
      typeof signed === 'string' ? signed.split('.') : [];
    if (!broker || !payload || !signature || rest.length > 0) {
      throw invalidRequest();
    }
    const given = Buffer.from(signature);
    const expected = Buffer.from(hmac(payload, this.options.tokenSecret));
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      this.logger.warn('approve refused: invalid_request');
      throw invalidRequest();
    }
    let handOff: Partial<HandOff>;
    try {
      handOff = JSON.parse(Buffer.from(payload, 'base64url').toString());
    } catch {
      throw invalidRequest();
    }
    if (
      handOff.client_id !== broker.clientId ||
      handOff.redirect_uri !== broker.redirectUri ||
      !text(handOff.state) ||
      !text(handOff.nonce) ||
      typeof handOff.exp !== 'number'
    ) {
      throw invalidRequest();
    }
    if (handOff.exp * 1000 <= now) {
      throw refusal(
        HttpStatus.GONE,
        'request_expired',
        'The sign-in request has expired; start again from the assistant',
      );
    }
    return handOff as HandOff;
  }
}
