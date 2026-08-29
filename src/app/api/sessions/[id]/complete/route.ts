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

/**
 * Every route that calls the model gets the long ceiling.
 *
 * A model call is the only thing here that takes minutes, and the platform
 * kills the function when this elapses. Raising the ceiling is not the same as
 * surviving a slow step, though: past about a minute it is the browser that
 * gives up, not the server. Measured against production this route stays well
 * inside that, so it answers in the request. The three that do not — extracting
 * a dilemma, generating a scenario and building a console — hand back a job
 * record instead and let the page ask how it is getting on. See
 * `lib/store/job.ts`.
 */
export const maxDuration = 300;

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

  const dilemma = await getDilemma(session.system_id, session.dilemma_entry_id);
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
