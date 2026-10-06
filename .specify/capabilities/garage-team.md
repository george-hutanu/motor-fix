---
capability: garage-team
updated: 2026-10-06
features:
  - 131-invite-garage-staff
---

# Capability: Garage team

How a garage's owner brings mechanics and receptionists into the garage: the staff invite, its link and e-mail, acceptance into an existing or new account, and the move of a mechanic between garages.

## Requirements

### 131-FR-001 — The system MUST store a staff invite with garage, kind (`mechanic` or `receptionist`), invitee name (2 to 80 characters, trimmed), e-mail (trimmed, lower-case, at most 254 characters), the three permissions (`can_move_bookings`, `can_answer_quotes`, `can_record_final_price`, all false by default, only meaningful for kind `mechanic` and stored false for a `receptionist` whatever the request carries), the hash of a single-use token of 32 random bytes, status (`sent`, `accepted`, `revoked`; `expired` is never written: a `sent` invite past its expiry reads as `expired`), expiry (7 days from sending or resending) and creation time.

_From 131-invite-garage-staff._

### 131-FR-002 — Only the owner of that garage MUST be able to send, resend or revoke its invites: a receptionist or a mechanic of the garage gets 403; the owner of another garage, or any other actor, gets 404.

_From 131-invite-garage-staff._

### 131-FR-003 — Sending MUST refuse a second open invite (status `sent` and not past its expiry) for the same garage and e-mail (409), a mechanic invite for a garage whose `team_mechanics` feature is off (404 `feature_off`), an e-mail whose account already holds the invited kind at that garage (409), and the owner's own e-mail (409).

_From 131-invite-garage-staff._

### 131-FR-004 — Sending and resending MUST send a STAFF_INVITE e-mail to the invited address, whether or not an account holds it, with the link `/{lang}/invite/:token` in the language of the owner's interface; the send happens within the request, and the answer says whether the e-mail went out; when it could not be sent the invite MUST stay `sent` and the answer MUST carry the link so the owner can copy it (the link is returned only then).

_From 131-invite-garage-staff._

### 131-FR-005 — Resending MUST issue a new token, void the old one, and restart the expiry, for a `sent` invite whether or not it is past its expiry; revoking MUST set `revoked`. Both MUST answer 409 `invite_invalid` for an `accepted` or `revoked` invite.

_From 131-invite-garage-staff._

### 131-FR-006 — Opening a link MUST answer, without a session, the garage name, the kind and the invitee name for a valid `sent` invite; `invite_expired` past the expiry; 404 `feature_off` for a mechanic invite while the garage's `team_mechanics` is off; `invite_invalid` for a revoked, used, voided, unknown or malformed token, without revealing which.

_From 131-invite-garage-staff._

### 131-FR-007 — Accepting MUST require a session and a valid `sent` invite (a link past its expiry answers `invite_expired`, a revoked, used, voided or unknown one `invite_invalid`; of two simultaneous accepts of one link only one succeeds and the other answers `invite_invalid`), and MUST in one transaction: grant the invite's role to the signed-in account if not held; for a mechanic, create the mechanic row (garage, account, the invite's permissions; the row existing is what puts the mechanic on the public profile) or move the account's existing mechanic row to this garage with these permissions; for a receptionist, create the garage membership with role `receptionist`; set the invite `accepted`; write the audit entry; emit `invite.accepted` and, on a move, `mechanic.updated`. The answer is 204 with no session; the web then switches the session to the invited role through the role switch (a new access token, `lastRole` set), so the garage dashboard opens in that role, and a failed switch is retried without accepting again.

_From 131-invite-garage-staff._

### 131-FR-008 — Accepting MUST be refused with `invite_invalid` when the signed-in account owns this garage, is receptionist at another garage (receptionist invite), or when the invite's `team_mechanics` feature is off (404 `feature_off`); an account already holding the invited role at this garage completes with no change beyond the invite status.

_From 131-invite-garage-staff._

### 131-FR-009 — After acceptance the system MUST notify the garage owner with STAFF_JOINED (its catalogue channels; it can be muted) and publish a live update on `garage:{garageId}` for the new garage and, on a move, the old one.

_From 131-invite-garage-staff._

### 131-FR-010 — Every invite sent, resent, revoked and accepted MUST be written to the audit history with the actor and the permissions chosen, and `invite.sent`, `invite.revoked`, `invite.accepted` MUST be emitted in the same transaction as the change.

_From 131-invite-garage-staff._

### 131-FR-011 — The garage dashboard frame MUST offer "Invită în echipă" to the owner only, opening a dialog with name, e-mail, kind (mechanic, offered only when `team_mechanics` is on; receptionist), the three permission ticks shown only for mechanic and unticked by default, and a send button; it MUST show the field problems before sending and the API's message after, including "Nu am putut trimite invitația" with "Copiază linkul".

_From 131-invite-garage-staff._

### 131-FR-012 — The public acceptance screen at `/{lang}/invite/:token` MUST show "{garage} te invită să te alături echipei ca {rol}." and, for a mechanic, the line about appearing on the garage's public profile; signed out, it MUST offer sign-in and account creation (the existing dialogs, with the invited name and e-mail filled in) and, when the account is created from the link, accept in the same flow; signed in (including after signing in from the link), it MUST accept only on an explicit "Acceptă"; after acceptance it MUST open the garage dashboard in the account's language; an invalid or expired link MUST show "Invitația nu mai este valabilă. Cere service-ului una nouă."

_From 131-invite-garage-staff._

### 131-FR-013 — Every new text MUST exist in Romanian and English, and text typed by a person (names, e-mails, garage names) MUST never be shown back as markup.

_From 131-invite-garage-staff._

### 131-FR-014 — The invite endpoints MUST be REST with OpenAPI and DTOs in the contracts library, validated at the edge; the web app MUST call them through the generated client.

_From 131-invite-garage-staff._
