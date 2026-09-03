import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { ScenarioDraftSchema } from "@/lib/domain/schemas";
import { createScenarioDraft, getSystem, listScenarios } from "@/lib/store/kb";

/** The scenarios taught inside one simulated system. */

const CreateSchema = z.object({
  draft: ScenarioDraftSchema,
  /** The conversation this was extracted from, kept for later audit. */
  transcript: z.string(),
});

export async function GET(
  _request: NextRequest,
  ctx: RouteContext<"/api/systems/[systemId]/scenarios">,
) {
  const { systemId } = await ctx.params;
  return NextResponse.json({ scenarios: await listScenarios(systemId) });
}

export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/api/systems/[systemId]/scenarios">,
) {
  const { systemId } = await ctx.params;
  if (!(await getSystem(systemId))) {
    return NextResponse.json({ error: "System not found" }, { status: 404 });
  }

  const parsed = CreateSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid scenario", issues: z.treeifyError(parsed.error) },
      { status: 400 },
    );
  }

  try {
    const entry = await createScenarioDraft(
      systemId,
      parsed.data.draft,
      parsed.data.transcript,
    );
    return NextResponse.json({ entry }, { status: 201 });
  } catch (reason) {
    return NextResponse.json({ error: describe(reason) }, { status: 500 });
  }
}

function describe(reason: unknown): string {
  return reason instanceof Error ? reason.message : "Failed to save the scenario.";
}
