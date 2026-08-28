import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { describeAiError } from "@/lib/ai/client";
import { generateDebrief } from "@/lib/ai/tasks/debrief";
import { DecisionMadeSchema } from "@/lib/domain/schemas";
import { getDilemma } from "@/lib/store/kb";
import {
  completeSession,
  getSession,
  recordDecisions,
} from "@/lib/store/sessions";

/**
 * Closes a run: stores what the trainee did, then evaluates it against the
 * knowledge base.
 *
 * Decisions are written before the AI call, so a failure in the debrief loses
 * the assessment but never the record of what the trainee actually chose.
 */

export const maxDuration = 60;

const BodySchema = z.object({
  decisions: z.array(DecisionMadeSchema),
});

export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/api/sessions/[id]/complete">,
) {
  const { id } = await ctx.params;
  const parsed = BodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const session = await getSession(id);
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  await recordDecisions(id, parsed.data.decisions);

  const dilemma = await getDilemma(session.dilemma_entry_id);
  if (!dilemma) {
    return NextResponse.json(
      { error: "The dilemma this session was built from no longer exists." },
      { status: 409 },
    );
  }

  try {
    const debrief = await generateDebrief({
      dilemma,
      scenario: session.scenario_instance,
      decisions: parsed.data.decisions,
    });
    await completeSession(id, debrief);
    return NextResponse.json({ debrief });
  } catch (reason) {
    return NextResponse.json({ error: describeAiError(reason) }, { status: 502 });
  }
}
