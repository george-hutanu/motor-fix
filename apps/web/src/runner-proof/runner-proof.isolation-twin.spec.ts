// A twin file makes the same checks: whichever runs second fails if spec
// files share one environment.
// @traces 1332-FR-004
const twin = globalThis as { __runnerProof?: string };

describe('a spec file environment', () => {
  it('starts without what another spec file left behind', () => {
    expect(twin.__runnerProof).toBeUndefined();
    expect(vi.isMockFunction(document.hasFocus)).toBe(false);

    twin.__runnerProof = 'set';
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);

    expect(document.hasFocus()).toBe(true);
  });
});
