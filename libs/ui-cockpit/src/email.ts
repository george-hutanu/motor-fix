import { COCKPIT_COLOURS } from './generated/colours';

// The light Cockpit theme as plain values, for the e-mails the worker sends:
// mail clients drop CSS variables. Imported as `@motor-fix/ui-cockpit/email`,
// which carries no Angular code.
const light = COCKPIT_COLOURS.light;

export const EMAIL_PALETTE = {
  amber: light['--mf-amber'],
  bg: light['--mf-bg'],
  line: light['--mf-line'],
  onAmber: light['--mf-on-amber'],
  panel: light['--mf-panel'],
  text: light['--mf-text'],
  textSecondary: light['--mf-text-secondary'],
} as const;
