import "server-only";
import { z } from "zod";
import { DATA_PATHS } from "../config";
import { type Job, asReported, isStale, jobRecord } from "./job";

/**
 * One exercise being built from a designer's brief, in progress.
 *
 * The same arrangement as every other long step: laying out an engagement
 * takes the model over a minute, a browser will not hold a request that long,
 * so the press answers at once with a job record and the screen asks every few
 * seconds whether it has finished.
 *
 * Keyed by the system rather than by the designer, for the reason the
 * correction job is keyed by the exercise: what can only have one build under
 * way at a time is the library it lands in. Two tabs opened on the same
 * system's new-exercise form join the same wait instead of paying for two
 * generations of the same brief.
 *
 * Unlike a correction, this one **saves what it produces**. A correction is
 * held back for the designer to accept because it would overwrite an exercise
 * they had already approved; a new exercise overwrites nothing, and holding it
 * on the job would only mean a second screen before the one where it can
 * actually be worked on.
 */

const BuildJobResultSchema = z.object({
  /** Where it was filed. The screen goes straight here. */
  exercise_id: z.string(),
  system_id: z.string(),
  /** What it ended up called, which may be the designer's name or the model's. */
  exercise_name: z.string().default(""),
  /** The model's own account of what it built the engagement around. */
  notes: z.string().default(""),
  /**
   * What the profile's own limits overrode, in the designer's terms.
   *
   * The half the model cannot know: a window shortened below what the geometry
   * allows is put back by the generator's enforcement, and an interrogator
   * wired to classes that cannot reply is named here rather than discovered by
   * a trainee being failed for it.
   */
  adjustments: z.array(z.string()).default([]),
});

export type BuildJobResult = z.infer<typeof BuildJobResultSchema>;
export type BuildJob = Job<BuildJobResult>;

const record = jobRecord(BuildJobResultSchema);
const pathFor = (systemId: string) =>
  `${DATA_PATHS.jobs}/exercise-build-${systemId}.json`;

export function readBuildJob(systemId: string): Promise<BuildJob | null> {
  return record.read(pathFor(systemId));
}

export function startBuildJob(systemId: string): Promise<BuildJob> {
  return record.start(
    pathFor(systemId),
    `Start building an exercise for system ${systemId.slice(0, 8)}`,
  );
}

export function finishBuildJob(
  systemId: string,
  result: BuildJobResult,
): Promise<void> {
  return record.finish(
    pathFor(systemId),
    `Exercise built for system ${systemId.slice(0, 8)}`,
    result,
  );
}

export function failBuildJob(systemId: string, error: string): Promise<void> {
  return record.fail(
    pathFor(systemId),
    `Exercise build failed for system ${systemId.slice(0, 8)}`,
    error,
  );
}

export { asReported, isStale };
