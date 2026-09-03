import { NextResponse, after, type NextRequest } from "next/server";
import { describeAiError } from "@/lib/ai/client";
import { generateScenario } from "@/lib/ai/tasks/generate-scenario";
import { getDilemma, getSystemProfile } from "@/lib/store/kb";
import { getSavedScenario } from "@/lib/store/scenarios";
import {
  asReported,
  failReviseJob,
  finishReviseJob,
  isStale,
  readReviseJob,
  startReviseJob,
} from "@/lib/store/scenario-revise-job";

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
  ctx: RouteContext<"/api/scenarios/[scenarioId]/revise">,
) {
  const { scenarioId } = await ctx.params;

  let body: { system_id?: string; requests?: unknown };
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const systemId = String(body.system_id ?? "");
  const saved = systemId ? await getSavedScenario(systemId, scenarioId) : null;
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

  const dilemma = await getDilemma(saved.system_id, saved.dilemma_entry_id);
  if (!dilemma) {
    return NextResponse.json(
      {
        error:
          "The dilemma this exercise teaches is no longer in the knowledge base, so it cannot be laid out again.",
      },
      { status: 409 },
    );
  }

  // Two tabs on the same exercise join the same wait rather than start a
  // second correction against it.
  const existing = await readReviseJob(scenarioId);
  if (existing?.status === "running" && !isStale(existing)) {
    return NextResponse.json(asReported(existing), { status: 202 });
  }

  const job = await startReviseJob(scenarioId);

  after(async () => {
    try {
      // Only an approved profile bounds a scenario. A draft is the designer
      // still working, and half-taught doctrine is worse than none.
      const profile = await getSystemProfile(saved.system_id);
      const { scenario, notes, adjustments } = await generateScenario(
        dilemma,
        saved.difficulty_level,
        profile?.approved ? profile : null,
        { previous: saved.scenario_instance, requests },
      );
      await finishReviseJob(scenarioId, {
        scenario,
        notes,
        requests,
        adjustments,
      });
    } catch (reason) {
      await failReviseJob(scenarioId, describeAiError(reason));
    }
  });

  return NextResponse.json(job, { status: 202 });
}

/** Where the correction got to. Safe to call as often as you like. */
export async function GET(
  _request: NextRequest,
  ctx: RouteContext<"/api/scenarios/[scenarioId]/revise">,
) {
  const { scenarioId } = await ctx.params;
  return NextResponse.json(asReported(await readReviseJob(scenarioId)));
}
