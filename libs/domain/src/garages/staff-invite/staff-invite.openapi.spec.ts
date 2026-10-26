import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The published contract the web client is generated from.
const doc = JSON.parse(
  readFileSync(join(__dirname, '../../../../../apps/api/openapi.json'), 'utf8'),
);
const schemas = doc.components.schemas;

// @traces 1255-FR-017
describe('the staff invites in the OpenAPI document', () => {
  it('keeps the five invite routes and adds none', () => {
    expect(
      Object.keys(doc.paths)
        .filter((path) => path.includes('invites'))
        .sort(),
    ).toEqual([
      '/api/v1/garages/{garageId}/invites',
      '/api/v1/garages/{garageId}/invites/{id}/resend',
      '/api/v1/garages/{garageId}/invites/{id}/revoke',
      '/api/v1/invites/accept',
      '/api/v1/invites/check',
    ]);
  });

  it('sends to a card by e-mail or phone', () => {
    expect(Object.keys(schemas.StaffInviteDto.properties)).toEqual(
      expect.arrayContaining(['mechanicId', 'email', 'phone', 'name']),
    );
    expect(schemas.StaffInviteDto.required).toEqual(['kind']);
    const conflict =
      doc.paths['/api/v1/garages/{garageId}/invites'].post.responses['409']
        .description;
    for (const code of [
      'owner_row',
      'card_linked',
      'invite_open',
      'self_invite',
    ])
      expect(conflict).toContain(code);
  });

  it('shows the invitee the address and the team they would leave', () => {
    expect(schemas.InviteViewDto.required).toEqual(
      expect.arrayContaining(['email', 'phone', 'leaving']),
    );
  });

  it("lists a card's open invite on the card", () => {
    expect(schemas.GarageMechanicDto.required).toContain('invite');
    expect(schemas.GarageMechanicDto.properties.invite.allOf[0].$ref).toMatch(
      /StaffInviteOnCardDto$/,
    );
    expect(schemas.StaffInviteOnCardDto.required.sort()).toEqual([
      'email',
      'expiresAt',
      'id',
      'phone',
      'sentAt',
    ]);
  });
});
