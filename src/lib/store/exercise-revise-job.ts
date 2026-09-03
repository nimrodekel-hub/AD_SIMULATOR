import "server-only";
import { z } from "zod";
import { DATA_PATHS } from "../config";
import { ExerciseInstanceSchema } from "../domain/schemas";
import { type Job, asReported, isStale, jobRecord } from "./job";

/**
 * One correction of one exercise, in progress.
 *
 * Laying out an engagement takes the model over a minute — it is the longest
 * call in the app after the console — and a browser will not hold a request
 * that long. So the same arrangement as every other long step: the press
 * answers at once with a job record, the work carries on server-side, and the
 * screen asks every few seconds whether it has finished.
 *
 * Keyed by the exercise rather than by whoever is looking at it: the thing
 * being corrected is what can only have one correction under way at a time,
 * and two tabs on the same exercise should join the same wait rather than
 * start a second one.
 */

const ReviseJobResultSchema = z.object({
  exercise: ExerciseInstanceSchema,
  /** The model's own account of what it changed, shown beside the request. */
  notes: z.string().default(""),
  /** Every complaint this correction answers, oldest first. */
  requests: z.array(z.string()).default([]),
  /**
   * What the profile's own limits overrode, in the designer's terms.
   *
   * Kept beside the notes because it is the half the model cannot know: a
   * window shortened below what the geometry allows is put back by the
   * enforcement in the generator, and without this the account of what
   * changed would describe a change that did not survive.
   */
  adjustments: z.array(z.string()).default([]),
});

export type ReviseJobResult = z.infer<typeof ReviseJobResultSchema>;
export type ReviseJob = Job<ReviseJobResult>;

const record = jobRecord(ReviseJobResultSchema);
const pathFor = (exerciseId: string) =>
  `${DATA_PATHS.jobs}/exercise-revise-${exerciseId}.json`;

export function readReviseJob(exerciseId: string): Promise<ReviseJob | null> {
  return record.read(pathFor(exerciseId));
}

export function startReviseJob(exerciseId: string): Promise<ReviseJob> {
  return record.start(
    pathFor(exerciseId),
    `Start exercise correction ${exerciseId.slice(0, 8)}`,
  );
}

export function finishReviseJob(
  exerciseId: string,
  result: ReviseJobResult,
): Promise<void> {
  return record.finish(
    pathFor(exerciseId),
    `Exercise corrected ${exerciseId.slice(0, 8)}`,
    result,
  );
}

export function failReviseJob(
  exerciseId: string,
  error: string,
): Promise<void> {
  return record.fail(
    pathFor(exerciseId),
    `Exercise correction failed ${exerciseId.slice(0, 8)}`,
    error,
  );
}

export { asReported, isStale };
