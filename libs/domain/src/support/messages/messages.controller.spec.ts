import { GUARDS_METADATA } from '@nestjs/common/constants';

import { SupportMessagesController } from './messages.controller';
import { SupportThrottleGuard } from './throttle';
import { JsonOnly } from '../../auth/auth.controller';

// @traces 280-FR-013
describe('the contact form endpoint', () => {
  it('takes every POST from the hourly limit before refusing a non-JSON body', () => {
    const guards: unknown[] = Reflect.getMetadata(
      GUARDS_METADATA,
      SupportMessagesController.prototype.create,
    );

    expect(guards).toEqual([SupportThrottleGuard, JsonOnly]);
  });
});
