import { Test } from '@nestjs/testing';

import { DirectSendModule } from './direct-send.module';

// @traces 1379-FR-010
describe('DirectSendModule.register without a broker', () => {
  // The API boots without Valkey to write its OpenAPI document, then closes.
  it('closes at once when nothing was sent', async () => {
    const module = await Test.createTestingModule({
      imports: [DirectSendModule.register('redis://127.0.0.1:1')],
    }).compile();
    await module.init();

    const closed = module.close().then(() => 'closed');
    const late = new Promise((resolve) => {
      setTimeout(() => resolve('hung'), 3000).unref();
    });

    expect(await Promise.race([closed, late])).toBe('closed');
  });
});
