import { InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import type { OAuthTokenVerifier } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { Inject, Injectable } from '@nestjs/common';
import { createRemoteJWKSet, errors, jwtVerify } from 'jose';

export interface IssuerSettings {
  issuer: string;
  mcpUrl: string;
}

export const ISSUER_SETTINGS = Symbol('ISSUER_SETTINGS');

const SCOPES = new Set(['motorfix.read', 'motorfix.act']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A failure of the key server, not of the token: the caller answers 503.
const keyServerDown = (error: unknown) =>
  !(error instanceof errors.JOSEError) ||
  error instanceof errors.JWKSTimeout ||
  error instanceof errors.JWKSInvalid;

@Injectable()
export class TokenVerifier implements OAuthTokenVerifier {
  private readonly keys: ReturnType<typeof createRemoteJWKSet>;

  constructor(
    @Inject(ISSUER_SETTINGS) private readonly settings: IssuerSettings,
  ) {
    this.keys = createRemoteJWKSet(
      new URL(`${settings.issuer}/protocol/openid-connect/certs`),
      { cacheMaxAge: 600_000, cooldownDuration: 60_000 },
    );
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const { payload } = await jwtVerify(token, this.keys, {
      algorithms: ['RS256'],
      audience: this.settings.mcpUrl,
      clockTolerance: 30,
      issuer: this.settings.issuer,
      requiredClaims: ['exp'],
    }).catch((error: unknown) => {
      if (keyServerDown(error)) throw error;
      throw new InvalidTokenError('The token is not valid.');
    });
    const { azp, exp, motorfix_account_id: accountId, scope } = payload;
    if (
      typeof azp !== 'string' ||
      typeof scope !== 'string' ||
      typeof accountId !== 'string' ||
      !UUID.test(accountId)
    )
      throw new InvalidTokenError('The token is not valid.');
    return {
      clientId: azp,
      expiresAt: exp,
      extra: { accountId },
      scopes: scope.split(' ').filter((s) => SCOPES.has(s)),
      token,
    };
  }
}
