import { angularTest, eagerImports } from '../vitest.shared.ts';

const transform = (code: string, id: string) =>
  (
    eagerImports().transform as (
      code: string,
      id: string,
    ) => { code: string } | undefined
  )(code, id);

// @traces 1332-FR-011
describe('eagerImports', () => {
  it('starts a relative import() on the first line and hands the call its promise', () => {
    const code = "const a = 1;\nconst { AddCar } = await import('./add-car');";

    expect(transform(code, '/w/apps/web/src/app/open-add-car.ts')?.code).toBe(
      "const __eager0 = import('./add-car'); __eager0.catch(() => undefined); const a = 1;\nconst { AddCar } = await __eager0;",
    );
  });

  it('keeps the line count, so a stack trace points at the same line', () => {
    const code = 'a();\nawait import(\'../x\');\nawait import("./y");\n';
    const out = transform(code, '/w/libs/i18n/src/i18n.ts')?.code ?? '';

    expect(out.split('\n')).toHaveLength(code.split('\n').length);
    expect(out).toContain('await __eager0;\nawait __eager1;');
  });

  it('leaves a package import(), a spec and a file with none as they are', () => {
    expect(
      transform("await import('@angular/core');", '/w/apps/web/src/a.ts'),
    ).toBeUndefined();
    expect(
      transform("await import('./a');", '/w/apps/web/src/a.spec.ts'),
    ).toBeUndefined();
    expect(transform('const a = 1;', '/w/apps/web/src/a.ts')).toBeUndefined();
  });

  it('runs on the direct path only, the one Stryker and the hooks take', () => {
    const before = process.env['NX_TASK_TARGET_TARGET'];
    delete process.env['NX_TASK_TARGET_TARGET'];
    try {
      const names = (
        (angularTest('apps/web') as { plugins: unknown[] }).plugins.flat(
          Number.POSITIVE_INFINITY,
        ) as { name?: string }[]
      ).map((plugin) => plugin?.name);
      expect(names).toContain('motor-fix:eager-imports');
    } finally {
      if (before !== undefined) process.env['NX_TASK_TARGET_TARGET'] = before;
    }
  });
});
