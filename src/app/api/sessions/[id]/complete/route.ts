import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { describeAiError } from "@/lib/ai/client";
import { generateDebrief } from "@/lib/ai/tasks/debrief";
import { RunResultSchema, SimEventSchema } from "@/lib/domain/schemas";
import { getScenario } from "@/lib/store/kb";
import { completeSession, getSession, recordRun } from "@/lib/store/sessions";

/**
 * Closes a run: stores what happened, then has it assessed.
 *
 * The log and the tally are written before the model is called, so a failure
 * in the debrief costs the assessment and never the record of what the
 * operator actually did — which is the part that cannot be reconstructed.
 *
 * The tally arrives from the browser, computed by the same engine that
 * enforced the rules during the run. That is deliberate: recomputing it here
 * would mean running the whole simulation again server-side to reach an answer
 * the client already has, and the two could then disagree. What stops it being
 * a trust problem is that nothing downstream is a reward — the figures feed a
 * debrief the trainee reads about themselves.
 */

/**
 * Every route that calls the model gets the long ceiling.
 *
 * A model call is the only thing here that takes minutes, and the platform
 * kills the function when this elapses. Raising the ceiling is not the same as
 * surviving a slow step, though: past about a minute it is the browser that
 * gives up, not the server. Measured against production this route stays well
 * inside that, so it answers in the request. The three that do not — extracting
 * a scenario, generating an exercise and building a console — hand back a job
 * record instead and let the page ask how it is getting on. See
 * `lib/store/job.ts`.
 */
export const maxDuration = 300;

const BodySchema = z.object({
  /** Everything that happened, in order, as the engine recorded it. */
  run_log: z.array(SimEventSchema),
  /** What it added up to, counted by the engine rather than judged. */
  run_result: RunResultSchema,
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

  await recordRun(id, parsed.data.run_log, parsed.data.run_result);

  const scenario = await getScenario(session.system_id, session.scenario_entry_id);
  if (!scenario) {
    return NextResponse.json(
      { error: "The scenario this session was built from no longer exists." },
      { status: 409 },
    );
  }

  try {
    const debrief = await generateDebrief({
      scenario,
      exercise: session.exercise_instance,
      log: parsed.data.run_log,
      result: parsed.data.run_result,
      // What they came for. An assessment that never refers to it is an
      // assessment of a run nobody asked for.
      requested: {
        text: session.requested_text,
        clarifications: session.clarification_rounds,
      },
    });
    await completeSession(id, debrief);
    return NextResponse.json({ debrief });
  } catch (reason) {
    return NextResponse.json({ error: describeAiError(reason) }, { status: 502 });
  }
}
