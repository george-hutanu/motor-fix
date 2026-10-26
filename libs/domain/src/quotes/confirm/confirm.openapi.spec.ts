import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The published contract the web client is generated from.
const doc = JSON.parse(
  readFileSync(join(__dirname, '../../../../../apps/api/openapi.json'), 'utf8'),
);

// @traces 389-FR-019
describe('the confirm in the OpenAPI document', () => {
  const post = doc.paths['/api/v1/bookings/{id}/confirm'].post;

  it('takes the mechanic and the lift, both optional', () => {
    expect(post.requestBody.content['application/json'].schema.$ref).toMatch(
      /ConfirmBookingDto$/,
    );
    const body = doc.components.schemas.ConfirmBookingDto;
    expect(Object.keys(body.properties).sort()).toEqual(['lift', 'mechanicId']);
    expect(body.required).toBeUndefined();
  });

  it('documents every refusal a confirm can answer', () => {
    expect(Object.keys(post.responses).sort()).toEqual([
      '200',
      '400',
      '401',
      '403',
      '404',
      '409',
    ]);
    for (const code of [
      'invalid_transition',
      'mechanic_unavailable',
      'outside_hours',
      'mechanic_busy',
      'lift_busy',
    ])
      expect(post.responses['409'].description).toContain(code);
  });

  it('offers the choices a confirm may make', () => {
    const get = doc.paths['/api/v1/bookings/{id}/confirm-options'].get;
    expect(
      get.responses['200'].content['application/json'].schema.$ref,
    ).toMatch(/ConfirmOptionsDto$/);
    expect(doc.components.schemas.ConfirmOptionsDto.required).toEqual([
      'liftCount',
      'mechanics',
      'mechanicRequired',
      'needsLift',
    ]);
  });
});

// @traces 150-FR-011
describe('the placement in the OpenAPI document', () => {
  const post = doc.paths['/api/v1/bookings/{id}/confirm'].post;

  it('documents the lost race and the reason a refusal carries', () => {
    const said = post.responses['409'].description;

    expect(said).toContain('slot_taken');
    for (const reason of [
      'reason',
      'ends_early',
      'day_off',
      'saturday_off',
      'not_working',
      'public_holiday',
      'closed_day',
      'outside_opening',
    ])
      expect(said).toContain(reason);
  });

  it('says whether the quote needs a lift, last of the confirm options', () => {
    const options = doc.components.schemas.ConfirmOptionsDto;

    expect(options.required.at(-1)).toBe('needsLift');
    expect(options.properties.needsLift.type).toBe('boolean');
  });
});
