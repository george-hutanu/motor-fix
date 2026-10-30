import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  Brevo,
  EmailConfirmationModule,
  PasswordResetModule,
} from '@motor-fix/domain';
import type { DynamicModule, Provider, Type } from '@nestjs/common';

import { AppModule } from './app.module';

// Every Brevo built while the API's module tree is put together.
jest.mock('../../../libs/domain/src/notifications/brevo/brevo', () => {
  const actual = jest.requireActual(
    '../../../libs/domain/src/notifications/brevo/brevo',
  );
  const built = jest.fn();
  class Counted extends actual.Brevo {
    constructor(...args: [never]) {
      super(...args);
      built();
    }
  }
  return { ...actual, Brevo: Counted, built };
});
const { built } = jest.requireMock(
  '../../../libs/domain/src/notifications/brevo/brevo',
) as { built: jest.Mock };

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
function optionsOf(module: Type<unknown>) {
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

type Node = DynamicModule | Type<unknown> | Promise<DynamicModule>;

// The providers that hold a Brevo, anywhere in the module tree.
function brevoProviders(root: Node, seen = new Set<unknown>()): Provider[] {
  if (seen.has(root) || !root || root instanceof Promise) return [];
  seen.add(root);
  const module = root as DynamicModule;
  const own = (module.providers ?? []).filter(
    (provider) =>
      provider === Brevo ||
      (typeof provider === 'object' &&
        (provider.provide === Brevo ||
          ('useValue' in provider && provider.useValue instanceof Brevo) ||
          ('useClass' in provider && provider.useClass === Brevo))),
  );
  return [
    ...own,
    ...(module.imports ?? []).flatMap((child) =>
      brevoProviders(child as Node, seen),
    ),
  ];
}

// The app's own source files, its tests left out.
function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.ts$/.test(entry.name) && !/\.(spec|testing)\.ts$/.test(entry.name)
      ? [path]
      : [];
  });
}

// An import of the provider client: its module, or Brevo from the domain lib.
function importsBrevo(text: string): boolean {
  if (/from\s+'[^']*notifications\/brevo\/brevo'/.test(text)) return true;
  return [
    ...text.matchAll(/import\s+\{([^}]*)\}\s+from\s+'@motor-fix\/domain'/g),
  ].some(([, names]) =>
    names
      .split(',')
      .map((name) => name.trim().split(/\s+as\s+/)[0])
      .includes('Brevo'),
  );
}

// @traces 1379-FR-006
// @traces 1379-FR-007
// @traces 1379-FR-008
describe('AppModule holds no provider sending client', () => {
  it('builds no Brevo while the module tree is put together', () => {
    built.mockClear();

    AppModule.register(env);

    expect(built).not.toHaveBeenCalled();
  });

  it('has no provider anywhere in the tree that holds a Brevo', () => {
    expect(brevoProviders(AppModule.register(env))).toEqual([]);
  });

  it('finds a Brevo provider put back anywhere in the tree', () => {
    const tree = AppModule.register(env);
    const planted: DynamicModule = {
      module: class Planted {},
      providers: [{ provide: Brevo, useFactory: () => null }],
    };
    const nested: DynamicModule = {
      imports: [planted],
      module: class Outer {},
    };

    expect(
      brevoProviders({ ...tree, imports: [...(tree.imports ?? []), nested] }),
    ).toHaveLength(1);
  });

  it.each([
    ['api', join(__dirname)],
    ['web', join(__dirname, '../../web/src')],
  ])('keeps the provider client out of the %s app’s source', (_, dir) => {
    const found = sources(dir).filter((file) =>
      importsBrevo(readFileSync(file, 'utf8')),
    );

    expect(found).toEqual([]);
  });

  it('recognises both ways of importing the client', () => {
    expect(
      importsBrevo("import { Brevo } from '../x/notifications/brevo/brevo';"),
    ).toBe(true);
    expect(importsBrevo("import { a, Brevo } from '@motor-fix/domain';")).toBe(
      true,
    );
    expect(
      importsBrevo("import { Brevo as Client } from '@motor-fix/domain';"),
    ).toBe(true);
    expect(
      importsBrevo("import { BrevoError } from '@motor-fix/domain';"),
    ).toBe(false);
  });
});
