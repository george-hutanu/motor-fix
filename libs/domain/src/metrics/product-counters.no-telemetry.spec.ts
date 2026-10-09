import {
  countApproval,
  countEmail,
  countGarageSignUp,
  countNotification,
  countQuote,
  countSearch,
  countSignIn,
} from './product-counters';

// No startTelemetry in this file: Jest gives it a fresh global, so the
// counters fall through to the OpenTelemetry API's no-op meter.
// @traces 879-FR-011
describe('the product counters with telemetry off', () => {
  it('count nothing and never throw', () => {
    expect(() => {
      countSearch('results');
      countSignIn('password');
      countGarageSignUp();
      countApproval('approved');
      countQuote();
      countEmail('SIGN_IN_CODE');
      countNotification('push');
    }).not.toThrow();
  });
});
