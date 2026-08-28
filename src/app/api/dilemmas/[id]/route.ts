import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { DilemmaDraftSchema } from "@/lib/domain/schemas";
import { deleteDilemma, getDilemma, saveDilemma } from "@/lib/store/kb";

/** Single dilemma entry: read, edit, delete. */

const UpdateSchema = z.object({ draft: DilemmaDraftSchema });

export async function GET(_request: NextRequest, ctx: RouteContext<"/api/dilemmas/[id]">) {
  const { id } = await ctx.params;
  const entry = await getDilemma(id);
  if (!entry) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ entry });
}

export async function PUT(request: NextRequest, ctx: RouteContext<"/api/dilemmas/[id]">) {
  const { id } = await ctx.params;
  const parsed = UpdateSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid dilemma", issues: z.treeifyError(parsed.error) },
      { status: 400 },
    );
  }

  const existing = await getDilemma(id);
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    // Identity, status and provenance stay server-owned: an edit revises the
    // content of an entry, it never re-approves or re-identifies it.
    const updated = { ...existing, ...parsed.data.draft };
    await saveDilemma(updated);
    return NextResponse.json({ entry: updated });
  } catch (reason) {
    return NextResponse.json({ error: describe(reason) }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, ctx: RouteContext<"/api/dilemmas/[id]">) {
  const { id } = await ctx.params;
  try {
    await deleteDilemma(id);
    return NextResponse.json({ ok: true });
  } catch (reason) {
    return NextResponse.json({ error: describe(reason) }, { status: 500 });
  }
}

function describe(reason: unknown): string {
  return reason instanceof Error ? reason.message : "Failed to update the dilemma.";
}
