import { NextResponse, after, type NextRequest } from "next/server";
import { z } from "zod";
import { describeAiError } from "@/lib/ai/client";
import { generateScenario } from "@/lib/ai/tasks/generate-scenario";
import {
  ClarificationRoundSchema,
  DifficultyLevelSchema,
} from "@/lib/domain/schemas";
import { getDilemma, getSystemProfile } from "@/lib/store/kb";
import {
  asReported,
  failScenarioJob,
  finishScenarioJob,
  isStale,
  readScenarioJob,
  startScenarioJob,
} from "@/lib/store/scenario-job";
import { createSession } from "@/lib/store/sessions";

/**
 * Instantiates a scenario from the matched dilemma and opens a session.
 *
 * The browser does not wait for it. Generating a scenario measures at around
 * seventy-five seconds against production, and this is the one long wait a
 * trainee sees — the person most likely to be holding a phone, where a locked
 * screen kills the request while the server is still working. So POST starts
 * the work and returns at once, and GET reports where it got to.
 *
 * The job is filed under the trainee. Two trainees may start runs on the same
 * system at the same moment, but nobody runs two scenarios at once.
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
  dilemma_id: z.string().min(1),
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

  const dilemma = await getDilemma(body.system_id, body.dilemma_id);
  if (!dilemma) {
    return NextResponse.json({ error: "Dilemma not found" }, { status: 404 });
  }
  if (dilemma.status !== "approved") {
    // Only approved knowledge generates training. Belt and braces: the matcher
    // is already restricted to approved entries.
    return NextResponse.json(
      { error: "That dilemma has not been approved yet." },
      { status: 409 },
    );
  }

  // A second press, or a reload followed by one, must not generate two
  // scenarios and leave the trainee in whichever session finished last.
  const existing = await readScenarioJob(body.trainee_id);
  if (existing?.status === "running" && !isStale(existing)) {
    return NextResponse.json(asReported(existing), { status: 202 });
  }

  const job = await startScenarioJob(body.trainee_id);

  after(async () => {
    try {
      // Only an approved profile governs generation. A draft is the designer
      // still working, and half-taught doctrine is worse than none.
      const profile = await getSystemProfile(body.system_id);
      const { scenario } = await generateScenario(
        dilemma,
        body.difficulty,
        profile?.approved ? profile : null,
      );
      const session = await createSession({
        traineeId: body.trainee_id,
        systemId: body.system_id,
        dilemmaEntryId: dilemma.id,
        requestedText: body.requested_text,
        clarificationRounds: body.clarifications,
        difficulty: body.difficulty,
        scenario,
      });
      // The session is written before the job is marked done, so a finished
      // job always points at something that is already there to open.
      await finishScenarioJob(body.trainee_id, { session_id: session.id });
    } catch (reason) {
      await failScenarioJob(body.trainee_id, describeAiError(reason));
    }
  });

  return NextResponse.json(job, { status: 202 });
}

/** Where the trainee's current scenario generation got to. */
export async function GET(request: NextRequest) {
  const traineeId = request.nextUrl.searchParams.get("trainee_id");
  if (!traineeId) {
    return NextResponse.json({ error: "trainee_id is required" }, { status: 400 });
  }
  return NextResponse.json(asReported(await readScenarioJob(traineeId)));
}
