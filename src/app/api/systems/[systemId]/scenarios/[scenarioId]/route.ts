import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { ScenarioDraftSchema } from "@/lib/domain/schemas";
import { deleteScenario, getScenario, saveScenario } from "@/lib/store/kb";

/** Single scenario entry inside a system: read, edit, delete. */

type Ctx = RouteContext<"/api/systems/[systemId]/scenarios/[scenarioId]">;

const UpdateSchema = z.object({ draft: ScenarioDraftSchema });

export async function GET(_request: NextRequest, ctx: Ctx) {
  const { systemId, scenarioId } = await ctx.params;
  const entry = await getScenario(systemId, scenarioId);
  if (!entry) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ entry });
}

export async function PUT(request: NextRequest, ctx: Ctx) {
  const { systemId, scenarioId } = await ctx.params;
  const parsed = UpdateSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid scenario", issues: z.treeifyError(parsed.error) },
      { status: 400 },
    );
  }

  const existing = await getScenario(systemId, scenarioId);
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    // Identity, status and provenance stay server-owned: an edit revises the
    // content of an entry, it never re-approves, re-identifies or moves it to
    // another system.
    const updated = { ...existing, ...parsed.data.draft };
    await saveScenario(updated);
    return NextResponse.json({ entry: updated });
  } catch (reason) {
    return NextResponse.json({ error: describe(reason) }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, ctx: Ctx) {
  const { systemId, scenarioId } = await ctx.params;
  try {
    await deleteScenario(systemId, scenarioId);
    return NextResponse.json({ ok: true });
  } catch (reason) {
    return NextResponse.json({ error: describe(reason) }, { status: 500 });
  }
}

function describe(reason: unknown): string {
  return reason instanceof Error ? reason.message : "Failed to update the scenario.";
}
