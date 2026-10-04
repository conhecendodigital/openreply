import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { isApiTokenRequest } from "@/lib/auth";
import {
  buildInvitationUrl,
  generateInvitationToken,
  getInvitationExpiry,
  normalizeInvitationEmail,
} from "@/lib/workspace-invitations";
import {
  canManageWorkspace,
  getCurrentWorkspaceContext,
} from "@/lib/workspace-access";

const inviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(["ADMIN", "MEMBER"]).default("MEMBER"),
});

const updateMemberSchema = z.object({
  memberId: z.string().min(1),
  role: z.enum(["ADMIN", "MEMBER"]),
});

const deleteSchema = z.object({
  memberId: z.string().min(1).optional(),
  invitationId: z.string().min(1).optional(),
});

// Members are managed from a signed-in session only. An API key acts as the
// owner, so if it could invite people it would turn itself into a human
// admin and get past every "only a human does this" rule.
async function blockApiKey() {
  if (await isApiTokenRequest()) {
    return NextResponse.json(
      { success: false, error: "API keys cannot manage members", code: "human_only" },
      { status: 403 }
    );
  }
  return null;
}

async function getMemberPayload(
  workspaceId: string,
  currentUserRole?: "OWNER" | "ADMIN" | "MEMBER",
  options: { hideInviteLinks?: boolean } = {}
) {
  const [members, invitations] = await Promise.all([
    prisma.workspaceMember.findMany({
      where: { workspaceId },
      orderBy: [{ role: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        role: true,
        createdAt: true,
        user: {
          select: {
            id: true,
            email: true,
            name: true,
          },
        },
      },
    }),
    prisma.workspaceInvitation.findMany({
      where: { workspaceId, status: "PENDING" },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        email: true,
        role: true,
        token: true,
        expiresAt: true,
        createdAt: true,
      },
    }),
  ]);

  return {
    ...(currentUserRole ? { currentUserRole } : {}),
    members,
    invitations: invitations.map(({ token, ...invitation }) =>
      // The invite link lets anyone join: never hand it to an API key.
      options.hideInviteLinks
        ? invitation
        : { ...invitation, token, inviteUrl: buildInvitationUrl(token) }
    ),
  };
}

export async function GET() {
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  return NextResponse.json({
    success: true,
    data: {
      ...(await getMemberPayload(context.workspaceId, context.role, {
        hideInviteLinks: await isApiTokenRequest(),
      })),
    },
  });
}

export async function POST(request: NextRequest) {
  const blocked = await blockApiKey();
  if (blocked) return blocked;
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }
  if (!canManageWorkspace(context.role)) {
    return NextResponse.json(
      { success: false, error: "Only owners and admins can invite members" },
      { status: 403 }
    );
  }

  const body = await request.json();
  const parsed = inviteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "Invalid invitation", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const email = normalizeInvitationEmail(parsed.data.email);
  const existingUser = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });

  if (existingUser) {
    // Re-inviting someone who is already in can change their role, but never
    // the owner's (or the caller's own): that would let an admin demote the
    // owner. Role changes of other members go through PATCH, which has the
    // same rule.
    const current = await prisma.workspaceMember.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId: context.workspaceId,
          userId: existingUser.id,
        },
      },
      select: { role: true },
    });
    if (current?.role === "OWNER" || existingUser.id === context.userId) {
      return NextResponse.json(
        { success: false, error: "Member cannot be updated" },
        { status: 400 }
      );
    }
    await prisma.workspaceMember.upsert({
      where: {
        workspaceId_userId: {
          workspaceId: context.workspaceId,
          userId: existingUser.id,
        },
      },
      create: {
        workspaceId: context.workspaceId,
        userId: existingUser.id,
        role: parsed.data.role,
      },
      update: {
        role: parsed.data.role,
      },
    });
  } else {
    await prisma.workspaceInvitation.upsert({
      where: {
        workspaceId_email: {
          workspaceId: context.workspaceId,
          email,
        },
      },
      create: {
        workspaceId: context.workspaceId,
        email,
        role: parsed.data.role,
        token: generateInvitationToken(),
        invitedByUserId: context.userId,
        expiresAt: getInvitationExpiry(),
      },
      update: {
        role: parsed.data.role,
        status: "PENDING",
        token: generateInvitationToken(),
        invitedByUserId: context.userId,
        expiresAt: getInvitationExpiry(),
      },
    });
  }

  return NextResponse.json({
    success: true,
    data: await getMemberPayload(context.workspaceId, context.role),
  });
}

export async function PATCH(request: NextRequest) {
  const blocked = await blockApiKey();
  if (blocked) return blocked;
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }
  if (!canManageWorkspace(context.role)) {
    return NextResponse.json(
      { success: false, error: "Only owners and admins can update roles" },
      { status: 403 }
    );
  }

  const parsed = updateMemberSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "Invalid member update" },
      { status: 400 }
    );
  }

  const member = await prisma.workspaceMember.findFirst({
    where: { id: parsed.data.memberId, workspaceId: context.workspaceId },
  });
  if (!member || member.role === "OWNER") {
    return NextResponse.json(
      { success: false, error: "Member cannot be updated" },
      { status: 400 }
    );
  }

  await prisma.workspaceMember.update({
    where: { id: member.id },
    data: { role: parsed.data.role },
  });

  return NextResponse.json({
    success: true,
    data: await getMemberPayload(context.workspaceId, context.role),
  });
}

export async function DELETE(request: NextRequest) {
  const blocked = await blockApiKey();
  if (blocked) return blocked;
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }
  if (!canManageWorkspace(context.role)) {
    return NextResponse.json(
      { success: false, error: "Only owners and admins can remove members" },
      { status: 403 }
    );
  }

  const parsed = deleteSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success || (!parsed.data.memberId && !parsed.data.invitationId)) {
    return NextResponse.json(
      { success: false, error: "Missing member or invitation ID" },
      { status: 400 }
    );
  }

  if (parsed.data.memberId) {
    const member = await prisma.workspaceMember.findFirst({
      where: { id: parsed.data.memberId, workspaceId: context.workspaceId },
    });
    if (!member || member.role === "OWNER" || member.userId === context.userId) {
      return NextResponse.json(
        { success: false, error: "Member cannot be removed" },
        { status: 400 }
      );
    }

    await prisma.workspaceMember.delete({ where: { id: member.id } });
  }

  if (parsed.data.invitationId) {
    await prisma.workspaceInvitation.updateMany({
      where: {
        id: parsed.data.invitationId,
        workspaceId: context.workspaceId,
        status: "PENDING",
      },
      data: { status: "REVOKED" },
    });
  }

  return NextResponse.json({
    success: true,
    data: await getMemberPayload(context.workspaceId, context.role),
  });
}
