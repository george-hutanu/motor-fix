import { setupZonelessTestEnv } from 'jest-preset-angular/setup-env/zoneless';
import './blob-array-buffer.testing';

setupZonelessTestEnv({
  errorOnUnknownElements: true,
  errorOnUnknownProperties: true,
});
