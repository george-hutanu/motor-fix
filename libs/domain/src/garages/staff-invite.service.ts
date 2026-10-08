import type {
  InviteViewDto,
  StaffInviteDto,
  StaffInviteSentDto,
} from '@motor-fix/contracts';
import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';

import { AUDIT_PORT, type AuditPort } from '../audit/audit.port';
import { AccountsService } from '../auth/accounts.service';
import { hashToken, newToken } from '../auth/email-confirmation';
import type { Actor } from '../auth/policy';
import { PRISMA } from '../auth/prisma';
import { refusal } from '../auth/sign-up.service';
import { EVENT_PORT, type EventPort } from '../events/event.port';
import type { PrismaClient, StaffInvite } from '../generated/prisma/client';
import { Brevo } from '../notifications/brevo';
import { blockedReason, type EmailConfig } from '../notifications/email-config';
import { NotificationsService } from '../notifications/notifications.service';
import { render } from '../notifications/templates';

export const INVITE_EMAIL = Symbol('INVITE_EMAIL');

const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const FEATURE = 'team_mechanics';

const notFound = () =>
  refusal(HttpStatus.NOT_FOUND, 'not_found', 'No such garage');
const invalid = (status = HttpStatus.GONE) =>
  refusal(status, 'invite_invalid', 'This invitation is no longer valid');
const featureOff = () =>
  refusal(
    HttpStatus.NOT_FOUND,
    'feature_off',
    'This garage does not take mechanics',
  );

const permissionsOf = (invite: StaffInvite) => ({
  canAnswerQuotes: invite.canAnswerQuotes,
  canMoveBookings: invite.canMoveBookings,
  canRecordFinalPrice: invite.canRecordFinalPrice,
});

// An owner's invitations to the garage's team, and their acceptance by the
// person who holds the link.
@Injectable()
export class StaffInviteService {
  private readonly logger = new Logger('StaffInvites');
  now = () => new Date();

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(AUDIT_PORT) private readonly audit: AuditPort,
    @Inject(EVENT_PORT) private readonly events: EventPort,
    @Inject(INVITE_EMAIL) private readonly config: EmailConfig,
    private readonly brevo: Brevo,
    private readonly accounts: AccountsService,
    private readonly notifications: NotificationsService,
  ) {}

  async send(
    actor: Actor,
    garageId: string,
    dto: StaffInviteDto,
  ): Promise<StaffInviteSentDto> {
    this.assertOwner(actor, garageId);
    if (dto.kind === 'mechanic') await this.assertMechanics(garageId);
    const email = dto.email.toLowerCase();
    await this.assertNotInTeam(garageId, email, dto.kind);
    const open = await this.prisma.staffInvite.findFirst({
      where: {
        email,
        expiresAt: { gt: this.now() },
        garageId,
        status: 'sent',
      },
    });
    if (open) {
      throw new HttpException(
        {
          code: 'invite_open',
          inviteId: open.id,
          message: 'This address already has an open invitation',
        },
        HttpStatus.CONFLICT,
      );
    }
    const mechanic = dto.kind === 'mechanic';
    this.webUrl();
    const { hash, token } = newToken();
    const invite = await this.prisma.$transaction(async (tx) => {
      const row = await tx.staffInvite.create({
        data: {
          canAnswerQuotes: mechanic && dto.canAnswerQuotes,
          canMoveBookings: mechanic && dto.canMoveBookings,
          canRecordFinalPrice: mechanic && dto.canRecordFinalPrice,
          email,
          expiresAt: new Date(this.now().getTime() + TTL_MS),
          garageId,
          kind: dto.kind,
          name: dto.name,
          tokenHash: hash,
        },
      });
      await this.audit.record(tx, {
        action: 'create',
        actorId: actor.accountId,
        actorRole: actor.role,
        garageId,
        kind: 'invite_sent',
        newValue: {
          kind: row.kind,
          name: row.name,
          permissions: permissionsOf(row),
        },
        subjectId: row.id,
        subjectType: 'staff_invite',
      });
      await this.events.record(tx, {
        audience: { garageIds: [garageId], type: 'garage' },
        kind: 'invite.sent',
        payload: { garageId, inviteId: row.id, kind: row.kind },
        subjectId: row.id,
      });
      return row;
    });
    return this.mail(actor, invite, token);
  }

  async resend(
    actor: Actor,
    garageId: string,
    id: string,
  ): Promise<StaffInviteSentDto> {
    const found = await this.ownInvite(actor, garageId, id);
    if (found.kind === 'mechanic') await this.assertMechanics(garageId);
    this.webUrl();
    const { hash, token } = newToken();
    const invite = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.staffInvite.updateMany({
        data: {
          expiresAt: new Date(this.now().getTime() + TTL_MS),
          tokenHash: hash,
        },
        where: { id, status: 'sent' },
      });
      if (count === 0) throw invalid(HttpStatus.CONFLICT);
      await this.audit.record(tx, {
        action: 'update',
        actorId: actor.accountId,
        actorRole: actor.role,
        garageId,
        kind: 'invite_resent',
        newValue: {
          kind: found.kind,
          name: found.name,
          permissions: permissionsOf(found),
        },
        subjectId: id,
        subjectType: 'staff_invite',
      });
      return tx.staffInvite.findUniqueOrThrow({ where: { id } });
    });
    return this.mail(actor, invite, token);
  }

  async revoke(actor: Actor, garageId: string, id: string): Promise<void> {
    await this.ownInvite(actor, garageId, id);
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.staffInvite.updateMany({
        data: { status: 'revoked' },
        where: { id, status: 'sent' },
      });
      if (count === 0) throw invalid(HttpStatus.CONFLICT);
      await this.audit.record(tx, {
        action: 'update',
        actorId: actor.accountId,
        actorRole: actor.role,
        field: 'status',
        garageId,
        kind: 'invite_revoked',
        newValue: 'revoked',
        oldValue: 'sent',
        subjectId: id,
        subjectType: 'staff_invite',
      });
      await this.events.record(tx, {
        audience: { garageIds: [garageId], type: 'garage' },
        kind: 'invite.revoked',
        payload: { garageId, inviteId: id },
        subjectId: id,
      });
    });
  }

  // Without a session: what the link offers, or why it offers nothing.
  async check(token: string): Promise<InviteViewDto> {
    const invite = await this.usable(token);
    const garage = await this.prisma.garage.findUniqueOrThrow({
      where: { id: invite.garageId },
    });
    return {
      email: invite.email,
      garage: garage.name,
      kind: invite.kind,
      name: invite.name,
    };
  }

  // The signed-in account joins the garage in the invite's role; the web
  // switches its session to that role once this answers.
  async accept(actor: Actor, token: string): Promise<void> {
    const invite = await this.usable(token);
    const { garageId } = invite;
    const account = await this.prisma.account.findUniqueOrThrow({
      include: { mechanic: true, memberships: true },
      where: { id: actor.accountId },
    });
    const owner = account.memberships.some(
      (m) => m.role === 'owner' && m.garageId === garageId,
    );
    const elsewhere = account.memberships.some(
      (m) => m.role === 'receptionist' && m.garageId !== garageId,
    );
    if (owner || (invite.kind === 'receptionist' && elsewhere)) throw invalid();
    const by = { id: actor.accountId, role: actor.role };
    await this.prisma.$transaction(async (tx) => {
      // The row lock makes a second accept wait, then find it taken.
      const { count } = await tx.staffInvite.updateMany({
        data: { status: 'accepted' },
        where: { id: invite.id, status: 'sent', tokenHash: hashToken(token) },
      });
      if (count === 0) throw invalid();
      await this.accounts.grantRole(tx, by, actor.accountId, invite.kind);
      if (invite.kind === 'receptionist') {
        await tx.garageMember.createMany({
          data: [
            { accountId: actor.accountId, garageId, role: 'receptionist' },
          ],
          skipDuplicates: true,
        });
      } else if (account.mechanic?.garageId !== garageId) {
        // A mechanic already here keeps the permissions the owner gave him.
        const before = account.mechanic;
        const row = await tx.mechanic.upsert({
          create: {
            accountId: actor.accountId,
            garageId,
            name: invite.name,
            ...permissionsOf(invite),
          },
          update: { garageId, ...permissionsOf(invite) },
          where: { accountId: actor.accountId },
        });
        if (before) {
          await this.events.record(tx, {
            audience: {
              garageIds: [garageId, before.garageId],
              type: 'garage',
            },
            kind: 'mechanic.updated',
            payload: { from: before.garageId, garageId, mechanicId: row.id },
            subjectId: row.id,
          });
        }
      }

      await this.audit.record(tx, {
        action: 'update',
        actorId: actor.accountId,
        actorRole: actor.role,
        field: 'status',
        garageId,
        kind: 'invite_accepted',
        newValue: 'accepted',
        oldValue: 'sent',
        subjectId: invite.id,
        subjectType: 'staff_invite',
      });
      await this.events.record(tx, {
        audience: { garageIds: [garageId], type: 'garage' },
        kind: 'invite.accepted',
        payload: {
          accountId: actor.accountId,
          garageId,
          inviteId: invite.id,
          kind: invite.kind,
        },
        subjectId: invite.id,
      });
    });
    await this.joined(invite, account.name);
  }

  // A sent invite whose link is this token, before its expiry, for a kind
  // the garage still takes.
  private async usable(token: string): Promise<StaffInvite> {
    const invite = await this.prisma.staffInvite.findUnique({
      where: { tokenHash: hashToken(token) },
    });
    if (invite?.status !== 'sent') throw invalid();
    if (invite.expiresAt <= this.now()) {
      throw refusal(
        HttpStatus.GONE,
        'invite_expired',
        'This invitation has expired',
      );
    }
    if (invite.kind === 'mechanic') await this.assertMechanics(invite.garageId);
    return invite;
  }

  // Only the owner decides; the garage's staff are told no, anyone else that
  // there is no such garage.
  private assertOwner(actor: Actor, garageId: string) {
    if (actor.garageId !== garageId) throw notFound();
    if (actor.role !== 'garage') {
      throw refusal(
        HttpStatus.FORBIDDEN,
        'forbidden',
        'Only the owner invites to the team',
      );
    }
  }

  private async ownInvite(actor: Actor, garageId: string, id: string) {
    this.assertOwner(actor, garageId);
    const invite = await this.prisma.staffInvite.findFirst({
      where: { garageId, id },
    });
    if (!invite) throw notFound();
    if (invite.status !== 'sent') throw invalid(HttpStatus.CONFLICT);
    return invite;
  }

  private async assertMechanics(garageId: string) {
    const off = await this.prisma.garageFeature.findFirst({
      where: { enabled: false, garageId, key: FEATURE },
    });
    if (off) throw featureOff();
  }

  // The owner, or someone who already holds this kind at the garage.
  private async assertNotInTeam(
    garageId: string,
    email: string,
    kind: StaffInvite['kind'],
  ) {
    const account = await this.prisma.account.findUnique({
      include: { mechanic: true, memberships: true },
      where: { email },
    });
    if (!account) return;
    const here = (role: 'owner' | 'receptionist') =>
      account.memberships.some(
        (m) => m.garageId === garageId && m.role === role,
      );
    const inTeam =
      here('owner') ||
      (kind === 'receptionist'
        ? here('receptionist')
        : account.mechanic?.garageId === garageId);
    if (inTeam) {
      throw refusal(
        HttpStatus.CONFLICT,
        'already_in_team',
        'This person is already in the team',
      );
    }
  }

  // The link needs an absolute address; without one nothing is stored, rather
  // than handing the owner a link that opens nowhere.
  private webUrl(): string {
    if (!this.config.webUrl) throw new Error('PUBLIC_WEB_URL is not set');
    return this.config.webUrl;
  }

  // In the owner's language. A refused e-mail leaves the invite in place and
  // hands the link to the owner instead.
  private async mail(
    actor: Actor,
    invite: StaffInvite,
    token: string,
  ): Promise<StaffInviteSentDto> {
    const [owner, garage] = await Promise.all([
      this.prisma.account.findUniqueOrThrow({ where: { id: actor.accountId } }),
      this.prisma.garage.findUniqueOrThrow({ where: { id: invite.garageId } }),
    ]);
    const language = owner.language === 'en' ? 'en' : 'ro';
    const webUrl = this.webUrl();
    const link = `${webUrl}/${language}/invite/${token}`;
    const reason = blockedReason(this.config, invite.email);
    try {
      if (reason) throw new Error(reason);
      const mail = render(`STAFF_INVITE.${invite.kind}`, 'email', language, {
        app: webUrl,
        garage: garage.name,
        link,
      });
      await this.brevo.send({
        from: this.config.from,
        html: mail.html,
        subject: mail.subject,
        text: mail.text,
        to: { email: invite.email, name: invite.name },
      });
      return { emailSent: true, id: invite.id };
    } catch (error) {
      this.logger.warn(
        `invite ${invite.id} e-mail not sent: ${(error as Error).message}`,
      );
      return { emailSent: false, id: invite.id, link };
    }
  }

  // The garage's owners hear who joined; a failure here undoes nothing.
  private async joined(invite: StaffInvite, name: string) {
    try {
      const [garage, owners] = await Promise.all([
        this.prisma.garage.findUniqueOrThrow({
          where: { id: invite.garageId },
        }),
        this.prisma.garageMember.findMany({
          where: { garageId: invite.garageId, role: 'owner' },
        }),
      ]);
      await this.notifications.notify({
        eventId: `invite.accepted:${invite.id}`,
        garageId: invite.garageId,
        kind: 'STAFF_JOINED',
        params: { garage: garage.name, name },
        recipients: owners.map((o) => o.accountId),
        subjectId: invite.id,
      });
    } catch (error) {
      this.logger.error(
        `invite ${invite.id} owner not told: ${(error as Error).message}`,
      );
    }
  }
}
