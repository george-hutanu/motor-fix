import { Module } from '@nestjs/common';

import { PlatformRulesModule } from './platform-rules.module';
import { PlatformRulesService } from './platform-rules.service';

@Module({})
class FakeNotifications {}

describe('PlatformRulesModule', () => {
  // FR-013: the reviews story reads reviewPolicy() from another module.
  it('exports PlatformRulesService so other modules can read the review policy', () => {
    const module = PlatformRulesModule.register({ configured: [] } as never, {
      module: FakeNotifications,
    });
    expect(module.exports).toContain(PlatformRulesService);
  });
});
