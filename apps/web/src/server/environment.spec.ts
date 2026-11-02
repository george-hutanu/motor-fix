// @traces 1332-FR-005
describe('the server specs environment', () => {
  it('has no browser globals, as on the server', () => {
    expect(typeof window).toBe('undefined');
    expect(typeof document).toBe('undefined');
  });
});
