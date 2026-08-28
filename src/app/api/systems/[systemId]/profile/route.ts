import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
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

  // Everything downstream reads these three lists. A profile missing any of
  // them cannot drive a console or a scenario, so approval is refused rather
  // than left to fail later in a way nobody can trace.
  if (parsed.data.approved) {
    const gaps: string[] = [];
    if (draft.track_classifications.length === 0) gaps.push("track classifications");
    if (draft.iff_states.length === 0) gaps.push("identification states");
    if (draft.track_readout_fields.length === 0) gaps.push("track readout fields");

    if (gaps.length > 0) {
      return NextResponse.json(
        {
          error: `Cannot approve: the profile has no ${gaps.join(", no ")}. Scenarios and the console are built from these.`,
        },
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
