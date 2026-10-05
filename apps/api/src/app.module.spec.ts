import {
  EmailConfirmationModule,
  PasswordResetModule,
} from '@motor-fix/domain';
import type { DynamicModule } from '@nestjs/common';

import { AppModule } from './app.module';

const env = {
  APP_ENV: 'test',
  AUTH_TOKEN_SECRET: 'test-secret',
  DATABASE_URL: 'postgresql://localhost:5432/postgres',
  REDIS_URL: 'redis://localhost:6379',
  RELEASE_SHA: 'abc123',
  STORAGE_ACCESS_KEY_ID: 'key',
  STORAGE_BUCKET: 'bucket',
  STORAGE_ENDPOINT: 'http://localhost:9000',
  STORAGE_REGION: 'eu-central-1',
  STORAGE_SECRET_ACCESS_KEY: 'secret',
} as const;

// Built inside the test, not in a hook: what runs in a hook is out of reach
// of the mutants Stryker switches on per test.
function optionsOf(module: unknown) {
  const imports = AppModule.register(env).imports as DynamicModule[];
  const found = imports.find((entry) => entry.module === module);
  return found?.providers?.flatMap((provider) =>
    typeof provider === 'object' && 'useValue' in provider
      ? [provider.useValue]
      : [],
  );
}

describe('AppModule', () => {
  const webUrl = process.env['PUBLIC_WEB_URL'];

  beforeEach(() => {
    process.env['PUBLIC_WEB_URL'] = 'https://motorfix.test/';
  });

  afterEach(() => {
    if (webUrl === undefined) delete process.env['PUBLIC_WEB_URL'];
    else process.env['PUBLIC_WEB_URL'] = webUrl;
  });

  it.each([
    ['the e-mail confirmation', EmailConfirmationModule],
    ['the password reset', PasswordResetModule],
  ])('gives %s the web app address', (_, module) => {
    expect(optionsOf(module)).toContainEqual({
      webUrl: 'https://motorfix.test',
    });
  });
});
