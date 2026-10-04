// The light Cockpit theme (styles/cockpit.css) as plain values, for the
// e-mails the worker sends: mail clients drop CSS variables. email.spec.ts
// keeps the two in step. Imported as `@motor-fix/ui-cockpit/email`, which
// carries no Angular code.
export const EMAIL_PALETTE = {
  amber: '#ffb000',
  bg: '#f4f4f1',
  line: '#d3d5d8',
  onAmber: '#15171a',
  panel: '#ffffff',
  text: '#15171a',
  textSecondary: '#50545b',
} as const;
