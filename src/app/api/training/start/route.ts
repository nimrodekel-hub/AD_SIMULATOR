import { NextResponse, after, type NextRequest } from "next/server";
import { z } from "zod";
import { describeAiError } from "@/lib/ai/client";
import { generateExercise } from "@/lib/ai/tasks/generate-exercise";
import {
  ClarificationRoundSchema,
  DifficultyLevelSchema,
} from "@/lib/domain/schemas";
import { getScenario, getSystemProfile } from "@/lib/store/kb";
import {
  asReported,
  failExerciseJob,
  finishExerciseJob,
  isStale,
  readExerciseJob,
  startExerciseJob,
} from "@/lib/store/exercise-job";
import { createSession } from "@/lib/store/sessions";

/**
 * Instantiates an exercise from the matched scenario and opens a session.
 *
 * The browser does not wait for it. Generating an exercise measures at around
 * seventy-five seconds against production, and this is the one long wait a
 * trainee sees — the person most likely to be holding a phone, where a locked
 * screen kills the request while the server is still working. So POST starts
 * the work and returns at once, and GET reports where it got to.
 *
 * The job is filed under the trainee. Two trainees may start runs on the same
 * system at the same moment, but nobody runs two exercises at once.
 */

/**
 * The ceiling for the work scheduled with `after`, not for the response.
 *
 * `after` runs inside this budget, so it is what actually bounds a generation.
 * The POST itself answers in about a second.
 */
export const maxDuration = 300;

const BodySchema = z.object({
  trainee_id: z.string().min(1),
  system_id: z.string().min(1),
  scenario_id: z.string().min(1),
  requested_text: z.string().min(1),
  clarifications: z.array(ClarificationRoundSchema).default([]),
  difficulty: DifficultyLevelSchema,
});

export async function POST(request: NextRequest) {
  const parsed = BodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const body = parsed.data;

  const scenario = await getScenario(body.system_id, body.scenario_id);
  if (!scenario) {
    return NextResponse.json({ error: "Scenario not found" }, { status: 404 });
  }
  if (scenario.status !== "approved") {
    // Only approved knowledge generates training. Belt and braces: the matcher
    // is already restricted to approved entries.
    return NextResponse.json(
      { error: "That scenario has not been approved yet." },
      { status: 409 },
    );
  }

  // A second press, or a reload followed by one, must not generate two
  // exercises and leave the trainee in whichever session finished last.
  const existing = await readExerciseJob(body.trainee_id);
  if (existing?.status === "running" && !isStale(existing)) {
    return NextResponse.json(asReported(existing), { status: 202 });
  }

  const job = await startExerciseJob(body.trainee_id);

  after(async () => {
    try {
      // Only an approved profile governs generation. A draft is the designer
      // still working, and half-taught doctrine is worse than none.
      const profile = await getSystemProfile(body.system_id);
      const { exercise } = await generateExercise(
        scenario,
        body.difficulty,
        profile?.approved ? profile : null,
      );
      const session = await createSession({
        traineeId: body.trainee_id,
        systemId: body.system_id,
        scenarioEntryId: scenario.id,
        requestedText: body.requested_text,
        clarificationRounds: body.clarifications,
        difficulty: body.difficulty,
        exercise,
      });
      // The session is written before the job is marked done, so a finished
      // job always points at something that is already there to open.
      await finishExerciseJob(body.trainee_id, { session_id: session.id });
    } catch (reason) {
      await failExerciseJob(body.trainee_id, describeAiError(reason));
    }
  });

  return NextResponse.json(job, { status: 202 });
}

/** Where the trainee's current exercise generation got to. */
export async function GET(request: NextRequest) {
  const traineeId = request.nextUrl.searchParams.get("trainee_id");
  if (!traineeId) {
    return NextResponse.json({ error: "trainee_id is required" }, { status: 400 });
  }
  return NextResponse.json(asReported(await readExerciseJob(traineeId)));
}
