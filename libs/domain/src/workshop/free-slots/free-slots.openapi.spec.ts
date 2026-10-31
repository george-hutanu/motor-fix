import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The published contract the web client is generated from.
const doc = JSON.parse(
  readFileSync(join(__dirname, '../../../../../apps/api/openapi.json'), 'utf8'),
);

// @traces 154-FR-001
// @traces 154-FR-017
describe('the free slots read, in the OpenAPI document', () => {
  const get = doc.paths['/api/v1/garages/{garageId}/free-slots']?.get;

  it('publishes the read under its own operation id and tag', () => {
    expect(get?.operationId).toBe('garageFreeSlots');
    expect(get.tags).toContain('garages');
    expect(
      get.responses['200'].content['application/json'].schema.$ref,
    ).toMatch(/FreeSlotsDto$/);
  });

  it('documents every answer the read can give', () => {
    expect(Object.keys(get?.responses ?? {}).sort()).toEqual([
      '200',
      '400',
      '401',
      '403',
      '404',
    ]);
  });

  it('takes the garage in the path and the eight question parameters in the query', () => {
    const named = (where: string) =>
      (get?.parameters ?? [])
        .filter((p: { in: string }) => p.in === where)
        .map((p: { name: string }) => p.name)
        .sort();

    expect(named('path')).toEqual(['garageId']);
    expect(named('query')).toEqual([
      'count',
      'duration',
      'earliest',
      'excludeBookingId',
      'horizonDays',
      'jobTypeIds',
      'mechanicId',
      'needsLift',
    ]);
  });

  it('marks the duration as the only required question parameter', () => {
    const required = (get?.parameters ?? [])
      .filter((p: { in: string; required?: boolean }) => p.in === 'query')
      .filter((p: { required?: boolean }) => p.required)
      .map((p: { name: string }) => p.name);

    expect(required).toEqual(['duration']);
  });

  it('lets the job types repeat', () => {
    const jobs = get?.parameters.find(
      (p: { name: string }) => p.name === 'jobTypeIds',
    );

    expect(jobs.schema.type).toBe('array');
  });

  it('answers the slots and, only when there are none, the reason', () => {
    const dto = doc.components.schemas.FreeSlotsDto;

    expect(Object.keys(dto?.properties ?? {}).sort()).toEqual([
      'reason',
      'slots',
    ]);
    expect(dto.required).toEqual(['slots']);
    expect(dto.properties.slots.items.$ref).toMatch(/FreeSlotDto$/);
    expect(dto.properties.reason.enum).toEqual(['none_in_horizon']);
  });

  it('gives each slot its start and the end of the job, nothing else', () => {
    const slot = doc.components.schemas.FreeSlotDto;

    expect(Object.keys(slot?.properties ?? {}).sort()).toEqual([
      'endsAt',
      'startsAt',
    ]);
    expect(slot.required.sort()).toEqual(['endsAt', 'startsAt']);
    expect(slot.properties.startsAt.format).toBe('date-time');
    expect(slot.properties.endsAt.format).toBe('date-time');
  });
});
