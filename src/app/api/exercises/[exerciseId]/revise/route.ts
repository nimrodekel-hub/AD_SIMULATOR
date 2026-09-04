import { NextResponse, after, type NextRequest } from "next/server";
import { describeAiError } from "@/lib/ai/client";
import { generateExercise } from "@/lib/ai/tasks/generate-exercise";
import { getScenario, getSystemProfile } from "@/lib/store/kb";
import { getSavedExercise } from "@/lib/store/exercises";
import {
  asReported,
  failReviseJob,
  finishReviseJob,
  isStale,
  readReviseJob,
  startReviseJob,
} from "@/lib/store/exercise-revise-job";

/**
 * Correcting one exercise, in the background.
 *
 * Laying out an engagement is the second-longest model call in the app, so the
 * browser does not wait for it: POST starts the work and answers at once, the
 * work carries on here, and GET reports where it got to.
 *
 * **Nothing is written to the exercise.** The corrected version is left on the
 * job for the designer to look at and accept, exactly as a rebuilt console is
 * — because an exercise that changed under a designer who had not seen it is
 * the same failure in a different place.
 */

export const maxDuration = 300;

export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/api/exercises/[exerciseId]/revise">,
) {
  const { exerciseId } = await ctx.params;

  let body: { system_id?: string; requests?: unknown };
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const systemId = String(body.system_id ?? "");
  const saved = systemId ? await getSavedExercise(systemId, exerciseId) : null;
  if (!saved) {
    return NextResponse.json({ error: "Exercise not found" }, { status: 404 });
  }

  /* Every complaint, oldest first — not only the newest. A correction that
     honours what was just said while undoing what was said before is how this
     goes round in circles, and the model can only avoid it by seeing the lot. */
  const requests = Array.isArray(body.requests)
    ? body.requests
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0)
        .slice(-20)
    : [];

  if (requests.length === 0) {
    return NextResponse.json(
      { error: "Say what is wrong with it first." },
      { status: 400 },
    );
  }

  const scenario = await getScenario(saved.system_id, saved.scenario_entry_id);
  if (!scenario) {
    return NextResponse.json(
      {
        error:
          "The scenario this exercise teaches is no longer in the knowledge base, so it cannot be laid out again.",
      },
      { status: 409 },
    );
  }

  // Two tabs on the same exercise join the same wait rather than start a
  // second correction against it.
  const existing = await readReviseJob(exerciseId);
  if (existing?.status === "running" && !isStale(existing)) {
    return NextResponse.json(asReported(existing), { status: 202 });
  }

  const job = await startReviseJob(exerciseId);

  after(async () => {
    try {
      // Only an approved profile bounds an exercise. A draft is the designer
      // still working, and half-taught doctrine is worse than none.
      const profile = await getSystemProfile(saved.system_id);
      const { exercise, notes, adjustments } = await generateExercise(
        scenario,
        saved.difficulty_level,
        profile?.approved ? profile : null,
        // No trainee request here: this is the designer correcting a stored
        // exercise, and their complaints are the instruction. Carrying a
        // trainee's original wording alongside them would put two people in
        // charge of the same run.
        undefined,
        { previous: saved.exercise_instance, requests },
      );
      await finishReviseJob(exerciseId, {
        exercise,
        notes,
        requests,
        adjustments,
      });
    } catch (reason) {
      await failReviseJob(exerciseId, describeAiError(reason));
    }
  });

  return NextResponse.json(job, { status: 202 });
}

/** Where the correction got to. Safe to call as often as you like. */
export async function GET(
  _request: NextRequest,
  ctx: RouteContext<"/api/exercises/[exerciseId]/revise">,
) {
  const { exerciseId } = await ctx.params;
  return NextResponse.json(asReported(await readReviseJob(exerciseId)));
}
