import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { IMAGE_FORMATS, IMAGE_WIDTHS } from '../libs/contracts/src/images.ts';

// The policy lives in the private specs clone, which CI does not check out.
const page = join(
  __dirname,
  '../.motor-fix-specs/docs/reference/image-policy.md',
);
const docsIt = existsSync(page) ? it : it.skip;

// @traces 1192-FR-013
describe('the image policy page', () => {
  docsIt(
    'names the widths and formats every listing photo is written in',
    () => {
      const variants = readFileSync(page, 'utf8')
        .split('\n')
        .find((line) => line.startsWith('| Variants |'));

      expect(variants).toContain(`${IMAGE_WIDTHS.join(', ')} px`);
      expect(variants?.toLowerCase()).toContain(IMAGE_FORMATS.join(' and '));
    },
  );
});
