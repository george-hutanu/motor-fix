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

import { AUDIT_PORT, type AuditPort } from '../../audit/audit.port';
import { AccountsService } from '../../auth/accounts.service';
import {
  hashToken,
  newToken,
} from '../../auth/email-confirmation/email-confirmation';
import { refusal } from '../../auth/http-refusal';
import type { Actor } from '../../auth/policy';
import { PRISMA } from '../../auth/prisma';
import { EVENT_PORT, type EventPort } from '../../events/event.port';
import type {
  Prisma,
  PrismaClient,
  StaffInvite,
} from '../../generated/prisma/client';
import { Brevo } from '../../notifications/brevo/brevo';
import {
  blockedReason,
  type EmailConfig,
  emailEnvelope,
} from '../../notifications/email-config';
import { NotificationsService } from '../../notifications/notifications.service';
import {
  PHONE_CONFIG,
  type PhoneConfig,
  phoneBlockedReason,
} from '../../notifications/phone-config';
import { render } from '../../notifications/templates';
import { featureOn } from '../features/feature-on';
import { cardAudience } from '../mechanics/garage-mechanics.service';

export const INVITE_EMAIL = Symbol('INVITE_EMAIL');

const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const FEATURE = 'team_mechanics';

const notFound = () =>
  refusal(HttpStatus.NOT_FOUND, 'not_found', 'No such garage');
const invalid = (status = HttpStatus.GONE) =>
  refusal(status, 'invite_invalid', 'This invitation is no longer valid');
const conflict = (code: string, message: string) =>
  refusal(HttpStatus.CONFLICT, code, message);
const inviteOpen = (inviteId: string, message: string) =>
  new HttpException(
    { code: 'invite_open', inviteId, message },
    HttpStatus.CONFLICT,
  );
const featureOff = () =>
  refusal(
    HttpStatus.NOT_FOUND,
    'feature_off',
    'This garage does not take mechanics',
  );

type Address = { email: string } | { phone: string };

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
    @Inject(PHONE_CONFIG) private readonly phone: PhoneConfig,
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
    const card = dto.mechanicId
      ? await this.invitableCard(garageId, dto.mechanicId)
      : null;
    const address = dto.phone
      ? { phone: dto.phone }
      : { email: (dto.email ?? '').toLowerCase() };
    await this.assertNotSelf(actor, address);
    await this.assertNotInTeam(garageId, address, dto.kind);
    const open = await this.prisma.staffInvite.findFirst({
      where: {
        ...address,
        expiresAt: { gt: this.now() },
        garageId,
        status: 'sent',
      },
    });
    if (open) {
      throw inviteOpen(open.id, 'This address already has an open invitation');
    }
    const mechanic = dto.kind === 'mechanic';
    this.webUrl();
    const { hash, token } = newToken();
    const invite = await this.prisma.$transaction(async (tx) => {
      // The card's earlier invites have all expired by now: one card, one
      // live link.
      if (card) {
        await tx.staffInvite.updateMany({
          data: { status: 'revoked' },
          where: { mechanicId: card.id, status: 'sent' },
        });
      }
      const row = await tx.staffInvite.create({
        data: {
          ...address,
          canAnswerQuotes: mechanic && dto.canAnswerQuotes,
          canMoveBookings: mechanic && dto.canMoveBookings,
          canRecordFinalPrice: mechanic && dto.canRecordFinalPrice,
          expiresAt: new Date(this.now().getTime() + TTL_MS),
          garageId,
          kind: dto.kind,
          mechanicId: card?.id ?? null,
          name: card?.name ?? dto.name ?? '',
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
    return this.deliver(actor, invite, token);
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
    return this.deliver(actor, invite, token);
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

  // What the link offers, or why it offers nothing; with a session, also the
  // garage the account works at, which accepting a mechanic invite leaves.
  async check(token: string, actor?: Actor): Promise<InviteViewDto> {
    const invite = await this.usable(token);
    const garage = await this.prisma.garage.findUniqueOrThrow({
      where: { id: invite.garageId },
    });
    const current =
      actor && invite.kind === 'mechanic'
        ? await this.prisma.mechanic.findUnique({
            select: { garage: { select: { name: true } }, garageId: true },
            where: { accountId: actor.accountId },
          })
        : null;
    return {
      email: invite.email,
      garage: garage.name,
      kind: invite.kind,
      leaving:
        current && current.garageId !== invite.garageId
          ? current.garage.name
          : null,
      name: invite.name,
      phone: invite.phone,
    };
  }

  // The signed-in account joins the garage in the invite's role; the web
  // switches its session to that role once this answers. An invite for a
  // card links the account to that card.
  async accept(actor: Actor, token: string): Promise<void> {
    const invite = await this.usable(token);
    const { garageId } = invite;
    const account = await this.prisma.account.findUniqueOrThrow({
      include: { memberships: true },
      where: { id: actor.accountId },
    });
    const owner = account.memberships.some(
      (m) => m.role === 'owner' && m.garageId === garageId,
    );
    const elsewhere = account.memberships.some(
      (m) => m.role === 'receptionist' && m.garageId !== garageId,
    );
    if (owner || (invite.kind === 'receptionist' && elsewhere)) {
      throw invalid();
    }
    const by = { id: actor.accountId, role: actor.role };
    const name = await this.prisma.$transaction(async (tx) => {
      // The row lock makes a second accept wait, then find it taken.
      const { count } = await tx.staffInvite.updateMany({
        data: { status: 'accepted' },
        where: { id: invite.id, status: 'sent', tokenHash: hashToken(token) },
      });
      if (count === 0) throw invalid();
      await this.accounts.grantRole(tx, by, actor.accountId, invite.kind);
      const joinedAs =
        invite.kind === 'receptionist'
          ? await this.joinFrontDesk(tx, invite, actor.accountId, account.name)
          : await this.joinWorkshop(tx, invite, actor.accountId, account.name);
      await this.audit.record(tx, {
        action: 'update',
        actorId: actor.accountId,
        actorRole: actor.role,
        field: 'status',
        garageId,
        kind: 'invite_accepted',
        newValue: {
          kind: invite.kind,
          ...(invite.mechanicId ? { mechanicId: invite.mechanicId } : {}),
          name: invite.name,
          permissions: permissionsOf(invite),
        },
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
      return joinedAs;
    });
    await this.joined(invite, name);
  }

  private async joinFrontDesk(
    tx: Prisma.TransactionClient,
    invite: StaffInvite,
    accountId: string,
    name: string,
  ): Promise<string> {
    await tx.garageMember.createMany({
      data: [{ accountId, garageId: invite.garageId, role: 'receptionist' }],
      skipDuplicates: true,
    });
    return name;
  }

  // The account's mechanic row is read under its lock, after the invite is
  // taken: a concurrent accept that moved it has committed by then, so the
  // move's `from` is the garage the row is really at.
  private async joinWorkshop(
    tx: Prisma.TransactionClient,
    invite: StaffInvite,
    accountId: string,
    name: string,
  ): Promise<string> {
    const { garageId } = invite;
    const [before] = await tx.$queryRaw<
      { garageId: string; isOwner: boolean }[]
    >`SELECT garage_id AS "garageId", is_owner AS "isOwner" FROM mechanic
      WHERE account_id = ${accountId}::uuid FOR UPDATE`;
    // An owner's own row is his garage's: a mechanic link from another
    // garage would move it away.
    if (before?.isOwner) throw invalid();
    if (invite.mechanicId) return this.link(tx, invite, accountId, before);
    // A mechanic already here keeps the permissions the owner gave him.
    if (before?.garageId === garageId) return name;
    const row = await tx.mechanic.upsert({
      create: {
        accountId,
        garageId,
        name: invite.name,
        ...permissionsOf(invite),
      },
      update: { garageId, ...permissionsOf(invite) },
      where: { accountId },
    });
    if (before) {
      await this.events.record(tx, {
        audience: { garageIds: [garageId, before.garageId], type: 'garage' },
        kind: 'mechanic.updated',
        payload: { from: before.garageId, garageId, mechanicId: row.id },
        subjectId: row.id,
      });
    }
    return name;
  }

  // The card becomes the account's, on the profile with the invite's
  // permissions; its other fields stay as the owner wrote them. An account
  // working at another garage would have to move, which is not offered yet.
  private async link(
    tx: Prisma.TransactionClient,
    invite: StaffInvite,
    accountId: string,
    before: { garageId: string } | undefined,
  ): Promise<string> {
    const { garageId } = invite;
    const mechanicId = invite.mechanicId as string;
    if (before?.garageId === garageId) throw invalid();
    if (before) {
      const { name } = await tx.garage.findUniqueOrThrow({
        select: { name: true },
        where: { id: before.garageId },
      });
      throw new HttpException(
        {
          code: 'move_required',
          garage: name,
          message: 'The account works at another garage',
        },
        HttpStatus.CONFLICT,
      );
    }
    const { count } = await tx.mechanic.updateMany({
      data: { accountId, onProfile: true, ...permissionsOf(invite) },
      where: { accountId: null, garageId, id: mechanicId, removedAt: null },
    });
    if (count === 0) throw invalid();
    await this.events.record(tx, {
      audience: cardAudience(garageId, { id: mechanicId, onProfile: true }),
      kind: 'mechanic.updated',
      payload: { fields: ['account'], garageId, mechanicId },
      subjectId: mechanicId,
    });
    const card = await tx.mechanic.findUniqueOrThrow({
      select: { name: true },
      where: { id: mechanicId },
    });
    return card.name;
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
    if (!(await featureOn(this.prisma, garageId, FEATURE))) throw featureOff();
  }

  // A card of this garage, still on the team, that no account holds and no
  // live invite names.
  private async invitableCard(garageId: string, mechanicId: string) {
    const card = await this.prisma.mechanic.findFirst({
      where: { garageId, id: mechanicId, removedAt: null },
    });
    if (!card) throw notFound();
    if (card.isOwner) {
      throw conflict('owner_row', "The owner's own row takes no invite");
    }
    if (card.accountId) {
      throw conflict('card_linked', 'This card already has an account');
    }
    const open = await this.prisma.staffInvite.findFirst({
      where: { expiresAt: { gt: this.now() }, mechanicId, status: 'sent' },
    });
    if (open) {
      throw inviteOpen(open.id, 'This card already has an open invitation');
    }
    return card;
  }

  private async assertNotSelf(actor: Actor, address: Address) {
    const own = await this.prisma.account.findUniqueOrThrow({
      select: { email: true, phone: true },
      where: { id: actor.accountId },
    });
    const self =
      'phone' in address
        ? own.phone === address.phone
        : own.email?.toLowerCase() === address.email;
    if (self) throw conflict('self_invite', 'You cannot invite yourself');
  }

  // Someone who already holds this kind at the garage, or owns it.
  private async assertNotInTeam(
    garageId: string,
    address: Address,
    kind: StaffInvite['kind'],
  ) {
    const account = await this.prisma.account.findFirst({
      include: { mechanic: true, memberships: true },
      where: address,
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
      throw conflict('already_in_team', 'This person is already in the team');
    }
  }

  // The link needs an absolute address; without one nothing is stored, rather
  // than handing the owner a link that opens nowhere.
  private webUrl(): string {
    if (!this.config.webUrl) throw new Error('PUBLIC_WEB_URL is not set');
    return this.config.webUrl;
  }

  // In the owner's language, by e-mail or by WhatsApp. A message that did not
  // go leaves the invite in place and hands the link to the owner instead.
  private async deliver(
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
    const values = { app: webUrl, garage: garage.name, link };
    try {
      if (invite.phone) {
        await this.whatsapp(invite, invite.phone, language, values);
      } else {
        await this.mail(invite, invite.email ?? '', language, values);
      }
      return { emailSent: true, id: invite.id };
    } catch (error) {
      this.logger.warn(
        `invite ${invite.id} not sent: ${(error as Error).message}`,
      );
      return { emailSent: false, id: invite.id, link };
    }
  }

  private async mail(
    invite: StaffInvite,
    email: string,
    language: 'ro' | 'en',
    values: Record<string, string>,
  ) {
    const reason = blockedReason(this.config, email);
    if (reason) throw new Error(reason);
    const mail = render(
      `STAFF_INVITE.${invite.kind}`,
      'email',
      language,
      values,
    );
    await this.brevo.send({
      ...emailEnvelope(this.config, { email, name: invite.name }),
      html: mail.html,
      subject: mail.subject,
      text: mail.text,
    });
  }

  // Straight through Brevo, as the e-mail is: the owner waits for the answer.
  // The number never reaches the log.
  private async whatsapp(
    invite: StaffInvite,
    to: string,
    language: 'ro' | 'en',
    values: Record<string, string>,
  ) {
    const reason = phoneBlockedReason(this.phone, to);
    if (reason) throw new Error(reason);
    const message = render(
      `STAFF_INVITE.${invite.kind}`,
      'whatsapp',
      language,
      values,
    );
    const templateId = Object.hasOwn(this.phone.whatsappTemplates, message.name)
      ? this.phone.whatsappTemplates[message.name]
      : undefined;
    if (templateId === undefined) throw new Error('template_missing');
    await this.brevo.sendWhatsApp({
      params: message.params,
      sender: this.phone.whatsappSender,
      templateId,
      to,
    });
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
