import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { fail, ok, readJson, requireContext } from "@/lib/api-helpers";
import { getApiCaller } from "@/lib/auth";
import {
  MAX_SEQUENCE_STEPS,
  MAX_SEQUENCE_TOTAL_MIN,
  MAX_STEP_DELAY_MIN,
  MAX_STEP_MESSAGE,
  MIN_STEP_DELAY_MIN,
  validateSequenceSteps,
} from "@/lib/sequences/validate";

export const dynamic = "force-dynamic";

type RouteProps = { params: Promise<{ id: string }> };

const LIMITS = {
  maxSteps: MAX_SEQUENCE_STEPS,
  minDelayMinutes: MIN_STEP_DELAY_MIN,
  maxDelayMinutes: MAX_STEP_DELAY_MIN,
  maxTotalMinutes: MAX_SEQUENCE_TOTAL_MIN,
  maxMessage: MAX_STEP_MESSAGE,
};

async function findAutomation(id: string, workspaceId: string) {
  return prisma.automation.findFirst({ where: { id, workspaceId }, select: { id: true, workspaceId: true } });
}

async function load(automationId: string) {
  const sequence = await prisma.sequence.findUnique({
    where: { automationId },
    include: { steps: { orderBy: { order: "asc" } } },
  });
  if (!sequence) return { isActive: false, steps: [], stats: null };
  const grouped = await prisma.sequenceEnrollment.groupBy({
    by: ["status"],
    where: { sequenceId: sequence.id },
    _count: { _all: true },
  });
  const stats = Object.fromEntries(grouped.map((g) => [g.status, g._count._all]));
  return {
    id: sequence.id,
    isActive: sequence.isActive,
    steps: sequence.steps.map((s) => ({ order: s.order, message: s.message, delayMinutes: s.delayMinutes })),
    stats,
  };
}

// The campaign's sequence: steps (message + wait in minutes) sent after the
// link, only while the person's 24-hour window is open; stops when they reply.
export async function GET(_request: NextRequest, { params }: RouteProps) {
  const auth = await requireContext();
  if ("response" in auth) return auth.response;
  const { id } = await params;
  const automation = await findAutomation(id, auth.context.workspaceId);
  if (!automation) return fail("Campaign not found", 404);
  return ok({ ...(await load(automation.id)), limits: LIMITS });
}

const putSchema = z.object({
  isActive: z.boolean().optional(),
  steps: z
    .array(z.object({ message: z.string().max(MAX_STEP_MESSAGE), delayMinutes: z.number().int() }))
    .max(MAX_SEQUENCE_STEPS)
    .optional(),
});

// Replace the steps and/or turn the sequence on or off. A new sequence starts
// off. People already enrolled keep going with the new steps (by order).
export async function PUT(request: NextRequest, { params }: RouteProps) {
  const auth = await requireContext({ manage: true });
  if ("response" in auth) return auth.response;
  // Owner's rule: steps go out automatically, so their text is written (or
  // approved) by a human in the Lead Engine. An API key (the AI's MCP key)
  // cannot write or turn on a sequence.
  if ((await getApiCaller()).kind === "token") {
    return fail("API keys cannot change sequences. Edit them in the Lead Engine.", 403, { code: "human_only" });
  }
  const { id } = await params;
  const automation = await findAutomation(id, auth.context.workspaceId);
  if (!automation) return fail("Campaign not found", 404);

  const parsed = putSchema.safeParse(await readJson(request));
  if (!parsed.success) return fail("Invalid sequence", 400, parsed.error.issues);
  const input = parsed.data;

  if (input.steps) {
    const errors = validateSequenceSteps(input.steps);
    if (errors.length > 0) return fail("Invalid sequence", 400, errors);
  }

  await prisma.$transaction(async (tx) => {
    const sequence = await tx.sequence.upsert({
      where: { automationId: automation.id },
      create: { workspaceId: automation.workspaceId, automationId: automation.id, isActive: false },
      update: {},
      select: { id: true },
    });
    if (input.steps) {
      await tx.sequenceStep.deleteMany({ where: { sequenceId: sequence.id } });
      if (input.steps.length > 0) {
        await tx.sequenceStep.createMany({
          data: input.steps.map((s, i) => ({
            sequenceId: sequence.id,
            order: i + 1,
            message: s.message.trim(),
            delayMinutes: s.delayMinutes,
          })),
        });
      }
    }
    const stepCount = await tx.sequenceStep.count({ where: { sequenceId: sequence.id } });
    if (input.isActive !== undefined || stepCount === 0) {
      await tx.sequence.update({
        where: { id: sequence.id },
        // A sequence without steps can never be on.
        data: { isActive: stepCount > 0 ? (input.isActive ?? false) : false },
      });
    }
  });

  return ok({ ...(await load(automation.id)), limits: LIMITS });
}
