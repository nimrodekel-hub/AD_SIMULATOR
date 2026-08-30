import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { gapMessage, simulationGaps } from "@/lib/domain/profile-readiness";
import { SystemProfileDraftSchema } from "@/lib/domain/schemas";
import { getSystem, getSystemProfile, saveSystemProfile } from "@/lib/store/kb";
import type { SystemProfile } from "@/lib/domain/schemas";

/** One system's behaviour profile: read, save, approve. */

const SaveSchema = z.object({
  draft: SystemProfileDraftSchema,
  source_answers: z.array(
    z.object({ question: z.string(), answer: z.string() }),
  ),
  approved: z.boolean(),
});

export async function GET(
  _request: NextRequest,
  ctx: RouteContext<"/api/systems/[systemId]/profile">,
) {
  const { systemId } = await ctx.params;
  return NextResponse.json({ profile: await getSystemProfile(systemId) });
}

export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/api/systems/[systemId]/profile">,
) {
  const { systemId } = await ctx.params;
  const system = await getSystem(systemId);
  if (!system) {
    return NextResponse.json({ error: "System not found" }, { status: 404 });
  }

  const parsed = SaveSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid profile", issues: z.treeifyError(parsed.error) },
      { status: 400 },
    );
  }

  const { draft } = parsed.data;

  // Approval is what puts a profile in front of trainees, so it is where the
  // figures the simulation runs on stop being optional. The form refuses
  // first and says exactly what is missing; this refuses again, because a tab
  // left open since before the rule existed would otherwise walk straight
  // past it. Saving a draft stays open — a draft is work in progress and
  // drives nothing.
  if (parsed.data.approved) {
    const gaps = simulationGaps(draft);
    if (gaps.length > 0) {
      return NextResponse.json(
        { error: gapMessage(gaps), gaps },
        { status: 409 },
      );
    }
  }

  const existing = await getSystemProfile(systemId);
  const profile: SystemProfile = {
    ...draft,
    // One profile per system, so they share an id. Nothing has to be looked up
    // to know which system a profile describes.
    id: systemId,
    approved: parsed.data.approved,
    source_answers: parsed.data.source_answers,
    created_at: existing?.created_at ?? new Date().toISOString(),
    approved_at: parsed.data.approved ? new Date().toISOString() : null,
  };

  try {
    await saveSystemProfile(systemId, profile, system.name);
    return NextResponse.json({ profile });
  } catch (reason) {
    return NextResponse.json(
      { error: reason instanceof Error ? reason.message : "Failed to save." },
      { status: 500 },
    );
  }
}
