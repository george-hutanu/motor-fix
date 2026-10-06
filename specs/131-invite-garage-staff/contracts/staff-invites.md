# Contract: staff invites

OpenAPI fragment; the decorators in `libs/domain/src/garages/staff-invite.controller.ts` and the DTOs in `libs/contracts/src/staff-invite.dto.ts` are the source, `apps/api/openapi.json` the generated document and `libs/data-access` the client (`npx nx run api:openapi && npx nx run data-access:generate`). Every refusal is the API's problem shape `{ code, message, errors? }`.

```yaml
paths:
  /api/v1/garages/{garageId}/invites:
    post:
      tags: [garages]
      operationId: GarageInvitesController_send
      security: [{ bearer: [] }]
      parameters: [{ name: garageId, in: path, required: true, schema: { type: string, format: uuid } }]
      requestBody: { required: true, content: { application/json: { schema: { $ref: '#/components/schemas/StaffInviteDto' } } } }
      responses:
        '201': { description: Stored and sent, content: { application/json: { schema: { $ref: '#/components/schemas/StaffInviteSentDto' } } } }
        '400': { description: validation_failed }
        '403': { description: forbidden — a receptionist or mechanic of this garage }
        '404': { description: not_found — not this actor's garage; feature_off — mechanic kind while team_mechanics is off }
        '409': { description: 'invite_open (body carries inviteId); already_in_team' }
  /api/v1/garages/{garageId}/invites/{id}/resend:
    post:
      tags: [garages]
      operationId: GarageInvitesController_resend
      security: [{ bearer: [] }]
      parameters:
        - { name: garageId, in: path, required: true, schema: { type: string, format: uuid } }
        - { name: id, in: path, required: true, schema: { type: string, format: uuid } }
      responses:
        '200': { description: New link sent, content: { application/json: { schema: { $ref: '#/components/schemas/StaffInviteSentDto' } } } }
        '403': { description: forbidden }
        '404': { description: not_found }
        '409': { description: invite_invalid — accepted or revoked }
  /api/v1/garages/{garageId}/invites/{id}/revoke:
    post:
      tags: [garages]
      operationId: GarageInvitesController_revoke
      security: [{ bearer: [] }]
      parameters: [as resend]
      responses:
        '204': { description: Revoked }
        '403': { description: forbidden }
        '404': { description: not_found }
        '409': { description: invite_invalid — accepted or revoked }
  /api/v1/invites/check:
    post:
      tags: [invites]
      operationId: InvitesController_check
      description: Public (no session); JSON only. The token travels in the body, never in a path.
      requestBody: { required: true, content: { application/json: { schema: { $ref: '#/components/schemas/InviteTokenDto' } } } }
      responses:
        '200': { description: A valid open invite, content: { application/json: { schema: { $ref: '#/components/schemas/InviteViewDto' } } } }
        '404': { description: feature_off — mechanic invite while team_mechanics is off }
        '410': { description: invite_expired; invite_invalid (revoked, used, voided, unknown or malformed, indistinguishable) }
  /api/v1/invites/accept:
    post:
      tags: [invites]
      operationId: InvitesController_accept
      security: [{ bearer: [] }]
      description: Joins the garage; the web then switches the session to the invited role through roles/switch (the refresh cookie is scoped to /api/v1/auth).
      requestBody: { required: true, content: { application/json: { schema: { $ref: '#/components/schemas/InviteTokenDto' } } } }
      responses:
        '204': { description: Accepted }
        '401': { description: sign_in_required }
        '404': { description: feature_off }
        '410': { description: invite_expired; invite_invalid (also the garage's owner, or a receptionist of another garage accepting a receptionist invite) }

components:
  schemas:
    StaffInviteDto:
      type: object
      required: [name, email, kind]
      properties:
        name: { type: string, minLength: 2, maxLength: 80, description: Trimmed }
        email: { type: string, maxLength: 254, description: Trimmed; compared without letter case (the sign-up rule) }
        kind: { type: string, enum: [mechanic, receptionist] }
        canMoveBookings: { type: boolean, default: false, description: Mechanic only; ignored for a receptionist }
        canAnswerQuotes: { type: boolean, default: false }
        canRecordFinalPrice: { type: boolean, default: false }
    StaffInviteSentDto:
      type: object
      required: [id, emailSent]
      properties:
        id: { type: string, format: uuid }
        emailSent: { type: boolean }
        link: { type: string, description: Only when emailSent is false, so the owner can copy it }
    InviteTokenDto:
      type: object
      required: [token]
      properties:
        token: { type: string, minLength: 1, maxLength: 256, description: "The link's last part" }
    InviteViewDto:
      type: object
      required: [garage, kind, name, email]
      properties:
        garage: { type: string, description: The garage's name }
        email: { type: string, description: The invited address, filled into the sign-up dialog }
        kind: { type: string, enum: [mechanic, receptionist] }
        name: { type: string, description: The invitee's name as the owner typed it }
```

Web addresses: the e-mail's link is `{PUBLIC_WEB_URL}/{lang}/invite/{token}` in the owner's language; the page renders in the address's language.

Public routes list (`apps/api/src/public-routes.integration.spec.ts`): `POST /api/v1/invites/check`.
