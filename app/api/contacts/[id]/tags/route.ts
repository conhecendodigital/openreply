import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { fail, ok, readJson, requireContext } from "@/lib/api-helpers";
import { addTag, MAX_TAG_LENGTH, removeTag } from "@/lib/contacts/record";

export const dynamic = "force-dynamic";

type RouteProps = { params: Promise<{ id: string }> };

const tagList = z.array(z.string().trim().min(1).max(MAX_TAG_LENGTH)).max(20);
const schema = z
  .object({ add: tagList.optional(), remove: tagList.optional() })
  .refine((v) => (v.add?.length ?? 0) + (v.remove?.length ?? 0) > 0, {
    message: "Nothing to add or remove",
  });

// Manual tags. Add and remove both go through POST (the MCP bridge has no
// DELETE).
export async function POST(request: NextRequest, { params }: RouteProps) {
  const auth = await requireContext();
  if ("response" in auth) return auth.response;
  const { id } = await params;

  const parsed = schema.safeParse(await readJson(request));
  if (!parsed.success) return fail("Invalid request", 400, parsed.error.issues);

  const contact = await prisma.contact.findFirst({
    where: { id, workspaceId: auth.context.workspaceId },
    select: { id: true, workspaceId: true },
  });
  if (!contact) return fail("Contact not found", 404);

  const added: string[] = [];
  const removed: string[] = [];
  for (const name of parsed.data.remove ?? []) {
    if (await removeTag(contact, name)) removed.push(name);
  }
  for (const name of parsed.data.add ?? []) {
    if (await addTag(contact, name, "manual")) added.push(name);
  }

  const tags = await prisma.contactTag.findMany({
    where: { contactId: contact.id },
    select: { name: true, source: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  return ok({ id: contact.id, added, removed, tags });
}
