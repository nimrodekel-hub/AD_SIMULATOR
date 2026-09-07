import "server-only";
import type { ExerciseInstance } from "../domain/schemas";
import { sameAsk, type Ask } from "../domain/same-ask";
import { listExercisesForSystem } from "./exercises";
import { listAllSessions } from "./sessions";

/**
 * Finding a run that has already been laid out, instead of laying it out again.
 *
 * Generating an exercise is the most expensive thing this app does — a minute
 * or more of a model's time, billed, every time — and a trainee asking for the
 * same thing twice was paying for it twice and waiting for it twice, to be
 * handed something no better than what already existed.
 *
 * **What "the same thing" means is deliberately strict.** The trainee's own
 * words shape the engagement: "make me run out of interceptors" is an
 * instruction, and answering it with an exercise built for somebody else's
 * sentence would be exactly the failure this codebase refuses everywhere else
 * — a request that comes back looking as though it was never read. So a run is
 * only reused when the ask is *identical*: same system, same scenario, same
 * difficulty, same words, same clarifications. Anything new in the words and
 * it is laid out fresh.
 *
 * What does not have to match is who is asking. An exercise is a property of
 * the request, not of the person, and one already flown by another trainee is
 * the *better* answer rather than the worse one: it may since have been
 * corrected by the designer, and the correction is what gets served.
 *
 * Only a run worth repeating counts — see `worthRepeating`. A record can
 * match an ask perfectly and still be no use to anybody.
 *
 * Reuse does not make two runs identical. The luck of the shooting is seeded
 * from the session id, so the same tracks on the same geometry still miss and
 * hit differently — what is reused is the problem, not the outcome.
 */

/**
 * Whether this exercise is one a trainee could actually fly.
 *
 * Not every stored run holds a flyable engagement. Some predate the simulator
 * and carry the old quiz shape, with no `live_tracks` at all; others are
 * generations that failed part-way. Either way the record exists and matches
 * an ask perfectly, and reusing it would hand somebody an empty scope in half
 * a second — which is worse than the minute they would have waited, not
 * better. Found on the real data: three of the six runs on the live branch are
 * like this.
 *
 * So reuse asks for a run worth repeating, not merely a run that matches.
 */
function worthRepeating(exercise: ExerciseInstance): boolean {
  return exercise.live_tracks.length > 0 && exercise.time_window_seconds > 0;
}

/** An exercise that already exists for this ask, and where it came from. */
export interface Reused {
  exercise: ExerciseInstance;
  /** One line for the log: what was reused, and whether it had been fixed. */
  from: string;
}

/**
 * The exercise this ask has already been answered with, or null.
 *
 * Looks through the runs rather than the library because a run records the
 * words that produced it and the library does not — the library is what a
 * designer has taken hold of, filed under the system and the scenario, with no
 * memory of whose sentence it started as.
 *
 * Where the two overlap the library wins. A record there whose `from_session_id`
 * names the run we matched is that same exercise after a designer corrected it,
 * and serving the uncorrected original when the corrected one exists would make
 * the correction pointless.
 */
export async function reusableExercise(ask: Ask): Promise<Reused | null> {
  const sessions = await listAllSessions();

  // Newest first, which `listAllSessions` already guarantees: if the same ask
  // was made several times, the most recent answer is the one to repeat.
  const match = sessions.find(
    (session) =>
      worthRepeating(session.exercise_instance) &&
      sameAsk(ask, {
        systemId: session.system_id,
        scenarioId: session.scenario_entry_id,
        difficulty: session.difficulty_level,
        requestedText: session.requested_text,
        clarifications: session.clarification_rounds,
      }),
  );
  if (!match) return null;

  const corrected = (await listExercisesForSystem(ask.systemId)).find(
    (saved) => saved.from_session_id === match.id,
  );
  if (corrected && worthRepeating(corrected.exercise_instance)) {
    return {
      exercise: corrected.exercise_instance,
      from: `corrected exercise ${corrected.id.slice(0, 8)} (from run ${match.id.slice(0, 8)})`,
    };
  }

  return {
    exercise: match.exercise_instance,
    from: `run ${match.id.slice(0, 8)}`,
  };
}
