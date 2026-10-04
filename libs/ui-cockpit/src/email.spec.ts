import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { EMAIL_PALETTE } from './email';

const css = readFileSync(join(__dirname, 'styles/cockpit.css'), 'utf8');
const light = css.slice(css.indexOf('color-scheme: light'));

const token = (name: string) =>
  light.match(new RegExp(`--mf-${name}:\\s*([^;]+);`))?.[1].trim();

describe('the e-mail palette', () => {
  it.each([
    ['amber', 'amber'],
    ['bg', 'bg'],
    ['line', 'line'],
    ['onAmber', 'on-amber'],
    ['panel', 'panel'],
    ['text', 'text'],
    ['textSecondary', 'text-secondary'],
  ] as const)('uses the light theme %s', (key, name) => {
    expect(EMAIL_PALETTE[key]).toBe(token(name));
  });
});
