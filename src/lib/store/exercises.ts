import "server-only";
import {
  SavedExerciseSchema,
  type DifficultyLevel,
  type Revision,
  type SavedExercise,
  type ExerciseInstance,
} from "../domain/schemas";
import { systemPaths } from "../config";
import { listSystems } from "./kb";
import { repoFiles } from "./repo-files";
import { currentNames } from "../domain/stored-names";

/**
 * The library of exercises.
 *
 * Until this existed, every exercise the generator produced lived in exactly
 * one place — the session of the trainee it was made for — which meant nobody
 * could see what had been generated, and a poor exercise could be discovered
 * only by flying it and corrected not at all.
 *
 * A record here is an exercise someone took hold of: lifted out of a run to be
 * corrected, or the correction itself. Sessions are never written to from
 * here. A finished run's debrief and score describe what was actually flown,
 * so revising it produces a record of its own and leaves the run intact.
 *
 * Filed under the system, like scenarios and for the same reason: an exercise is
 * only meaningful inside the system whose profile bounds it, and reading one
 * system's library should be one directory listing rather than a scan.
 */

const pathFor = (systemId: string, exerciseId: string) =>
  `${systemPaths(systemId).exercises}/${exerciseId}.json`;

export async function getSavedExercise(
  systemId: string,
  exerciseId: string,
): Promise<SavedExercise | null> {
  const raw = await repoFiles().read(pathFor(systemId, exerciseId));
  if (!raw) return null;
  const parsed = SavedExerciseSchema.safeParse(currentNames(JSON.parse(raw)));
  return parsed.success ? parsed.data : null;
}

export async function saveExercise(
  exercise: SavedExercise,
  message: string,
): Promise<void> {
  await repoFiles().write(
    pathFor(exercise.system_id, exercise.id),
    JSON.stringify(exercise, null, 2),
    message,
  );
}

/** One system's library, newest first. */
export async function listExercisesForSystem(
  systemId: string,
): Promise<SavedExercise[]> {
  const names = await repoFiles().list(systemPaths(systemId).exercises);
  const records = await Promise.all(
    names
      .filter((name) => name.endsWith(".json"))
      .map((name) => getSavedExercise(systemId, name.replace(/\.json$/, ""))),
  );
  return records
    .filter((entry): entry is SavedExercise => entry !== null)
    .sort((a, b) =>
      (b.updated_at || b.created_at).localeCompare(a.updated_at || a.created_at),
    );
}

/**
 * Every saved exercise, across every system.
 *
 * A designer reviewing the exercises their trainees will be given is thinking
 * about the exercises, not about which directory each one is filed in — so the
 * library has one front door. The per-system read above is what the system's
 * own pages use.
 */
export async function listAllExercises(): Promise<SavedExercise[]> {
  const systems = await listSystems();
  const perSystem = await Promise.all(
    systems.map((system) => listExercisesForSystem(system.id)),
  );
  return perSystem
    .flat()
    .sort((a, b) =>
      (b.updated_at || b.created_at).localeCompare(a.updated_at || a.created_at),
    );
}

/** A fresh record, for an exercise being taken hold of or newly produced. */
export function newExercise(input: {
  systemId: string;
  scenarioEntryId: string;
  difficulty: DifficultyLevel;
  exercise: ExerciseInstance;
  source: string;
  fromSessionId?: string;
  revisions?: Revision[];
}): SavedExercise {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    system_id: input.systemId,
    scenario_entry_id: input.scenarioEntryId,
    difficulty_level: input.difficulty,
    exercise_instance: input.exercise,
    revisions: input.revisions ?? [],
    source: input.source,
    from_session_id: input.fromSessionId ?? "",
    created_at: now,
    updated_at: now,
  };
}
