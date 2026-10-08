import { Module } from '@nestjs/common';

import { PlatformRulesModule } from './platform-rules.module';
import { PlatformRulesService } from './platform-rules.service';

@Module({})
class FakeNotifications {}

describe('PlatformRulesModule', () => {
  // @traces 260-FR-013
  it('exports PlatformRulesService so other modules can read the review policy', () => {
    const module = PlatformRulesModule.register({ configured: [] } as never, {
      module: FakeNotifications,
    });
    expect(module.exports).toContain(PlatformRulesService);
  });
});
