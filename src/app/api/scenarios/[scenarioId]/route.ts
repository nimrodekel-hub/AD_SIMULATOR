import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { RevisionSchema, ScenarioInstanceSchema } from "@/lib/domain/schemas";
import { getSavedScenario, saveScenario } from "@/lib/store/scenarios";

/** One exercise in the library: read it, or accept a correction to it. */

const AcceptSchema = z.object({
  system_id: z.string().min(1),
  scenario_instance: ScenarioInstanceSchema,
  revisions: z.array(RevisionSchema).default([]),
});

export async function GET(
  _request: NextRequest,
  ctx: RouteContext<"/api/scenarios/[scenarioId]">,
) {
  const { scenarioId } = await ctx.params;
  const systemId = new URL(_request.url).searchParams.get("system") ?? "";
  return NextResponse.json({
    scenario: systemId ? await getSavedScenario(systemId, scenarioId) : null,
  });
}

export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/api/scenarios/[scenarioId]">,
) {
  const { scenarioId } = await ctx.params;
  const parsed = AcceptSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid exercise" }, { status: 400 });
  }

  const existing = await getSavedScenario(parsed.data.system_id, scenarioId);
  if (!existing) {
    return NextResponse.json({ error: "Exercise not found" }, { status: 404 });
  }

  const updated = {
    ...existing,
    scenario_instance: parsed.data.scenario_instance,
    revisions: parsed.data.revisions,
    updated_at: new Date().toISOString(),
  };

  try {
    await saveScenario(updated, `Accept correction to ${scenarioId.slice(0, 8)}`);
    return NextResponse.json({ scenario: updated });
  } catch (reason) {
    return NextResponse.json(
      { error: reason instanceof Error ? reason.message : "Failed to save." },
      { status: 500 },
    );
  }
}
