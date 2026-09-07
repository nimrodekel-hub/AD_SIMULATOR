import { NextResponse, after, type NextRequest } from "next/server";
import { z } from "zod";
import { describeAiError } from "@/lib/ai/client";
import { generateDebrief } from "@/lib/ai/tasks/debrief";
import { RunResultSchema, SimEventSchema } from "@/lib/domain/schemas";
import { getScenario } from "@/lib/store/kb";
import { completeSession, concludeRun, getSession } from "@/lib/store/sessions";

/**
 * Closes a run, then has it assessed. **Two separate things.**
 *
 * The log and the tally are written before the model is called, so a failure
 * in the debrief costs the assessment and never the record of what the
 * operator actually did — which is the part that cannot be reconstructed.
 *
 * That was already true of the *storage* and was not true of the *answer*: a
 * failed assessment came back as a 502, the console never sent the trainee on,
 * and a run in which every hostile was destroyed showed up as "this run has
 * not been completed yet". A model's bad minute was being reported as the
 * trainee's unfinished work.
 *
 * So this route now succeeds whenever the run was recorded, which is
 * everything the caller actually needs from it. Only a request that cannot
 * identify the run is an error.
 *
 * And it answers *as soon as* the run is recorded, rather than holding the
 * connection open until the prose is written. The assessment is a model call
 * of a minute or more, and awaiting it inside the request meant the trainee
 * sat on a "saving" screen long after the flying was over, with nothing to
 * look at and no way to tell whether anything was happening. At least one of
 * them gave up and closed the tab — their run was recorded, scored and filed
 * exactly as it should have been, and they never saw a word of it, which is
 * indistinguishable from the feature not existing.
 *
 * So the writing is scheduled with `after` and the trainee is sent to their
 * result immediately. The debrief page shows the tally at once and waits for
 * the prose there, where there is something to read while it waits.
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

  /* The run is closed here, on the engine's tally alone, before anything can
     fail. Everything below this line is the assessment, and the assessment is
     an addition to a finished run rather than the thing that finishes it. */
  await concludeRun(id, parsed.data.run_log, parsed.data.run_result);

  const scenario = await getScenario(session.system_id, session.scenario_entry_id);
  if (!scenario) {
    return NextResponse.json({
      recorded: true,
      assessment_error:
        "The scenario this run was built from no longer exists, so it cannot " +
        "be assessed against its rubric. The result of the run itself is saved.",
    });
  }

  /* Scheduled, not awaited. Nothing below this point can change what the
     trainee is about to be shown — the tally is already written — so none of
     it is worth making them wait for. A failure here leaves the run saved and
     unassessed, which the debrief page states plainly and offers to retry. */
  after(async () => {
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
    } catch (reason) {
      console.error(
        `[complete] run ${id.slice(0, 8)} is saved but unassessed: ${describeAiError(reason)}`,
      );
    }
  });

  return NextResponse.json({ recorded: true, assessment: "writing" });
}
