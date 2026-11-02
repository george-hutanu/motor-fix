// @traces 427-FR-006
import 'reflect-metadata';

// The confirm path loads the schedule service first (quotes → confirm →
// schedule → garage hours → the mechanics service, which removes a card's
// blocks); the time-block service must still get the schedule service then.
describe('loading the time-block service after the schedule service', () => {
  it('hands it the schedule service, not undefined', async () => {
    const { ScheduleService } = await import('../schedule/schedule.service');
    const { TimeBlocksService } = await import('./time-blocks.service');

    const params = Reflect.getMetadata('design:paramtypes', TimeBlocksService);
    expect(params[3]).toBe(ScheduleService);
  }, 60_000);
});
