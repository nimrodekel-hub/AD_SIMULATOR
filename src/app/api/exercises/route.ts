import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/store/sessions";
import { newExercise, saveExercise } from "@/lib/store/exercises";

/**
 * Taking hold of an exercise so it can be corrected.
 *
 * An exercise generated for a run lives inside that run, and a finished run is
 * a record: its debrief and its score describe what was actually flown, so it
 * is never rewritten. Correcting one therefore starts by copying it out into
 * the library, and everything after that happens to the copy.
 *
 * The run it came from is recorded, because the debrief of that run is usually
 * the evidence for whatever was wrong with the exercise.
 */

const FromSessionSchema = z.object({ session_id: z.string().min(1) });

export async function POST(request: NextRequest) {
  const parsed = FromSessionSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Which run?" }, { status: 400 });
  }

  const session = await getSession(parsed.data.session_id);
  if (!session) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  const exercise = newExercise({
    systemId: session.system_id,
    scenarioEntryId: session.scenario_entry_id,
    difficulty: session.difficulty_level,
    exercise: session.exercise_instance,
    source: `Copied from a run of ${session.created_at.slice(0, 10)}`,
    fromSessionId: session.id,
  });

  try {
    await saveExercise(
      exercise,
      `Take hold of the exercise from run ${session.id.slice(0, 8)}`,
    );
    return NextResponse.json({ exercise });
  } catch (reason) {
    return NextResponse.json(
      { error: reason instanceof Error ? reason.message : "Failed to save." },
      { status: 500 },
    );
  }
}
