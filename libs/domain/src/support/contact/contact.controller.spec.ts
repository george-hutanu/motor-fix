import { SupportContactController } from './contact.controller';

// @traces 280-FR-011
describe('the support contact read', () => {
  it('answers the configured address', () => {
    expect(
      new SupportContactController({ email: 'help@example.test' }).contact(),
    ).toEqual({ email: 'help@example.test' });
  });

  it('answers null when no address is configured', () => {
    expect(new SupportContactController({}).contact()).toEqual({
      email: null,
    });
  });
});
