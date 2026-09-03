import { NextResponse, type NextRequest } from "next/server";
import { approveScenario } from "@/lib/store/kb";

/**
 * Approval is the one gate in the system: until an entry is approved it is
 * invisible to trainees. Per the brief it happens once, at knowledge-base
 * level — there is no per-run approval step.
 */
export async function POST(
  _request: NextRequest,
  ctx: RouteContext<"/api/systems/[systemId]/scenarios/[scenarioId]/approve">,
) {
  const { systemId, scenarioId } = await ctx.params;
  try {
    const entry = await approveScenario(systemId, scenarioId);
    if (!entry) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ entry });
  } catch (reason) {
    return NextResponse.json(
      { error: reason instanceof Error ? reason.message : "Failed to approve." },
      { status: 500 },
    );
  }
}
