import "server-only";
import { z } from "zod";
import { exerciseJobPath } from "../config";
import { type Job, asReported, isStale, jobRecord } from "./job";

/**
 * The record of one exercise being generated for a trainee.
 *
 * This is the one long wait a trainee sees, and the trainee is the person most
 * likely to be on a phone — so it is the wait that must survive a locked
 * screen. See `job.ts`.
 *
 * Filed under the trainee rather than the system: two trainees may be starting
 * runs on the same system at the same moment, but nobody runs two exercises at
 * once, so one record per trainee is both correct and self-limiting.
 *
 * The result is only the session id. Everything the run needs is written into
 * the session itself before the job is marked done, so a finished job is a
 * pointer to something already complete.
 */

const ExerciseJobResultSchema = z.object({ session_id: z.string() });

export type ExerciseJobResult = z.infer<typeof ExerciseJobResultSchema>;
export type ExerciseJob = Job<ExerciseJobResult>;

const record = jobRecord(ExerciseJobResultSchema);

export function readExerciseJob(traineeId: string): Promise<ExerciseJob | null> {
  return record.read(exerciseJobPath(traineeId));
}

export function startExerciseJob(traineeId: string): Promise<ExerciseJob> {
  return record.start(
    exerciseJobPath(traineeId),
    `Start exercise generation for ${traineeId}`,
  );
}

export function finishExerciseJob(
  traineeId: string,
  result: ExerciseJobResult,
): Promise<void> {
  return record.finish(
    exerciseJobPath(traineeId),
    `Exercise ready for ${traineeId}`,
    result,
  );
}

export function failExerciseJob(
  traineeId: string,
  error: string,
): Promise<void> {
  return record.fail(
    exerciseJobPath(traineeId),
    `Exercise generation failed for ${traineeId}`,
    error,
  );
}

export { asReported, isStale };
