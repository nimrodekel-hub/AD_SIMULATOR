import { NextResponse, after, type NextRequest } from "next/server";
import { z } from "zod";
import { describeAiError } from "@/lib/ai/client";
import { generateExercise } from "@/lib/ai/tasks/generate-exercise";
import { DifficultyLevelSchema } from "@/lib/domain/schemas";
import { getScenario, getSystemProfile } from "@/lib/store/kb";
import { newExercise, saveExercise } from "@/lib/store/exercises";
import {
  asReported,
  failBuildJob,
  finishBuildJob,
  isStale,
  readBuildJob,
  startBuildJob,
} from "@/lib/store/exercise-build-job";

/**
 * Building an exercise from a designer's brief, in the background.
 *
 * Until this existed an exercise could only come into being by a trainee
 * asking for a run: the generator laid one out, it lived inside that session,
 * and a designer could take hold of it afterwards to correct it. So the person
 * who knows what should be trained could only ever edit somebody else's
 * accident — there was no way to say "build me this" and get it.
 *
 * The designer's answers become the brief the generator is given. That is the
 * same channel a trainee's own words travel down, and deliberately so: it is
 * already the one input that shapes the engagement rather than merely bounding
 * it, and everything that bounds an engagement — the scenario's dilemmas, the
 * profile's declared classes and figures, the difficulty band — still holds
 * exactly as it does for a trainee. A brief asking for twenty tracks on a
 * scenario that tops out at six gets six, and is told so in `adjustments`.
 *
 * POST starts the work and answers at once; GET reports where it got to.
 */

/**
 * The ceiling for the work scheduled with `after`, not for the response.
 *
 * `after` runs inside this budget, so it is what actually bounds a generation.
 * The POST itself answers in about a second.
 */
export const maxDuration = 300;

/**
 * What the designer is asked, and why each field is separate.
 *
 * They could all be one box, and a single box is what a designer stares at
 * without knowing what is wanted. These are the four questions that actually
 * change the engagement — what it is for, what it examines, how hard it should
 * press, and which decisions must arise — and they are asked separately so
 * that leaving one blank is a visible choice rather than an omission nobody
 * notices.
 */
const BodySchema = z.object({
  system_id: z.string().min(1),
  scenario_id: z.string().min(1),
  difficulty: DifficultyLevelSchema,
  /** What to call it. Blank lets the generator name it. */
  name: z.string().default(""),
  /** What the trainee should come away able to do. */
  objective: z.string().default(""),
  /** What this exercise examines — the thing it is a test of. */
  tested: z.string().default(""),
  /** How hard it should press, in the designer's own words. */
  load: z.string().default(""),
  /** The decisions that must actually arise during the run. */
  dilemmas: z.string().default(""),
  /** Anything else. */
  notes: z.string().default(""),
});

/**
 * The designer's answers, as one brief.
 *
 * Headed rather than run together, because the generator reads this as an
 * instruction and an unlabelled paragraph makes it guess which sentence was
 * the objective and which the load. Empty answers are left out entirely: a
 * heading with nothing under it reads as a requirement of nothing, and the
 * generator has been known to honour it.
 */
function briefFrom(body: z.infer<typeof BodySchema>): string {
  const parts: [string, string][] = [
    ["What this exercise is for", body.objective],
    ["What it examines", body.tested],
    ["How hard it should press", body.load],
    ["The decisions that must arise", body.dilemmas],
    ["Also", body.notes],
  ];
  return parts
    .filter(([, value]) => value.trim().length > 0)
    .map(([heading, value]) => `${heading}: ${value.trim()}`)
    .join("\n\n");
}

export async function POST(request: NextRequest) {
  const parsed = BodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const body = parsed.data;

  const brief = briefFrom(body);
  if (brief.length === 0) {
    return NextResponse.json(
      {
        error:
          "Say what the exercise is for. Without a brief this builds whatever " +
          "the scenario would have produced anyway, which you can already get " +
          "by having a trainee fly it.",
      },
      { status: 400 },
    );
  }

  const scenario = await getScenario(body.system_id, body.scenario_id);
  if (!scenario) {
    return NextResponse.json({ error: "Scenario not found" }, { status: 404 });
  }
  if (scenario.status !== "approved") {
    /* Only approved knowledge generates training. An exercise built on a draft
       would teach doctrine its own author has not finished writing. */
    return NextResponse.json(
      { error: "That scenario has not been approved yet." },
      { status: 409 },
    );
  }

  // A second press, or a reload followed by one, must not pay for two
  // generations of the same brief.
  const existing = await readBuildJob(body.system_id);
  if (existing?.status === "running" && !isStale(existing)) {
    return NextResponse.json(asReported(existing), { status: 202 });
  }

  const job = await startBuildJob(body.system_id);

  after(async () => {
    try {
      // Only an approved profile bounds an exercise. A draft is the designer
      // still working, and half-taught doctrine is worse than none.
      const profile = await getSystemProfile(body.system_id);
      const { exercise, notes, adjustments } = await generateExercise(
        scenario,
        body.difficulty,
        profile?.approved ? profile : null,
        { text: brief, clarifications: [] },
      );

      /* The designer's name wins where they gave one. They are naming a thing
         they will look for in a list later, and a generator's title — however
         apt — is not the word they will search by. */
      const named = body.name.trim();
      const instance = named
        ? { ...exercise, exercise_name: named }
        : exercise;

      const record = newExercise({
        systemId: body.system_id,
        scenarioEntryId: scenario.id,
        difficulty: body.difficulty,
        exercise: instance,
        source: "Built from a designer's brief",
      });
      await saveExercise(
        record,
        `Build exercise “${instance.exercise_name}” from a brief`,
      );

      await finishBuildJob(body.system_id, {
        exercise_id: record.id,
        system_id: body.system_id,
        exercise_name: instance.exercise_name,
        notes,
        adjustments,
      });
    } catch (reason) {
      await failBuildJob(body.system_id, describeAiError(reason));
    }
  });

  return NextResponse.json(job, { status: 202 });
}

/** Where the build got to. Safe to call as often as you like. */
export async function GET(request: NextRequest) {
  const systemId = request.nextUrl.searchParams.get("system") ?? "";
  if (!systemId) {
    return NextResponse.json({ error: "Which system?" }, { status: 400 });
  }
  return NextResponse.json(asReported(await readBuildJob(systemId)));
}
