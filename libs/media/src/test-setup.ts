import { setupZonelessTestEnv } from 'jest-preset-angular/setup-env/zoneless';
import '@motor-fix/media/testing';

setupZonelessTestEnv({
  errorOnUnknownElements: true,
  errorOnUnknownProperties: true,
});
